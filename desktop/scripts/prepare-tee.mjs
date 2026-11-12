import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, isAbsolute, join, posix } from 'node:path';
import { beeRoot, isMain, run, cli } from './process.mjs';

const textField = buffer => buffer.toString('utf8').replace(/\0.*$/s, '');
const octal = buffer => Number.parseInt(textField(buffer).trim() || '0', 8);

// Parse and validate the entire Git archive before touching the export tree.
// Content and link resolution both come from this archive, never the cache.
function parseArchive(archive) {
  let offset = 0;
  let extended = {};
  let ended = false;
  const entries = new Map();
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(b => b === 0)) {
      if (offset + 1024 > archive.length || !archive.subarray(offset).every(b => b === 0)) throw new Error(`TEE archive end marker invalid: offset=${offset}; archiveBytes=${archive.length}; required=two zero blocks followed only by padding`);
      ended = true;
      break;
    }
    const checksum = header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0);
    if (checksum !== octal(header.subarray(148, 156))) throw new Error(`TEE archive header checksum mismatch: offset=${offset}; actual=${checksum}`);
    const size = octal(header.subarray(124, 136));
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > archive.length) throw new Error(`TEE archive entry truncated: offset=${offset}; size=${size}; archiveBytes=${archive.length}`);
    const content = archive.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    const type = textField(header.subarray(156, 157)) || '0';
    if (type === 'x' || type === 'g') {
      let cursor = 0;
      const records = {};
      while (cursor < content.length) {
        const space = content.indexOf(32, cursor);
        const length = Number(content.subarray(cursor, space).toString());
        if (space < cursor || !Number.isSafeInteger(length) || length <= space - cursor + 1 || cursor + length > content.length) throw new Error(`TEE archive pax record invalid: offset=${offset}; recordOffset=${cursor}`);
        const record = content.subarray(space + 1, cursor + length - 1).toString('utf8');
        const equals = record.indexOf('=');
        if (equals < 1) throw new Error(`TEE archive pax key missing: offset=${offset}; recordOffset=${cursor}`);
        records[record.slice(0, equals)] = record.slice(equals + 1);
        cursor += length;
      }
      if (type === 'x') extended = records;
      continue;
    }
    const prefix = textField(header.subarray(345, 500));
    const name = extended.path ?? (prefix ? prefix + '/' : '') + textField(header.subarray(0, 100));
    const link = extended.linkpath ?? textField(header.subarray(157, 257));
    extended = {};
    if (isAbsolute(name) || name.includes('\\') || name.includes(':') || name.split('/').includes('..') || !name) throw new Error(`TEE archive path escapes cache: entry=${name}`);
    if (!['0', '2', '5'].includes(type)) throw new Error(`TEE archive entry type unsupported: entry=${name}; actualType=${type}`);
    const path = posix.normalize(name).replace(/\/$/, '');
    if (path === '.' || entries.has(path)) throw new Error(`TEE archive path invalid: entry=${name}; normalized=${path}; required=unique non-root path`);
    entries.set(path, { name: path, type, link, content, mode: octal(header.subarray(100, 108)) & 0o777 });
  }
  if (!ended) throw new Error(`TEE archive end marker missing: archiveBytes=${archive.length}; offset=${offset}`);
  const directories = new Set(['.']);
  for (const entry of entries.values()) {
    if (entry.type === '5') directories.add(entry.name);
    for (let parent = posix.dirname(entry.name); parent !== '.'; parent = posix.dirname(parent)) {
      const ancestor = entries.get(parent);
      if (ancestor && ancestor.type !== '5') throw new Error(`TEE archive parent is not a directory: entry=${entry.name}; parent=${parent}; actualType=${ancestor.type}`);
      directories.add(parent);
    }
  }
  for (const entry of entries.values()) {
    if (entry.type !== '2') continue;
    const visited = new Set();
    let target = entry;
    while (target.type === '2') {
      if (visited.has(target.name)) throw new Error(`TEE archive symlink cycle: entry=${entry.name}; repeatedTarget=${target.name}; chain=${[...visited].join(' -> ')}`);
      visited.add(target.name);
      const path = posix.normalize(posix.join(posix.dirname(target.name), target.link));
      if (!target.link || isAbsolute(target.link) || target.link.includes('\\') || target.link.includes(':') || path === '..' || path.startsWith('../')) throw new Error(`TEE archive symlink escapes cache: entry=${target.name}; target=${target.link}; resolved=${path}`);
      // Validate intermediate components before '..' normalization can hide a
      // missing directory or traversal through a file/symlink.
      let parent = posix.dirname(target.name);
      for (const component of target.link.split('/').slice(0, -1)) {
        parent = posix.normalize(posix.join(parent, component));
        if (!directories.has(parent)) throw new Error(`TEE archive symlink intermediate path is not a directory: entry=${entry.name}; linkEntry=${target.name}; target=${target.link}; parent=${parent}; actualType=${entries.get(parent)?.type ?? 'missing'}`);
      }
      const next = entries.get(path);
      if (!next) throw new Error(`TEE archive symlink target missing: entry=${entry.name}; linkEntry=${target.name}; target=${target.link}; resolved=${path}`);
      target = next;
    }
    if (target.type !== '0') throw new Error(`TEE archive symlink target is not a regular file: entry=${entry.name}; target=${target.name}; actualType=${target.type}`);
    entry.fileTarget = target;
  }
  return entries;
}

// POSIX keeps archive symlinks. Windows copies immutable archive file content,
// avoiding symlink privileges without promising alias-on-write semantics.
export function extractArchive(archive, destination, platform = process.platform) {
  const entries = parseArchive(archive);
  const stat = lstatSync(destination);
  const entryCount = stat.isDirectory() ? readdirSync(destination).length : null;
  if (!stat.isDirectory() || entryCount !== 0) throw new Error(`TEE archive destination invalid: path=${destination}; actualMode=${stat.mode}; entryCount=${entryCount}; required=empty real directory`);
  const write = (entry, file = entry) => {
    const output = join(destination, entry.name);
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, file.content, { flag: 'wx', mode: file.mode });
    if (platform !== 'win32') chmodSync(output, file.mode);
  };
  for (const entry of entries.values()) {
    if (entry.type === '5') mkdirSync(join(destination, entry.name), { recursive: true });
    else if (entry.type === '0') write(entry);
  }
  for (const entry of entries.values()) {
    if (entry.type !== '2') continue;
    if (platform === 'win32') write(entry, entry.fileTarget);
    else {
      mkdirSync(dirname(join(destination, entry.name)), { recursive: true });
      symlinkSync(entry.link, join(destination, entry.name));
    }
  }
}

function compareTrees(expectedRoot, actualRoot, relative = '') {
  const expected = join(expectedRoot, relative);
  const actual = join(actualRoot, relative);
  const left = lstatSync(expected);
  let right;
  try { right = lstatSync(actual); } catch (error) { throw new Error(`TEE cache ${relative || '.'} mismatch: expected entry missing; ${error.message}`); }
  if (left.isDirectory() && right.isDirectory()) {
    const want = readdirSync(expected).sort();
    const got = readdirSync(actual).sort();
    if (JSON.stringify(want) !== JSON.stringify(got)) throw new Error(`TEE cache ${relative || '.'} mismatch: actual entries=${JSON.stringify(got)}; expected=${JSON.stringify(want)}`);
    for (const name of want) compareTrees(expectedRoot, actualRoot, join(relative, name));
  } else if (left.isFile() && right.isFile()) {
    const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
    const want = hash(expected), got = hash(actual);
    if (want !== got) throw new Error(`TEE cache ${relative} SHA256 mismatch: actual=${got}; expected=${want}; existing cache preserved`);
  } else if (left.isSymbolicLink() && right.isSymbolicLink()) {
    if (readlinkSync(expected) !== readlinkSync(actual)) throw new Error(`TEE cache ${relative} symlink mismatch: actual=${readlinkSync(actual)}; expected=${readlinkSync(expected)}`);
  } else throw new Error(`TEE cache ${relative || '.'} entry type mismatch: actualMode=${right.mode}; expectedMode=${left.mode}`);
}

export function prepareTee({ root = beeRoot, source = process.env.TEE_SOURCE ?? join(root, '.cache/tokhive-tee-source'), platform = process.platform } = {}) {
  const revision = readFileSync(join(root, 'TEE_REVISION'), 'utf8').trim();
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error(`TEE_REVISION invalid: actual=${revision}; required=40 lowercase hex characters`);
  const cache = join(root, '.cache');
  const destination = join(cache, 'tee');
  if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) throw new Error(`TEE cache is a symlink: path=${destination}; required=real directory; existing cache preserved`);
  mkdirSync(cache, { recursive: true });
  if (!existsSync(source)) run('git', ['clone', '--no-checkout', 'https://github.com/tokhive/tee.git', source], { cwd: root });
  run('git', ['-C', source, 'rev-parse', '--git-dir'], { cwd: root });
  try { run('git', ['-C', source, 'cat-file', '-e', `${revision}^{commit}`], { cwd: root }); }
  catch { run('git', ['-C', source, 'fetch', '--depth=1', 'origin', revision], { cwd: root }); }
  const temporary = mkdtempSync(join(cache, 'tee-'));
  let digest;
  try {
    // The pinned source includes 153 MB of circuit/native assets. Write the
    // archive directly to disk instead of overflowing child_process stdout.
    const archivePath = join(temporary, 'source.tar');
    // Git archive applies checkout EOL conversion unless explicitly disabled;
    // keep pinned bytes and archive SHA independent of local/global Git config.
    run('git', ['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', '-C', source, 'archive', '--format=tar', `--output=${archivePath}`, revision], { cwd: root });
    const archive = readFileSync(archivePath);
    digest = createHash('sha256').update(archive).digest('hex');
    const extracted = join(temporary, 'export');
    mkdirSync(extracted);
    extractArchive(archive, extracted, platform);
    writeFileSync(join(extracted, '.archive-sha256'), digest + '  -\n');
    if (existsSync(destination)) compareTrees(extracted, destination);
    else renameSync(extracted, destination);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
  console.log(`TEE dependency verified: revision=${revision}; archiveSHA256=${digest}; path=${destination}`);
  return destination;
}

if (isMain(import.meta.url)) cli(() => prepareTee());
