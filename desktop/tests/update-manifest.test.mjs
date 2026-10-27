import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { test } from 'node:test';
import * as release from '../scripts/verify-release.mjs';

function fixture() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const id = Buffer.alloc(8, 3), bytes = Buffer.from('signed release candidate');
  const signature = sign(null, createHash('blake2b512').update(bytes).digest(), privateKey);
  const comment = 'timestamp:1700000000\\tfile:Bee.app.tar.gz\\tversion:0.1.0';
  return {
    manifest: { version: '0.1.0', channel: 'stable', target: 'aarch64-apple-darwin', endpoint: 'https://github.com/example/bee/releases/latest/download/stable.json', assetBase: 'https://github.com/example/bee/releases/download/v0.1.0/', publicKey: Buffer.from('untrusted comment: fixture\n' + Buffer.concat([Buffer.from('Ed'), id, publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)]).toString('base64')).toString('base64') },
    asset: { name: 'Bee.app.tar.gz', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }, bytes,
    signature: Buffer.from(`untrusted comment: fixture\n${Buffer.concat([Buffer.from('ED'), id, signature]).toString('base64')}\ntrusted comment: ${comment}\n${sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey).toString('base64')}\n`).toString('base64'),
  };
}
function make(options) {
  assert.equal(typeof release.createUpdateManifest, 'function', 'signed updater manifest generator missing');
  return release.createUpdateManifest(options);
}
test('updater manifest uses Tauri platform key and signed version/channel/target/hash/size metadata', () => {
  const f = fixture();
  const result = make(f);
  assert.equal(result.version, '0.1.0');
  assert.deepEqual(result.platforms['darwin-aarch64'], { url: f.manifest.assetBase + f.asset.name, signature: f.signature, bee: { channel: 'stable', target: 'aarch64-apple-darwin', version: '0.1.0', sha256: f.asset.sha256, size: f.bytes.length } });
});
for (const [name, edit, expected] of [
  ['version', f => { f.manifest.version = '0.2.0'; f.manifest.assetBase = f.manifest.assetBase.replace('0.1.0', '0.2.0'); }, /signed version.*0\.1\.0.*0\.2\.0/],
  ['channel', f => { f.manifest.channel = 'beta'; }, /channel/],
  ['target', f => { f.manifest.target = 'aarch64-pc-windows-msvc'; }, /target/],
  ['target format', f => { f.manifest.target = 'x86_64-pc-windows-msvc'; }, /format/],
  ['signature', f => { f.bytes = Buffer.from('wrong signed asset'); f.asset.size = f.bytes.length; f.asset.sha256 = createHash('sha256').update(f.bytes).digest('hex'); }, /signature/],
  ['size', f => { f.asset.size++; }, /size.*actual=.*required=/],
  ['hash', f => { f.asset.sha256 = '0'.repeat(64); }, /SHA256/],
  ['repository', f => { f.manifest.assetBase = f.manifest.assetBase.replace('example/bee', 'attacker/bee'); }, /repository/],
  ['endpoint filename', f => { f.manifest.endpoint = f.manifest.endpoint.replace('stable.json', 'stable-latest.json'); }, /endpoint.*filename/],
]) test(`updater manifest blocks mismatched ${name}`, () => {
  const f = fixture();
  edit(f);
  assert.throws(() => make(f), expected);
});
