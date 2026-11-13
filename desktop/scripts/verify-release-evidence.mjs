import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

// 此门槛校验证据文件及候选身份；签名工具输出仍须由发布负责人审阅。
const targets = [
  ['macos-13-arm64', 'macos', 'arm64'], ['macos-13-x64', 'macos', 'x64'],
  ['windows-10-22h2-x64', 'windows', 'x64'], ['windows-11-x64', 'windows', 'x64'],
  ['ubuntu-22.04-x64', 'ubuntu', 'x64'], ['ubuntu-22.04-arm64', 'ubuntu', 'arm64'],
  ['ubuntu-24.04-x64', 'ubuntu', 'x64'], ['ubuntu-24.04-arm64', 'ubuntu', 'arm64'],
];
const requiredSteps = {
  P1: ['install', 'start', 'bundled_bee_source', 'no_automatic_contribution', 'preserve_existing_config', 'preserve_external_bee'],
  P2: ['existing_login', 'official_login', 'select_account', 'explicit_contribution', 'pause', 'resume', 'switch_account_stays_paused', 'offline', 'restart_recovery'],
  P3: ['doctor', 'log_export', 'proxy', 'language_theme', 'autostart', 'notifications', 'close_and_reopen', 'permission_denied', 'export_failure'],
  P4: ['check', 'download', 'verify_signature', 'confirm_exit', 'owned_stop', 'install', 'new_version_start', 'pairing_preserved', 'account_selection_preserved', 'pause_preserved', 'preferences_preserved', 'pending_actions_reconciled', 'runtime_recovered'],
  P5: ['wrong_signature', 'wrong_platform', 'wrong_architecture', 'interrupted_download', 'disk_failure', 'permission_failure', 'duplicate_install', 'child_reap_failure', 'old_app_new_config'],
  P6: ['release_notes', 'supported_platforms', 'installation', 'update', 'official_clients', 'known_limitations', 'package_checksums', 'signing_evidence'],
};
const identityKeys = ['version', 'bee_version', 'source_revision', 'build_mode', 'channel', 'update_endpoint', 'updater_public_key_sha256'];
const sha256Pattern = /^[a-f0-9]{64}$/;
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const display = value => value === undefined ? '缺失' : JSON.stringify(value);
function check(condition, path, actual, expected) {
  if (!condition) throw new Error(`${path} 校验失败：实际=${display(actual)}；要求=${display(expected)}`);
}
const equal = (path, actual, expected) => check(actual === expected, path, actual, expected);
const text = (path, actual) => check(nonempty(actual), path, actual, '非空文本');
const object = (path, actual) => check(actual !== null && typeof actual === 'object' && !Array.isArray(actual), path, actual, '对象');
function compareVersions(left, right) {
  const parts = version => {
    const index = version.indexOf('-');
    return index < 0 ? [version.split('.'), []] : [version.slice(0, index).split('.'), version.slice(index + 1).split('.')];
  };
  const [a, preA] = parts(left);
  const [b, preB] = parts(right);
  for (let index = 0; index < 3; index++) {
    if (BigInt(a[index]) !== BigInt(b[index])) return BigInt(a[index]) < BigInt(b[index]) ? -1 : 1;
  }
  if (!preA.length || !preB.length) return preA.length === preB.length ? 0 : preA.length ? -1 : 1;
  for (let index = 0; index < Math.max(preA.length, preB.length); index++) {
    if (preA[index] === preB[index]) continue;
    if (preA[index] === undefined || preB[index] === undefined) return preA[index] === undefined ? -1 : 1;
    const numericA = /^\d+$/.test(preA[index]);
    const numericB = /^\d+$/.test(preB[index]);
    if (numericA !== numericB) return numericA ? -1 : 1;
    return numericA ? BigInt(preA[index]) < BigInt(preB[index]) ? -1 : 1 : preA[index] < preB[index] ? -1 : 1;
  }
  return 0;
}

export function parseEvidence(contents, path = 'evidence.md') {
  let json = contents;
  if (!path.endsWith('.json')) {
    const blocks = [...contents.matchAll(/^```json bee-release-evidence\s*\r?\n([\s\S]*?)^```\s*$/gm)];
    check(blocks.length === 1, `${path} 证据 JSON 围栏数量`, blocks.length, 1);
    json = blocks[0][1];
  }
  try { return JSON.parse(json); }
  catch (error) { throw new Error(`${path} 证据 JSON 解析失败：${error.message}`, { cause: error }); }
}

export function verifyReleaseEvidence(evidence, baseDir) {
  const root = realpathSync(baseDir);
  const verifiedFiles = new Map();
  function proof(ref, path, kinds) {
    object(path, ref);
    text(`${path}.path`, ref.path);
    check(sha256Pattern.test(ref.sha256), `${path}.sha256`, ref.sha256, '64 位小写 SHA-256');
    check(kinds.includes(ref.kind), `${path}.kind`, ref.kind, kinds);
    const context = { reference: ref.path, allowed_root: baseDir };
    check(!isAbsolute(ref.path) && !win32.isAbsolute(ref.path) && !ref.path.split(/[\\/]/).includes('..'),
      `${path}.path`, context, '允许的证据根目录内相对路径，不含绝对路径或上级目录');
    const file = resolve(root, ref.path);
    const local = relative(root, file);
    check(local !== '' && local !== '..' && !local.startsWith(`..${sep}`) && !isAbsolute(local),
      `${path}.path`, context, '允许的证据根目录内普通文件');
    let bytes = verifiedFiles.get(file);
    try {
      let component = root;
      for (const segment of local.split(sep)) {
        component = resolve(component, segment);
        check(!lstatSync(component).isSymbolicLink(), `${path}.path`, context, '允许的证据根目录内普通文件，附件及目录均禁止符号链接');
      }
      const canonical = realpathSync(file);
      const canonicalLocal = relative(root, canonical);
      check(canonicalLocal !== '' && canonicalLocal !== '..' && !canonicalLocal.startsWith(`..${sep}`) && !isAbsolute(canonicalLocal),
        `${path}.path`, { ...context, real_path: canonical }, '真实路径必须位于允许的证据根目录内');
      check(lstatSync(canonical).isFile(), `${path}.path`, context, '允许的证据根目录内非空普通文件');
      if (!bytes) {
        bytes = readFileSync(canonical);
      }
    } catch (error) { throw new Error(`${path} 读取附件 ${ref.path} 失败（允许根目录 ${baseDir}）：${error.message}`, { cause: error }); }
    if (!verifiedFiles.has(file)) {
      check(bytes.length > 0, `${path}.path`, ref.path, '非空文件');
      verifiedFiles.set(file, bytes);
    }
    const actual = createHash('sha256').update(bytes).digest('hex');
    check(actual === ref.sha256, `${path}.sha256`, ref.sha256, `实际文件 SHA-256=${actual}`);
    return bytes;
  }
  function jsonProof(ref, path, kind) {
    const bytes = proof(ref, path, [kind]);
    try { return JSON.parse(bytes.toString('utf8')); }
    catch (error) { throw new Error(`${path} 附件 ${ref.path} JSON 解析失败：${error.message}`, { cause: error }); }
  }
  function identity(value, path) {
    object(path, value);
    check(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value.version), `${path}.version`, value.version, '明确的语义版本号');
    const preRelease = value.version.slice(value.version.indexOf('-') + 1).split('.');
    check(!value.version.includes('-') || preRelease.every(part => !/^0\d+$/.test(part)), `${path}.version`, value.version, '预发布版本中的数值标识不带前导零');
    equal(`${path}.bee_version`, value.bee_version, value.version);
    check(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.source_revision), `${path}.source_revision`, value.source_revision, '完整源码提交 SHA');
    equal(`${path}.build_mode`, value.build_mode, 'production');
    text(`${path}.channel`, value.channel);
    let url;
    try { url = new URL(value.update_endpoint); } catch { /* 下方保留实际输入。 */ }
    check(url?.protocol === 'https:' && !url.username && !url.password && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname),
      `${path}.update_endpoint`, value.update_endpoint, '受控、无凭据的生产 HTTPS 地址');
    check(sha256Pattern.test(value.updater_public_key_sha256), `${path}.updater_public_key_sha256`, value.updater_public_key_sha256, '生产更新公钥 SHA-256');
  }
  function matchingIdentity(actual, expected, path) {
    object(path, actual);
    for (const key of identityKeys) equal(`${path}.${key}`, actual[key], expected[key]);
  }
  function environment(actual, target, path) {
    object(path, actual);
    const [id, os, arch] = target;
    equal(`${path}.os`, actual.os, os);
    equal(`${path}.arch`, actual.arch, arch);
    equal(`${path}.execution`, actual.execution, 'native-desktop');
    equal(`${path}.container`, actual.container, false);
    equal(`${path}.emulated`, actual.emulated, false);
    if (os === 'macos') {
      check(/^13\.\d+(?:\.\d+)?$/.test(actual.version), `${path}.version`, actual.version, 'macOS 13.x 最低版本原生验收');
      equal(`${path}.display`, actual.display, 'aqua');
    } else if (os === 'ubuntu') {
      equal(`${path}.version`, actual.version, id.includes('22.04') ? '22.04' : '24.04');
      check(['x11', 'wayland'].includes(actual.display), `${path}.display`, actual.display, ['x11', 'wayland']);
    } else {
      equal(`${path}.windows_product_type`, actual.windows_product_type, 1);
      const win10 = id.includes('10-22h2');
      check(win10 ? /^10(?:\.\d+)*$/.test(actual.version) : /^11(?:\.\d+)*$/.test(actual.version), `${path}.version`, actual.version, win10 ? 'Windows 10 22H2' : 'Windows 11');
      check(Number.isInteger(actual.windows_build) && (win10 ? actual.windows_build === 19045 : actual.windows_build >= 22000),
        `${path}.windows_build`, actual.windows_build, win10 ? 19045 : '>= 22000');
      equal(`${path}.display`, actual.display, 'windows');
    }
  }
  function binding(actual, bundle, path) {
    object(path, actual);
    for (const key of ['source_revision', 'version', 'build_mode']) equal(`${path}.${key}`, actual[key], bundle.identity[key]);
    equal(`${path}.installer_sha256`, actual.installer_sha256, bundle.installer.file.sha256);
    equal(`${path}.update_asset_sha256`, actual.update_asset_sha256, bundle.update_asset.file.sha256);
  }
  function signatureProof(signature, actual, kind, path) {
    const report = jsonProof(signature.proof, path, 'native-log');
    equal(`${path}.schema_version`, report.schema_version, 1);
    equal(`${path}.verified`, report.verified, true);
    equal(`${path}.scope`, report.scope, 'production');
    equal(`${path}.signature_kind`, report.signature_kind, kind);
    binding(report, actual, path);
    equal(`${path}.bundled_bee_sha256`, report.bundled_bee_sha256, actual.bundled_bee.file.sha256);
    text(`${path}.tool`, report.tool);
    if (kind === 'updater') equal(`${path}.public_key_sha256`, report.public_key_sha256, signature.public_key_sha256);
    if (kind === 'platform') equal(`${path}.signing_identity`, report.signing_identity, signature.identity);
    if (kind === 'notarization') equal(`${path}.stapled`, report.stapled, true);
    proof(report.raw_output, `${path}.raw_output`, ['native-log']);
  }
  function bundle(actual, expected, target, path) {
    object(path, actual);
    matchingIdentity(actual.identity, expected, `${path}.identity`);
    equal(`${path}.os`, actual.os, target[1]);
    equal(`${path}.arch`, actual.arch, target[2]);
    const format = { macos: 'dmg', windows: 'nsis', ubuntu: 'appimage' }[target[1]];
    for (const kind of ['installer', 'update_asset']) {
      object(`${path}.${kind}`, actual[kind]);
      equal(`${path}.${kind}.format`, actual[kind].format, kind === 'update_asset' && target[1] === 'macos' ? 'app.tar.gz' : format);
      proof(actual[kind].file, `${path}.${kind}.file`, ['package']);
    }
    object(`${path}.bundled_bee`, actual.bundled_bee);
    equal(`${path}.bundled_bee.version`, actual.bundled_bee.version, expected.bee_version);
    equal(`${path}.bundled_bee.source_revision`, actual.bundled_bee.source_revision, expected.source_revision);
    proof(actual.bundled_bee.file, `${path}.bundled_bee.file`, ['binary']);
    object(`${path}.signatures`, actual.signatures);
    const updater = actual.signatures.updater;
    object(`${path}.signatures.updater`, updater);
    equal(`${path}.signatures.updater.verified`, updater.verified, true);
    equal(`${path}.signatures.updater.scope`, updater.scope, 'production');
    equal(`${path}.signatures.updater.public_key_sha256`, updater.public_key_sha256, expected.updater_public_key_sha256);
    signatureProof(updater, actual, 'updater', `${path}.signatures.updater.proof`);
    if (target[1] !== 'ubuntu') {
      const signing = actual.signatures.platform;
      object(`${path}.signatures.platform`, signing);
      equal(`${path}.signatures.platform.verified`, signing.verified, true);
      equal(`${path}.signatures.platform.scope`, signing.scope, 'production');
      equal(`${path}.signatures.platform.kind`, signing.kind, target[1] === 'macos' ? 'developer-id' : 'authenticode');
      text(`${path}.signatures.platform.identity`, signing.identity);
      signatureProof(signing, actual, 'platform', `${path}.signatures.platform.proof`);
    }
    if (target[1] === 'macos') {
      const notarization = actual.signatures.notarization;
      object(`${path}.signatures.notarization`, notarization);
      equal(`${path}.signatures.notarization.verified`, notarization.verified, true);
      equal(`${path}.signatures.notarization.stapled`, notarization.stapled, true);
      signatureProof(notarization, actual, 'notarization', `${path}.signatures.notarization.proof`);
    }
  }
  function stepResults(results, names, path, failureCases = false) {
    object(path, results);
    for (const name of names) {
      const result = results[name];
      object(`${path}.${name}`, result);
      equal(`${path}.${name}.status`, result.status, 'passed');
      text(`${path}.${name}.actual`, result.actual);
      if (failureCases) {
        equal(`${path}.${name}.data_preserved`, result.data_preserved, true);
        equal(`${path}.${name}.no_false_success`, result.no_false_success, true);
      }
    }
  }
  function nativeEvidence(refs, path) {
    check(Array.isArray(refs) && refs.some(ref => ref.kind === 'native-log'), path, refs, '至少一个 native-log 附件；截图不能单独认证');
    for (const [index, ref] of refs.entries()) proof(ref, `${path}[${index}]`, ['native-log', 'screenshot', 'document']);
  }
  function nativeScenario(value, path) {
    object(path, value);
    equal(`${path}.status`, value.status, 'passed');
    text(`${path}.actual`, value.actual);
    nativeEvidence(value.evidence, `${path}.evidence`);
  }
  function sourceCoverage(coverage, os, path) {
    object(path, coverage);
    for (const provider of ['openai', 'claude']) {
      const sources = coverage[provider];
      const providerPath = `${path}.${provider}`;
      object(providerPath, sources);
      for (const kind of ['file', 'keychain']) {
        const source = sources[kind];
        const sourcePath = `${providerPath}.${kind}`;
        object(sourcePath, source);
        equal(`${sourcePath}.store`, source.store, kind === 'file' ? 'file' : provider === 'openai' ? 'keyring' : 'keychain');
        const applicable = kind === 'file' || os === 'macos';
        equal(`${sourcePath}.applicability`, source.applicability, applicable ? 'required' : 'not_applicable');
        nativeEvidence(source.evidence, `${sourcePath}.evidence`);
        if (applicable) stepResults(source.steps, ['read', 'permission_denied', 'corrupt'], `${sourcePath}.steps`);
        else text(`${sourcePath}.reason`, source.reason);
      }
      nativeScenario(sources.source_switch, `${providerPath}.source_switch`);
      text(`${providerPath}.source_switch.from`, sources.source_switch.from);
      text(`${providerPath}.source_switch.to`, sources.source_switch.to);
      check(sources.source_switch.from !== sources.source_switch.to, `${providerPath}.source_switch.to`, sources.source_switch.to, '与 from 不同的来源命名空间');
      const unsupported = sources.unsupported_storage;
      const unsupportedPath = `${providerPath}.unsupported_storage`;
      object(unsupportedPath, unsupported);
      if (os === 'macos' && unsupported.applicability === 'not_applicable') {
        text(`${unsupportedPath}.reason`, unsupported.reason);
        nativeEvidence(unsupported.evidence, `${unsupportedPath}.evidence`);
      } else {
        equal(`${unsupportedPath}.applicability`, unsupported.applicability, 'required');
        nativeScenario(unsupported, unsupportedPath);
        equal(`${unsupportedPath}.does_not_report_logged_out`, unsupported.does_not_report_logged_out, true);
      }
    }
  }

  object('evidence', evidence);
  equal('schema_version', evidence.schema_version, 1);
  check(evidence.status === 'ready', '发布状态', { status: evidence.status, blockers: evidence.blockers }, 'ready 且没有未完成项');
  check(Array.isArray(evidence.blockers) && evidence.blockers.length === 0, 'blockers', evidence.blockers, []);
  identity(evidence.candidate, 'candidate');
  identity(evidence.previous_candidate, 'previous_candidate');
  check(compareVersions(evidence.previous_candidate.version, evidence.candidate.version) < 0, 'previous_candidate.version', evidence.previous_candidate.version, `低于当前候选 ${evidence.candidate.version} 的旧版本`);
  for (const key of ['channel', 'update_endpoint', 'updater_public_key_sha256']) equal(`previous_candidate.${key}`, evidence.previous_candidate[key], evidence.candidate[key]);
  proof(evidence.release_notes, 'release_notes', ['document']);
  check(Array.isArray(evidence.rows), 'rows', evidence.rows, '完整八组合数组');
  const rows = new Map();
  for (const row of evidence.rows) {
    object('rows[]', row);
    check(!rows.has(row.id), `重复 OS 组合 ${row.id}`, row.id, '每组合仅一行');
    check(targets.some(([id]) => id === row.id), 'rows[].id', row.id, targets.map(([id]) => id));
    rows.set(row.id, row);
  }
  for (const target of targets) {
    const row = rows.get(target[0]);
    const path = target[0];
    object(path, row);
    equal(`${path}.status`, row.status, 'passed');
    environment(row.environment, target, `${path}.environment`);
    bundle(row.candidate, evidence.candidate, target, `${path}.candidate`);
    bundle(row.previous_candidate, evidence.previous_candidate, target, `${path}.previous_candidate`);
    const native = jsonProof(row.native_identity, `${path}.native_identity`, 'native-identity');
    equal(`${path}.native_identity.schema_version`, native.schema_version, 1);
    equal(`${path}.native_identity.ok`, native.ok, true);
    binding(native, row.candidate, `${path}.native_identity`);
    environment(native.environment, target, `${path}.native_identity.environment`);
    const record = jsonProof(row.acceptance, `${path}.acceptance`, 'acceptance');
    equal(`${path}.acceptance.schema_version`, record.schema_version, 1);
    binding(record, row.candidate, `${path}.acceptance`);
    environment(record.environment, target, `${path}.acceptance.environment`);
    for (const key of Object.keys(row.environment)) {
      equal(`${path}.native_identity.environment.${key}`, native.environment[key], row.environment[key]);
      equal(`${path}.acceptance.environment.${key}`, record.environment[key], row.environment[key]);
    }
    text(`${path}.acceptance.installed_path`, record.installed_path);
    check(nonempty(record.recorded_at) && Number.isFinite(Date.parse(record.recorded_at)), `${path}.acceptance.recorded_at`, record.recorded_at, '真实验收时间 ISO 8601');
    for (const provider of ['openai', 'claude']) {
      text(`${path}.official_clients.${provider}.name`, record.official_clients?.[provider]?.name);
      text(`${path}.official_clients.${provider}.version`, record.official_clients?.[provider]?.version);
    }
    object(`${path}.cases`, record.cases);
    for (const [id, names] of Object.entries(requiredSteps)) {
      const result = record.cases[id];
      const casePath = `${path}.cases.${id}`;
      object(casePath, result);
      equal(`${casePath}.status`, result.status, 'passed');
      binding(result, row.candidate, casePath);
      check(Array.isArray(result.evidence) && result.evidence.length > 0 && result.evidence.some(ref => ref.kind === (id === 'P6' ? 'document' : 'native-log')),
        `${casePath}.evidence`, result.evidence, id === 'P6' ? '至少一个 document 附件' : '至少一个 native-log 附件；截图不能单独认证');
      for (const [index, ref] of result.evidence.entries()) proof(ref, `${casePath}.evidence[${index}]`, ['native-log', 'screenshot', 'document']);
      if (id === 'P2') {
        for (const provider of ['openai', 'claude']) stepResults(result.platforms?.[provider], names, `${casePath}.platforms.${provider}`);
        sourceCoverage(result.source_coverage, target[1], `${casePath}.source_coverage`);
      } else stepResults(result.steps, names, `${casePath}.steps`, id === 'P5');
      if (id === 'P3' && target[1] === 'ubuntu') {
        object(`${casePath}.tray_scenarios`, result.tray_scenarios);
        for (const state of ['present', 'absent']) nativeScenario(result.tray_scenarios[state], `${casePath}.tray_scenarios.${state}`);
      }
      if (id === 'P4') {
        object(`${casePath}.previous`, result.previous);
        for (const key of ['source_revision', 'version']) equal(`${casePath}.previous.${key}`, result.previous[key], row.previous_candidate.identity[key]);
        equal(`${casePath}.previous.installer_sha256`, result.previous.installer_sha256, row.previous_candidate.installer.file.sha256);
        equal(`${casePath}.previous.update_asset_sha256`, result.previous.update_asset_sha256, row.previous_candidate.update_asset.file.sha256);
      }
    }
  }
  return { combinations: rows.size, cases: Object.keys(requiredSteps), files: verifiedFiles.size };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    check(process.argv.length === 4 && process.argv[2] === '--evidence', '命令参数', process.argv.slice(2), '--evidence <Markdown 或 JSON 文件>');
    const path = resolve(process.argv[3]);
    const result = verifyReleaseEvidence(parseEvidence(readFileSync(path, 'utf8'), path), dirname(path));
    console.log(`发布证据完整性通过：${result.combinations} 组合，P1–P6，${result.files} 个附件 SHA-256 已核对；正式发布仍须审核签名工具原始输出及发布授权。`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
