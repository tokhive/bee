import logo from './assets/app-icon-dark.svg';
import { useEffect, useRef, useState } from 'react';
import { createSystemBridge } from './system/bridge';
import { onLoginReturn } from './system/lifecycle';
import { createBridgeMonitor, type BridgeView } from './system/bridgeMonitor';

declare const __BEE_BUILD_PLATFORM__: string;

export function P0Page() {
  const [bridge] = useState(createSystemBridge);
  const [loginReturned, setLoginReturned] = useState(false);
  const [receiptFailure, setReceiptFailure] = useState<string>();
  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void onLoginReturn(() => { if (!disposed) setLoginReturned(true); }).then(unlisten => {
      if (disposed) unlisten(); else stop = unlisten;
    }).catch((cause: unknown) => {
      if (!disposed) setReceiptFailure(`读取 Bee 登录返回提示失败：${String(cause)}`);
    });
    return () => { disposed = true; stop?.(); };
  }, []);
  const [view, setView] = useState<BridgeView>({ status: { state: 'starting' }, checking: false, alive: false });
  const monitor = useRef<ReturnType<typeof createBridgeMonitor> | null>(null);
  useEffect(() => {
    const current = createBridgeMonitor(bridge, setView);
    monitor.current = current;
    void current.start();
    return () => { current.dispose(); monitor.current = null; };
  }, [bridge]);
  const { status, failure, checking, alive } = view;
  const issue = failure ?? status.error;
  const labels = { starting: '正在启动管理进程…', ready: '管理协议已就绪', failed: '管理进程检查失败', stopped: '管理进程已停止' };
  return (
    <main>
      <header><img src={logo} alt="" width="52" height="52" /><div><h1>Bee</h1><p>P0 · 桌面底座验证</p></div></header>
      <section aria-label="验证状态">
        <h2>尚未开始贡献</h2>
        {loginReturned && <p role="status">已收到登录返回</p>}
        {receiptFailure && <p role="alert">{receiptFailure}</p>}
        <p>此验证页仅用于检查桌面底座，不启动贡献或连接账号。</p>
        <dl><dt>当前系统（构建目标）</dt><dd aria-label="当前系统">{__BEE_BUILD_PLATFORM__}</dd><dt>管理进程</dt><dd aria-label="管理进程">{labels[status.state]}</dd>
          {status.metadata && <><dt>内置 Bee 版本</dt><dd>{status.metadata.bee_version}</dd><dt>管理进程系统</dt><dd>{status.metadata.os}/{status.metadata.arch}</dd></>}
        </dl>
        {issue && <p role="alert">{issue.code}：{issue.message}</p>}
        <button type="button" disabled={checking} onClick={() => void monitor.current?.check()}>{checking ? '正在检查…' : status.state === 'ready' ? '检查存活' : '重新检查'}</button>
        {alive && <p role="status">管理进程响应正常</p>}
      </section>
    </main>
  );
}
