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
export function downloadReport(input: SanitizedDiagnostics) {
  const blob = new Blob([generateReport(input)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a'); a.href = url; a.download = 'bee-demo-diagnostics.json';
    document.body.append(a); try { a.click(); } finally { a.remove(); }
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
