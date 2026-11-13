import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const beeRoot = fileURLToPath(new URL('../../', import.meta.url));
export const isMain = url => process.argv[1] && resolve(process.argv[1]) === fileURLToPath(url);

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: beeRoot, encoding: 'utf8', timeout: 120_000, maxBuffer: 128 * 1024 * 1024, windowsHide: true, ...options });
  if (result.error || result.status !== 0) {
    const detail = [result.error?.message, result.stderr?.toString().trim(), result.signal && `signal=${result.signal}`].filter(Boolean).join('; ');
    throw new Error(`${command} ${args.join(' ')} failed: exit=${result.status}; ${detail}`);
  }
  return result.stdout;
}

export function cli(action) {
  try { action(); } catch (error) { console.error(error.stack ?? String(error)); process.exitCode = 1; }
}
