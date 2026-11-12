import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepareTee } from '../scripts/prepare-tee.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const source = join(repository, '.cache/tokhive-tee-source');
// Canonical Git archive of the maintained TEE dependency at c46f7dbf2ed4.
const archiveSha256 = '24370b402b392e92f1c86e0f8507106ff9ea41bbc3717bd97ede04ea83556405';
const service = 'deploy/snp-image/mkosi.extra/etc/systemd/system/snp-prober.service';
const alias = 'deploy/snp-image/mkosi.extra/etc/systemd/system/multi-user.target.wants/snp-prober.service';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function git(args) {
  const result = spawnSync('git', args, { maxBuffer: 1024 * 1024 });
  assert.equal(result.error, undefined, `Git failed to start: ${result.error?.message}`);
  assert.equal(result.status, 0, `Git ${args[0]} failed: status=${result.status}; signal=${result.signal}; stderr=${result.stderr.toString()}`);
  return result.stdout;
}

// Observe the complete existing cache without following symlinks. A failed
// prepare must preserve all entries, types, link values and file bytes.
function cacheFingerprint(root) {
  const hash = createHash('sha256');
  function visit(relative) {
    const path = join(root, relative);
    const stat = lstatSync(path);
    const type = stat.isSymbolicLink() ? 'link' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'special';
    const content = type === 'link' ? readlinkSync(path) : type === 'file' ? sha256(readFileSync(path)) : '';
    hash.update(JSON.stringify([relative, type, content]) + '\n');
    if (type === 'directory') for (const name of readdirSync(path).sort()) visit(relative ? `${relative}/${name}` : name);
  }
  visit('');
  return hash.digest('hex');
}

test('native host verifies the real pinned TEE export, existing cache and tamper rejection', async t => {
  const root = mkdtempSync(join(tmpdir(), 'bee-tee-native-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const revisionFile = readFileSync(join(repository, 'TEE_REVISION'));
  const revision = revisionFile.toString().trim();
  assert.match(revision, /^[a-f0-9]{40}$/, `Invalid pinned revision: actual=${revision}; required=40 lowercase hex characters`);
  writeFileSync(join(root, 'TEE_REVISION'), revisionFile);
  t.diagnostic(`OS=${process.platform}; release=${release()}; arch=${process.arch}; node=${process.version}; git=${git(['--version']).toString().trim()}; revision=${revision}`);

  // No platform override: this is evidence only for the actual host OS.
  // Missing source is cloned by prepareTee from its official pinned repository.
  const destination = prepareTee({ root, source });
  assert.equal(destination, join(root, '.cache/tee'));
  const archive = join(root, 'pinned-source.tar');
  git(['-c', 'core.autocrlf=false', '-c', 'core.eol=lf', '-C', source, 'archive', '--format=tar', `--output=${archive}`, revision]);
  const actualArchiveSha256 = sha256(readFileSync(archive));
  t.diagnostic(`archiveSHA256=${actualArchiveSha256}; requiredArchiveSHA256=${archiveSha256}`);
  assert.equal(actualArchiveSha256, archiveSha256, 'Pinned archive differs from the historical verified SHA256; stop and investigate without updating the expected hash');
  assert.equal(readFileSync(join(destination, '.archive-sha256'), 'utf8'), `${archiveSha256}  -\n`);

  const linkValue = git(['-C', source, 'show', `${revision}:${alias}`]).toString();
  const expected = git(['-C', source, 'show', `${revision}:${service}`]);
  assert.equal(linkValue, '../snp-prober.service', 'Pinned service link must still reference the independently read service blob');
  assert.equal(lstatSync(join(destination, service)).isFile(), true, `${service}: expected ordinary target file`);
  for (const name of [alias, service]) assert.deepEqual(readFileSync(join(destination, name)), expected, `${name}: exported bytes differ from git show at revision=${revision}`);
  const linkStat = lstatSync(join(destination, alias));
  if (process.platform === 'win32') {
    assert.equal(linkStat.isFile(), true, `${alias}: Windows export must be an ordinary file without symlink privileges`);
    assert.equal(linkStat.isSymbolicLink(), false);
  } else {
    assert.equal(linkStat.isSymbolicLink(), true, `${alias}: POSIX export must preserve the symlink`);
    assert.equal(readlinkSync(join(destination, alias)), linkValue);
  }
  t.diagnostic(`result=PASS first-export; serviceSHA256=${sha256(expected)}; representation=${process.platform === 'win32' ? 'ordinary-file-copy' : 'original-symlink'}`);

  const pristine = cacheFingerprint(destination);
  assert.equal(prepareTee({ root, source }), destination);
  assert.equal(cacheFingerprint(destination), pristine, 'Second prepare changed the already verified cache');
  t.diagnostic('result=PASS existing-cache-revalidation');

  const paths = process.platform === 'win32' ? [alias, service] : [service];
  for (const relative of paths) {
    await t.test(`rejects altered ${relative} and preserves the existing cache`, () => {
      const file = join(destination, relative);
      const other = join(destination, relative === alias ? service : alias);
      const tampered = Buffer.from('native fixed TEE cache tamper probe\n');
      writeFileSync(file, tampered);
      if (process.platform === 'win32') assert.deepEqual(readFileSync(other), expected, 'Writing one copied position changed the other position');
      const before = cacheFingerprint(destination);
      assert.throws(() => prepareTee({ root, source }), error => {
        const expectedPath = join(...relative.split('/'));
        assert.ok(error.message.includes(expectedPath), `Cache rejection omitted the changed path: actual=${error.message}; requiredPath=${expectedPath}`);
        assert.match(error.message, /SHA256 mismatch.*existing cache preserved/);
        t.diagnostic(`result=PASS tamper-rejection; evidence=${error.message}`);
        return true;
      });
      assert.equal(cacheFingerprint(destination), before, 'Rejected prepare modified the existing cache');
      assert.deepEqual(readFileSync(file), tampered, 'Rejected prepare replaced the tampered bytes');
      if (process.platform === 'win32') assert.deepEqual(readFileSync(other), expected, 'Rejected prepare changed the independent copied position');
      // Restore only this test-owned cache before the next independent probe.
      writeFileSync(file, expected);
      assert.equal(cacheFingerprint(destination), pristine, 'Restoring the test probe did not recover the original cache');
    });
  }
});
