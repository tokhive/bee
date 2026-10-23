import { useRef, useState } from 'react';
import type { Finance } from '../../client/types';
import { Dialog } from 'radix-ui';
import { FinanceHeading, type FinanceAction } from './EarningsPage';
import { amountUnits, displayAmount, validAmount } from './money';
export function TransferPage({
  finance,
  balance,
  action,
}: {
  finance: Finance;
  balance: string;
  action: FinanceAction;
}) {
  const [amount, setAmount] = useState(finance.pendingTransfer?.amount ?? '');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [prepared, setPrepared] = useState<{
    amount: string;
    requestId: string;
  } | null>(null);
  const pending = finance.pendingTransfer;
  const clear = () => {
    setError('');
    setMessage('');
    setPrepared(null);
  };
  function validate() {
    clear();
    if (!validAmount(amount)) {
      setError(
        `划转金额“${amount}”无效：必须大于 0，最多 15 位整数、9 位小数，无前导零或科学计数法。`,
      );
      return;
    }
    if (amountUnits(amount) > amountUnits(balance)) {
      setError(
        `划转金额 ${amount} 超过可用收益 ${displayAmount(balance)} USD。`,
      );
      return;
    }
    setPrepared({ amount, requestId: crypto.randomUUID() });
  }
  async function execute(check = false) {
    const op = check ? pending : prepared;
    if (!op || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const r = await action({
        type: check ? 'checkTransfer' : 'transferEarnings',
        ...finance.identity,
        requestId: op.requestId,
        amount: op.amount,
      });
      if (r.kind === 'failed') setError(r.error.message);
      else setMessage(r.message);
      if (r.kind === 'confirmed') {
        setAmount('');
        setPrepared(null);
      }
    } catch (cause) {
      setError(
        `演示划转结果未确认：${String(cause)}；原 requestId=${op.requestId}，金额=${op.amount}，请核对原操作。`,
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <FinanceHeading
        title="划转至买家余额"
        description="同一 Hive 账号内的余额划转 · 演示数据"
      />
      <div className="finance-form">
        <div className="finance-summary-box">
          <div className="finance-row">
            <span>可划转收益</span>
            <strong data-testid="transfer-available">
              ${displayAmount(balance)}
            </strong>
          </div>
          <div className="finance-row">
            <span>买家余额</span>
            <strong>${displayAmount(finance.buyerBalance)}</strong>
          </div>
          <div className="finance-row">
            <span>转入账号</span>
            <strong>{finance.identity.user} · 当前账号</strong>
          </div>
        </div>
        <div className="finance-field">
          <div className="finance-row">
            <label htmlFor="transfer-amount">划转金额</label>
            <button
              className="quiet"
              disabled={busy || !!pending}
              onClick={() => {
                clear();
                setAmount(displayAmount(balance));
              }}
            >
              全部收益
            </button>
          </div>
          <input
            id="transfer-amount"
            inputMode="decimal"
            aria-describedby="transfer-hint"
            value={pending?.amount ?? amount}
            disabled={busy || !!pending}
            onChange={(e) => {
              clear();
              setAmount(e.target.value);
            }}
          />
          <small id="transfer-hint">
            金额以 USD 计价，最多 9 位小数；完成后不可撤回。
          </small>
        </div>
        {error && (
          <p role="alert" className="finance-error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="finance-note">
            {message}
          </p>
        )}
        {pending ? (
          <>
            <p className="finance-note" data-testid="pending-transfer">
              {pending.status === 'pending' ? '处理中' : '结果未确认'} ·
              requestId={pending.requestId} · 原金额 {pending.amount}
            </p>
            <div className="inline-actions finance-actions">
              <button
                disabled={busy}
                onClick={() => void action({ type: 'refresh' })}
              >
                刷新原操作
              </button>
              <button
                disabled={busy}
                aria-busy={busy}
                onClick={() => void execute(true)}
              >
                核对原操作
              </button>
            </div>
          </>
        ) : (
          <div className="finance-actions">
            <button className="primary" disabled={busy} onClick={validate}>
              核对划转
            </button>
          </div>
        )}
        {prepared && (
          <Dialog.Root
            open
            onOpenChange={(open) => {
              if (!open && !busy) setPrepared(null);
            }}
          >
            <Dialog.Portal>
              <Dialog.Overlay className="dialog-overlay" />
              <Dialog.Content className="dialog-content" aria-busy={busy}>
                <Dialog.Title>确认划转</Dialog.Title>
                <Dialog.Description>
                  演示金额 {prepared.amount} USD 将转入同一 Hive 账号{' '}
                  {finance.identity.user} 的买家余额，完成后不可撤回。
                </Dialog.Description>
                <div className="dialog-actions">
                  <button disabled={busy} onClick={() => setPrepared(null)}>
                    取消
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void execute().then(() => setPrepared(null))}
                  >
                    {busy ? '处理中…' : '确认划转'}
                  </button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        )}
      </div>
    </>
  );
}
