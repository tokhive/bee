import { t } from '../../i18n/index';
import { useState } from 'react';
import type { BeeClient, DesktopSnapshot } from '../../client/types';
import { downloadReport } from './report';
const checkNames = { process: '管理进程', connection: 'Hive 连接', proxy: '代理连通' };
const logNames = { CHECK_STARTED: '自检已开始', CHECK_PASSED: '演示检查通过', PROXY_UNREACHABLE: '代理连通检查失败' };
export function DiagnosticsPage({ snapshot, client }: { snapshot: DesktopSnapshot; client: BeeClient }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState('all');
  const data = snapshot.diagnostics?.value;
  async function run(type: 'runDiagnostics' | 'exportDiagnostics') {
    setBusy(true); setMessage(type === 'runDiagnostics' ? '正在运行演示自检…' : '正在生成脱敏报告…');
    try {
      const result = await client.dispatch({ type });
      if (result.kind !== 'confirmed') { setMessage(result.kind === 'failed' ? `${result.error.code}：${result.error.message}` : result.message); return; }
      if (type === 'exportDiagnostics') {
        setMessage('正在等待报告下载结果…');
        const downloaded = await downloadReport(data ?? { checks: [], logs: [] });
        setMessage(downloaded === 'completed' ? '脱敏报告已下载。' : downloaded === 'unconfirmed'
          ? '报告下载结果未确认：waitedMs=30000；请先核对下载文件夹，避免重复导出。'
          : '已发起报告文件下载；请在下载列表核对。');
      }
      else setMessage(result.message);
    } catch (cause) { setMessage(`诊断操作失败：operation=${type}，${String(cause)}；未确认完成。`); }
    finally { setBusy(false); }
  }
  return <div className="diagnostics-page">
    <div className="inline-actions"><button disabled={busy} aria-busy={busy} onClick={() => void run('runDiagnostics')}>{t(data?.checks.length ? '重试自检' : '运行自检')}</button><button disabled={busy} onClick={() => void run('exportDiagnostics')}>{t("导出脱敏报告")}</button></div>
    <p className="feature-note">{t("仅检查演示状态，不会探测真实账号或网络。报告只含检查代码与脱敏日志，不含登录凭证或请求内容。")}</p>
    <section className="settings-list" aria-label={t("检查结果")}>
      {!data?.checks.length ? <p>{t("尚未运行自检")}</p> : <><h2>{t(data.checks.every(c => c.passed) ? '所有演示检查通过' : '部分检查失败')}</h2>{data.checks.map(c => <div key={c.id}><strong>{t(checkNames[c.id])}</strong><span>{t(c.passed ? '通过（仅演示）' : '代理连通检查失败')}</span></div>)}</>}
    </section>
    <label>{t("日志级别")}<select aria-label={t("日志级别")} value={level} onChange={e => setLevel(e.target.value)}><option value="all">{t("全部日志")}</option><option value="info">info</option><option value="error">error</option></select></label>
    <ul className="diagnostic-logs" data-testid="diagnostic-logs">{data?.logs.filter(log => level === 'all' || level === log.level).map((log, i) => <li key={i}>{t(log.level)} · {t(logNames[log.code])}</li>)}</ul>
    <details><summary>{t("诊断帮助")}</summary><p>{t("检查 Hive 地址与代理后重试；真实业务问题需在接入 Bee 后重新核验。")}</p></details>
    {message && <p className="operation-message" role="status">{t(message)}</p>}
  </div>;
}
