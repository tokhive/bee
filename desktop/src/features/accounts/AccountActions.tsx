import type { Account, DesktopCommand, Platform } from '../../client/types';
import { ConfirmDialog } from '../../components/ConfirmDialog';
export type AccountDispatch = (command: DesktopCommand) => Promise<void>;
export function AccountActions({
  platform,
  account,
  busy,
  dispatch,
}: {
  platform: Platform;
  account?: Account;
  busy: boolean;
  dispatch: AccountDispatch;
}) {
  return (
    <div className="inline-actions">
      <button disabled={busy} onClick={() => void dispatch({ type: 'detectAccount', platform })}>
        检测已有登录
      </button>
      <button disabled={busy} onClick={() => void dispatch({ type: 'authorizeAccount', platform })}>
        官方授权接入
      </button>
      {!account && (
        <button disabled={busy} onClick={() => void dispatch({ type: 'connectAccount', platform })}>
          接入账号
        </button>
      )}
      {account?.pendingChange && !account.removal && (
        <ConfirmDialog
          trigger={<button disabled={busy}>确认换号</button>}
          title="切换 AI 账号？"
          description={`当前账号：${account.identifier}；新检测账号：${account.pendingChange.identifier}。确认后停止新任务，更换 Bee 接入账号并保持暂停，历史收益继续保留。`}
          confirmLabel="确认切换"
          busy={busy}
          onConfirm={() => dispatch({ type: 'confirmAccountChange', platform })}
        />
      )}
      {account && !account.removal && (
        <ConfirmDialog
          trigger={
            <button className="quiet" disabled={busy}>
              移除账号
            </button>
          }
          title="移除 AI 账号？"
          description="停止新任务，等待已有任务收尾后移除 Bee 接入。官方客户端登录和历史收益会保留；不会退出或修改官方客户端。"
          confirmLabel="确认移除"
          busy={busy}
          onConfirm={() => dispatch({ type: 'removeAccount', platform })}
        />
      )}
    </div>
  );
}
