import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const checker = fileURLToPath(new URL('../scripts/verify-release-evidence.mjs', import.meta.url));
const revision = 'a'.repeat(40);
const previousRevision = 'b'.repeat(40);
const keyHash = 'c'.repeat(64);
const combinations = [
  ['macos-13-arm64', 'macos', '13.7.8', 'arm64'], ['macos-13-x64', 'macos', '13.7.8', 'x64'],
  ['windows-10-22h2-x64', 'windows', '10.0', 'x64', 19045], ['windows-11-x64', 'windows', '11.0', 'x64', 26100],
  ['ubuntu-22.04-x64', 'ubuntu', '22.04', 'x64'], ['ubuntu-22.04-arm64', 'ubuntu', '22.04', 'arm64'],
  ['ubuntu-24.04-x64', 'ubuntu', '24.04', 'x64'], ['ubuntu-24.04-arm64', 'ubuntu', '24.04', 'arm64'],
];
const steps = {
  P1: ['install', 'start', 'bundled_bee_source', 'no_automatic_contribution', 'preserve_existing_config', 'preserve_external_bee'],
  P2: ['existing_login', 'official_login', 'select_account', 'explicit_contribution', 'pause', 'resume', 'switch_account_stays_paused', 'offline', 'restart_recovery'],
  P3: ['doctor', 'log_export', 'proxy', 'language_theme', 'autostart', 'notifications', 'close_and_reopen', 'permission_denied', 'export_failure'],
  P4: ['check', 'download', 'verify_signature', 'confirm_exit', 'owned_stop', 'install', 'new_version_start', 'pairing_preserved', 'account_selection_preserved', 'pause_preserved', 'preferences_preserved', 'pending_actions_reconciled', 'runtime_recovered'],
  P5: ['wrong_signature', 'wrong_platform', 'wrong_architecture', 'interrupted_download', 'disk_failure', 'permission_failure', 'duplicate_install', 'child_reap_failure', 'old_app_new_config'],
  P6: ['release_notes', 'supported_platforms', 'installation', 'update', 'official_clients', 'known_limitations', 'package_checksums', 'signing_evidence'],
};

function fixture(t, previousVersion = '1.0.0', candidateVersion = '1.1.0') {
  const root = mkdtempSync(join(tmpdir(), 'bee-release-evidence-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let count = 0;
  const file = (content, kind = 'native-log') => {
    const path = `${++count}.proof`;
    const bytes = typeof content === 'string' ? content : JSON.stringify(content);
    writeFileSync(join(root, path), bytes);
    return { path, sha256: createHash('sha256').update(bytes).digest('hex'), kind };
  };
  const identity = (version, source_revision) => ({ version, bee_version: version, source_revision,
    build_mode: 'production', channel: 'stable', update_endpoint: 'https://updates.example.test/bee/stable.json', updater_public_key_sha256: keyHash });
  const candidate = identity(candidateVersion, revision);
  const previous_candidate = identity(previousVersion, previousRevision);
  const bundle = (id, os, arch, identity) => {
    const value = {
    identity: structuredClone(identity), os, arch,
    installer: { format: { macos: 'dmg', windows: 'nsis', ubuntu: 'appimage' }[os], file: file(`${id}/${identity.version}/installer`, 'package') },
    update_asset: { format: { macos: 'app.tar.gz', windows: 'nsis', ubuntu: 'appimage' }[os], file: file(`${id}/${identity.version}/updater`, 'package') },
    bundled_bee: { version: identity.version, source_revision: identity.source_revision, file: file(`${id}/${identity.version}/bee`, 'binary') },
    signatures: {
      updater: { verified: true, scope: 'production', public_key_sha256: keyHash, proof: file('updater signature verified') },
      ...(os === 'ubuntu' ? {} : { platform: { verified: true, scope: 'production',
        kind: os === 'macos' ? 'developer-id' : 'authenticode', identity: '正式签名身份（测试夹具）', proof: file('platform signature verified') } }),
      ...(os === 'macos' ? { notarization: { verified: true, stapled: true, proof: file('notarization and staple verified') } } : {}),
    },
    };
    for (const [kind, signature] of Object.entries(value.signatures)) {
      signature.proof = file({ schema_version: 1, verified: true, scope: 'production', signature_kind: kind,
        source_revision: identity.source_revision, version: identity.version, build_mode: 'production',
        installer_sha256: value.installer.file.sha256, update_asset_sha256: value.update_asset.file.sha256,
        bundled_bee_sha256: value.bundled_bee.file.sha256, tool: '真实签名工具（测试夹具）',
        ...(kind === 'updater' ? { public_key_sha256: keyHash } : {}),
        ...(kind === 'platform' ? { signing_identity: signature.identity } : {}),
        ...(kind === 'notarization' ? { stapled: true } : {}),
        raw_output: file(`${id}/${identity.version}/${kind}: verified with actual hashes`),
      });
    }
    return value;
  };
  const records = [];
  const natives = [];
  const rows = combinations.map(([id, os, version, arch, build]) => {
    const environment = { os, version, arch, execution: 'native-desktop', container: false, emulated: false,
      display: { macos: 'aqua', windows: 'windows', ubuntu: 'wayland' }[os],
      ...(os === 'windows' ? { windows_build: build, windows_product_type: 1 } : {}) };
    const current = bundle(id, os, arch, candidate);
    const previous = bundle(id, os, arch, previous_candidate);
    const binding = { source_revision: revision, version: candidate.version, build_mode: 'production',
      installer_sha256: current.installer.file.sha256, update_asset_sha256: current.update_asset.file.sha256 };
    const native = { schema_version: 1, ok: true, ...binding, environment };
    natives.push(native);
    const results = names => Object.fromEntries(names.map(name => [name, { status: 'passed', actual: `已观察并核对 ${name}` }]));
    const cases = Object.fromEntries(Object.entries(steps).map(([id, names]) => [id, {
      status: 'passed', ...binding, evidence: [file(`${id} detailed transcript`, id === 'P6' ? 'document' : 'native-log')],
      ...(id === 'P2' ? { platforms: { openai: results(names), claude: results(names) } } : { steps: results(names) }),
    }]));
    const observed = description => ({ status: 'passed', actual: description, evidence: [file(description)] });
    cases.P2.source_coverage = Object.fromEntries(['openai', 'claude'].map(provider => [provider, {
      file: { store: 'file', applicability: 'required', steps: results(['read', 'permission_denied', 'corrupt']), evidence: [file(`${provider} 文件来源读写／权限／损坏实测`)] },
      keychain: { store: provider === 'openai' ? 'keyring' : 'keychain',
        ...(os === 'macos' ? { applicability: 'required', steps: results(['read', 'permission_denied', 'corrupt']) }
          : { applicability: 'not_applicable', reason: '当前候选仅在 macOS 支持 Keychain，已核对来源能力输出' }),
        evidence: [file(`${provider} ${os} Keychain 能力与实际状态`)] },
      source_switch: { ...observed('已切换所选来源并核对实际使用的新来源'), from: 'source-A', to: 'source-B' },
      unsupported_storage: { applicability: 'required', ...observed('不支持的存储方式明确显示不支持来源'), does_not_report_logged_out: true },
    }]));
    if (os === 'ubuntu') cases.P3.tray_scenarios = {
      present: observed('有托盘时关窗后由托盘找回窗口'),
      absent: observed('无托盘时仍可找回窗口并核对实际运行状态'),
    };
    cases.P4.previous = { source_revision: previousRevision, version: previous_candidate.version,
      installer_sha256: previous.installer.file.sha256, update_asset_sha256: previous.update_asset.file.sha256 };
    Object.values(cases.P5.steps).forEach(value => Object.assign(value, { data_preserved: true, no_false_success: true }));
    const record = { schema_version: 1, recorded_at: '2026-10-27T02:00:00.000Z', environment, ...binding,
      installed_path: os === 'windows' ? 'C:\\Users\\tester\\AppData\\Local\\Bee\\Bee.exe' : os === 'macos' ? '/Applications/Bee.app' : '/home/tester/Applications/Bee.AppImage',
      official_clients: { openai: { name: 'Codex', version: '1.0.0' }, claude: { name: 'Claude', version: '1.0.0' } }, cases };
    records.push(record);
    return { id, status: 'passed', environment, candidate: current, previous_candidate: previous,
      native_identity: file(native, 'native-identity'), acceptance: file(record, 'acceptance') };
  });
  const evidence = { schema_version: 1, status: 'ready', blockers: [], candidate, previous_candidate,
    release_notes: file('完整中文发布说明', 'document'), rows };
  const refresh = () => rows.forEach((row, index) => { row.acceptance = file(records[index], 'acceptance'); row.native_identity = file(natives[index], 'native-identity'); });
  const run = (markdown = false) => {
    refresh();
    const path = join(root, markdown ? 'evidence.md' : 'evidence.json');
    writeFileSync(path, markdown ? `# 发布证据\n\n\`\`\`json bee-release-evidence\n${JSON.stringify(evidence)}\n\`\`\`\n` : JSON.stringify(evidence));
    const result = spawnSync(process.execPath, [checker, '--evidence', path], { encoding: 'utf8' });
    return { ...result, output: result.stdout + result.stderr };
  };
  return { root, evidence, rows, records, natives, file, run };
}

test('完整八组合及 P1–P6 同候选证据允许通过 JSON 和 Markdown 入口', t => {
  const f = fixture(t);
  for (const markdown of [false, true]) {
    const r = f.run(markdown);
    assert.equal(r.status, 0, r.output);
    assert.match(r.output, /8.*P1.*P6/);
  }
});

const invalid = [
  ['缺 OS 组合', f => f.rows.pop(), /ubuntu-24\.04-arm64/],
  ['重复 OS 组合', f => { f.rows[7] = f.rows[6]; }, /重复.*ubuntu-24\.04-x64/],
  ['错架构', f => { f.rows[0].environment.arch = 'x64'; }, /macos-13-arm64.*arch.*x64/],
  ['较新 macOS 不能替代最低系统', f => { f.rows[0].environment.version = '15.7'; }, /version.*15\.7.*13/],
  ['Windows Server 不能替代 Windows 11', f => { f.rows[3].environment.windows_product_type = 3; }, /windows_product_type.*3.*1/],
  ['Windows 10 错 build', f => { f.rows[2].environment.windows_build = 19044; }, /windows_build.*19044.*19045/],
  ['Ubuntu 容器不能冒充真实桌面', f => { f.rows[4].environment.container = true; }, /container.*true.*false/],
  ['Xvfb 不能冒充真实桌面', f => { f.rows[4].environment.display = 'xvfb'; }, /display.*xvfb/],
  ['仿真不能代替原生', f => { f.rows[0].environment.emulated = true; }, /emulated.*true.*false/],
  ['原生证明与声明不符', f => { f.natives[0].environment = { ...f.natives[0].environment, execution: 'container' }; }, /native_identity.*environment.*container/],
  ['错源码', f => { f.rows[0].candidate.identity.source_revision = previousRevision; }, /source_revision.*bbbb/],
  ['demo 不能当正式包', f => { f.evidence.candidate.build_mode = 'demo'; }, /build_mode.*demo.*production/],
  ['App 与 Bee 版本不配套', f => { f.rows[0].candidate.bundled_bee.version = '0.1.0'; }, /bundled_bee.version.*0\.1\.0/],
  ['不同渠道', f => { f.rows[0].candidate.identity.channel = 'test'; }, /channel.*test.*stable/],
  ['无正式更新地址', f => { f.evidence.candidate.update_endpoint = 'http://localhost/test'; }, /update_endpoint.*http:\/\/localhost/],
  ['包 hash 不匹配', f => { f.rows[0].candidate.installer.file.sha256 = 'd'.repeat(64); }, /sha256.*dddd.*实际/],
  ['更新未签名', f => { f.rows[0].candidate.signatures.updater.verified = false; }, /updater.verified.*false.*true/],
  ['测试签名不能正式发布', f => { f.rows[0].candidate.signatures.updater.scope = 'test'; }, /updater.scope.*test.*production/],
  ['更新公钥不匹配', f => { f.rows[0].candidate.signatures.updater.public_key_sha256 = 'e'.repeat(64); }, /public_key_sha256.*eeee/],
  ['旧签名日志不能认证新包', f => { f.rows[0].candidate.signatures.updater.proof = f.rows[0].previous_candidate.signatures.updater.proof; }, /updater.proof.source_revision.*bbbb/],
  ['签名摘要必须匹配实际被验资产', f => {
    const ref = f.rows[0].candidate.signatures.updater.proof;
    const report = JSON.parse(readFileSync(join(f.root, ref.path), 'utf8'));
    report.update_asset_sha256 = 'e'.repeat(64);
    f.rows[0].candidate.signatures.updater.proof = f.file(report);
  }, /updater.proof.update_asset_sha256.*eeee/],
  ['缺 Developer ID', f => { delete f.rows[0].candidate.signatures.platform; }, /signatures.platform/],
  ['缺 Authenticode', f => { f.rows[2].candidate.signatures.platform.verified = false; }, /platform.verified.*false/],
  ['缺公证', f => { f.rows[0].candidate.signatures.notarization.verified = false; }, /notarization.verified.*false/],
  ['旧候选未签名', f => { f.rows[0].previous_candidate.signatures.updater.verified = false; }, /previous_candidate.*updater.verified/],
  ['旧包截图不能认证新包', f => { f.records[0].cases.P1.installer_sha256 = f.rows[0].previous_candidate.installer.file.sha256; }, /P1.installer_sha256/],
  ['只有截图不能证明主流程', f => { f.records[0].cases.P2.evidence = [f.file('old image', 'screenshot')]; }, /P2.evidence.*native-log/],
  ['P2 不能缺一个平台', f => { delete f.records[0].cases.P2.platforms.claude; }, /P2.platforms.claude/],
  ['P2 不能只写正常文件来源', f => { delete f.records[0].cases.P2.source_coverage; }, /P2.source_coverage/],
  ['文件来源损坏场景不可省略', f => { delete f.records[0].cases.P2.source_coverage.openai.file.steps.corrupt; }, /source_coverage.openai.file.steps.corrupt/],
  ['Keychain 权限拒绝场景不可省略', f => { delete f.records[0].cases.P2.source_coverage.claude.keychain.steps.permission_denied; }, /source_coverage.claude.keychain.steps.permission_denied/],
  ['适用 Keychain 不能伪报不适用', f => { f.records[0].cases.P2.source_coverage.openai.keychain.applicability = 'not_applicable'; }, /keychain.applicability.*not_applicable.*required/],
  ['不适用来源必须给出依据', f => { delete f.records[4].cases.P2.source_coverage.claude.keychain.reason; }, /keychain.reason/],
  ['来源切换不可省略', f => { delete f.records[0].cases.P2.source_coverage.claude.source_switch; }, /source_coverage.claude.source_switch/],
  ['来源切换必须有原生证据', f => { f.records[0].cases.P2.source_coverage.openai.source_switch.evidence = [f.file('截图', 'screenshot')]; }, /source_switch.evidence.*native-log/],
  ['不支持来源不可显示成未登录', f => { f.records[4].cases.P2.source_coverage.openai.unsupported_storage.does_not_report_logged_out = false; }, /unsupported_storage.does_not_report_logged_out.*false/],
  ['非 macOS 不支持的 Keychain 状态不能跳过', f => { f.records[4].cases.P2.source_coverage.openai.unsupported_storage.applicability = 'not_applicable'; }, /unsupported_storage.applicability.*not_applicable.*required/],
  ['来源切换不能把同一来源填两次', f => { f.records[0].cases.P2.source_coverage.openai.source_switch.to = 'source-A'; }, /source_switch.to.*source-A/],
  ['Linux 必须同时验证有无托盘', f => { delete f.records[4].cases.P3.tray_scenarios.absent; }, /P3.tray_scenarios.absent/],
  ['Linux 无托盘必须有独立原生证据', f => { f.records[4].cases.P3.tray_scenarios.absent.evidence = []; }, /tray_scenarios.absent.evidence.*native-log/],
  ['官方客户端版本缺失', f => { f.records[0].official_clients.openai.version = ''; }, /official_clients.openai.version/],
  ['旧候选相同版本不能证明升级', f => { f.evidence.previous_candidate = structuredClone(f.evidence.candidate); }, /previous_candidate.version/],
  ['P4 旧包身份不符', f => { f.records[0].cases.P4.previous.version = '0.0.1'; }, /P4.previous.version.*0\.0\.1/],
  ['P5 不能假报数据无损', f => { f.records[0].cases.P5.steps.wrong_signature.data_preserved = false; }, /wrong_signature.data_preserved.*false/],
  ['P5 不能将失败显示为成功', f => { f.records[0].cases.P5.steps.child_reap_failure.no_false_success = false; }, /child_reap_failure.no_false_success.*false/],
  ['pending 不得当完成', f => { f.evidence.status = 'pending'; f.evidence.blockers = ['缺正式签名密钥']; }, /pending.*缺正式签名密钥/],
  ['失败不能以 passed 标题掩盖', f => { f.records[0].cases.P3.steps.proxy.status = 'failed'; }, /P3.steps.proxy.status.*failed/],
  ['空操作结果不能通过', f => { f.records[0].cases.P1.steps.install.actual = ''; }, /P1.steps.install.actual/],
];
for (const [name, mutate, expected] of invalid) test(name, t => {
  const f = fixture(t);
  mutate(f);
  const result = f.run();
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, expected);
});

test('较新版本不能伪装旧候选', t => {
  const f = fixture(t, '2.0.0');
  const r = f.run();
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /previous_candidate.version.*2\.0\.0/);
});

test('macOS 不适用的不支持来源入口必须有能力依据和原生证据', t => {
  const f = fixture(t);
  f.records[0].cases.P2.source_coverage.openai.unsupported_storage = {
    applicability: 'not_applicable', reason: '本客户端的原生入口仅支持已覆盖的 file/keyring；能力清单附后',
    evidence: [f.file('客户端能力与 UI 入口核对原生日志')],
  };
  assert.equal(f.run().status, 0);
  delete f.records[0].cases.P2.source_coverage.openai.unsupported_storage.reason;
  const r = f.run();
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /unsupported_storage.reason/);
});

for (const [previous, candidate] of [['1.0.9', '1.0.10'], ['1.1.0-rc.2', '1.1.0-rc.10'], ['1.1.0-rc.1', '1.1.0']]) {
  test(`允许正式升级顺序 ${previous} → ${candidate}`, t => {
    const f = fixture(t, previous, candidate);
    const r = f.run();
    assert.equal(r.status, 0, r.output);
  });
}

for (const version of ['01.0.0', '1.0.0-rc.01', '1.0.0-rc..1']) test(`拒绝无效语义版本 ${version}`, t => {
  const f = fixture(t, version);
  const r = f.run();
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /previous_candidate.version/);
});

for (const id of Object.keys(steps)) test(`${id} 任一主流程缺失即拒绝`, t => {
  const f = fixture(t);
  delete f.records[0].cases[id];
  const r = f.run();
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, new RegExp(`cases.${id}`));
});

for (const id of Object.keys(steps)) test(`${id} 缺少一个操作步骤即拒绝`, t => {
  const f = fixture(t);
  const group = id === 'P2' ? f.records[0].cases[id].platforms.openai : f.records[0].cases[id].steps;
  const step = steps[id].at(-1);
  delete group[step];
  const r = f.run();
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, new RegExp(`${id}.*${step}`));
});

for (const provider of ['openai', 'claude']) for (const store of ['file', 'keychain']) for (const step of ['read', 'permission_denied', 'corrupt']) {
  test(`${provider}/${store} 缺少 ${step} 原生子场景即拒绝`, t => {
    const f = fixture(t);
    delete f.records[0].cases.P2.source_coverage[provider][store].steps[step];
    const r = f.run();
    assert.equal(r.status, 1, r.output);
    assert.match(r.output, new RegExp(`source_coverage.${provider}.${store}.steps.${step}`));
  });
}

for (const provider of ['openai', 'claude']) for (const scenario of ['source_switch', 'unsupported_storage']) {
  test(`${provider} 必须明确记录 ${scenario}`, t => {
    const f = fixture(t);
    delete f.records[0].cases.P2.source_coverage[provider][scenario];
    const r = f.run();
    assert.equal(r.status, 1, r.output);
    assert.match(r.output, new RegExp(`source_coverage.${provider}.${scenario}`));
  });
}

test('Linux 有托盘分支也不可省略', t => {
  const f = fixture(t);
  delete f.records[4].cases.P3.tray_scenarios.present;
  const r = f.run();
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /P3.tray_scenarios.present/);
});

test('证据附件文件不存在时保留具体路径和系统错误', t => {
  const f = fixture(t);
  rmSync(join(f.root, f.rows[0].candidate.installer.file.path));
  const r = f.run();
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /installer.file.*ENOENT/);
});

for (const mode of ['absolute', 'traversal', 'file-symlink', 'directory-symlink']) test(`拒绝证据目录外附件 ${mode}`, t => {
  const f = fixture(t);
  const outside = mkdtempSync(join(tmpdir(), 'bee-outside-evidence-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  const content = '目录外发布说明';
  const externalFile = join(outside, 'outside.md');
  writeFileSync(externalFile, content);
  const reference = { sha256: createHash('sha256').update(content).digest('hex'), kind: 'document' };
  if (mode === 'absolute') reference.path = externalFile;
  if (mode === 'traversal') reference.path = relative(f.root, externalFile);
  if (mode === 'file-symlink') {
    symlinkSync(externalFile, join(f.root, 'linked.md'));
    reference.path = 'linked.md';
  }
  if (mode === 'directory-symlink') {
    symlinkSync(outside, join(f.root, 'linked-directory'), 'dir');
    reference.path = 'linked-directory/outside.md';
  }
  f.evidence.release_notes = reference;
  const r = f.run();
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /release_notes.path/);
  assert.match(r.output, /允许.*根目录|根目录.*允许/);
  assert.ok(r.output.includes(reference.path), r.output);
  assert.ok(r.output.includes(f.root), r.output);
});

test('目录内符号链接也不能作为可交付的证据附件', t => {
  const f = fixture(t);
  const original = f.evidence.release_notes.path;
  symlinkSync(original, join(f.root, 'inside-link.md'));
  f.evidence.release_notes.path = 'inside-link.md';
  const r = f.run();
  assert.equal(r.status, 1, r.output);
  assert.match(r.output, /release_notes.path.*符号链接/);
});

test('证据目录内的普通子目录附件继续通过', t => {
  const f = fixture(t);
  mkdirSync(join(f.root, 'records'));
  const original = f.evidence.release_notes.path;
  writeFileSync(join(f.root, 'records/notes.md'), readFileSync(join(f.root, original)));
  f.evidence.release_notes.path = 'records/notes.md';
  const r = f.run();
  assert.equal(r.status, 0, r.output);
});

test('Markdown 必须且只能有一个明确的证据 JSON 围栏', t => {
  const f = fixture(t);
  const path = join(f.root, 'ambiguous.md');
  for (const body of ['# 无机器证据', '```json bee-release-evidence\n{}\n```\n```json bee-release-evidence\n{}\n```']) {
    writeFileSync(path, body);
    const r = spawnSync(process.execPath, [checker, '--evidence', path], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /证据 JSON 围栏.*实际.*[02]/);
  }
});

test('仓库实际验证文档的 pending 状态必须非零退出', () => {
  const path = fileURLToPath(new URL('../../docs/desktop/release-validation.md', import.meta.url));
  const contents = readFileSync(path, 'utf8');
  const document = JSON.parse(/^```json bee-release-evidence\s*\n([\s\S]*?)^```/m.exec(contents)[1]);
  const r = spawnSync(process.execPath, [checker, '--evidence', path], { encoding: 'utf8' });
  assert.equal(r.status, document.status === 'pending' ? 1 : 0, r.stdout + r.stderr);
  if (document.status === 'pending') assert.match(r.stderr, /pending/);
});
