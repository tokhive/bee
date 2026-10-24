import { isTauri } from '@tauri-apps/api/core';
import { createSystemBridge, type Unlisten } from '../../system/bridge';

export type CheckId = 'process' | 'connection' | 'proxy';
export type LogCode = 'CHECK_STARTED' | 'CHECK_PASSED' | 'PROXY_UNREACHABLE';
export interface SafeCheck { id: CheckId; passed: boolean }
export interface SafeLog { level: 'info' | 'error'; code: LogCode }
export interface SanitizedDiagnostics { checks: SafeCheck[]; logs: SafeLog[] }
/** Structured allowlist, no free-form text, account data, payloads, or headers accepted. */
export function sanitizedDiagnostics(checks: SafeCheck[], logs: SafeLog[]): SanitizedDiagnostics {
  return {
    checks: checks.filter(c => ['process', 'connection', 'proxy'].includes(c.id)).map(c => ({ id: c.id, passed: c.passed === true })),
    logs: logs.filter(l => ['CHECK_STARTED', 'CHECK_PASSED', 'PROXY_UNREACHABLE'].includes(l.code) && ['info', 'error'].includes(l.level)).map(l => ({ level: l.level, code: l.code })),
  };
}
export function generateReport(input: SanitizedDiagnostics) {
  return JSON.stringify({ product: 'Bee', mode: 'demo', ...sanitizedDiagnostics(input.checks, input.logs) }, null, 2);
}
export async function downloadReport(input: SanitizedDiagnostics): Promise<'completed' | 'initiated' | 'unconfirmed'> {
  const blob = new Blob([generateReport(input)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  let unlisten: Unlisten | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    let completion: Promise<'completed' | 'failed' | 'unconfirmed'> | undefined;
    if (isTauri()) {
      let finish!: (result: 'completed' | 'failed' | 'unconfirmed') => void;
      completion = new Promise(resolve => { finish = resolve; });
      unlisten = await createSystemBridge().onDownload(result => {
        if (result.url === url) finish(result.success ? 'completed' : 'failed');
      });
      // Absence of a receipt is unknown, never proof of failure or delivery.
      timer = setTimeout(() => finish('unconfirmed'), 30_000);
    }
    const a = document.createElement('a'); a.href = url; a.download = 'bee-demo-diagnostics.json';
    document.body.append(a); try { a.click(); } finally { a.remove(); }
    if (!completion) return 'initiated';
    const result = await completion;
    if (result === 'failed') throw new Error('原生报告下载失败：success=false；未确认文件交付，请检查下载文件夹后重试。');
    return result;
  } finally {
    clearTimeout(timer);
    unlisten?.();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
