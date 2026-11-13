import { t } from '../../i18n/index';
import { useRef, useState } from 'react';
import type { Finance, TransferInput } from '../../client/types';
import { Dialog } from 'radix-ui';
import { useTransferIntent } from './transferIntent';
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
  const [prepared, setPrepared] = useState<TransferInput | null>(null);
  const guard = useTransferIntent(finance.identity);
  const pending = guard.intent
    ? {
        ...guard.intent,
        status:
          finance.pendingTransfer?.requestId === guard.intent.requestId
            ? finance.pendingTransfer.status
            : 'unknown',
      }
    : finance.pendingTransfer;
  const blocked = !!pending || !!guard.error;
  const clear = () => {
    setError('');
    setMessage('');
    setPrepared(null);
  };
  function validate() {
    clear();
    if (!validAmount(amount)) {
      setError(
        '划转金额“{amount}”无效：必须大于 0，最多 15 位整数、9 位小数，无前导零或科学计数法。',
      );
      return;
    }
    if (amountUnits(amount) > amountUnits(balance)) {
      setError(
        `划转金额 ${amount} 超过可用收益 ${displayAmount(balance)} USD。`,
      );
      return;
    }
    setPrepared({
      ...finance.identity,
      amount,
      requestId: crypto.randomUUID(),
    });
  }
  async function execute(check = false) {
    const op = check ? pending : prepared;
    if (!op || lock.current || guard.error) return;
    const original = {
      hive: op.hive,
      user: op.user,
      requestId: op.requestId,
      amount: op.amount,
    };
    if (!guard.intent && !guard.begin(original)) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const r = await action({
        type: check ? 'checkTransfer' : 'transferEarnings',
        ...original,
      });
      guard.settle(original, r, check ? 'check' : 'submit');
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
        title={t("划转至买家余额")}
        description={t("同一 Hive 账号内的余额划转 · 演示数据")}
      />
      <div className="finance-form">
        <div className="finance-summary-box">
          <div className="finance-row">
            <span>{t("可划转收益")}</span>
            <strong data-testid="transfer-available">
              ${displayAmount(balance)}
            </strong>
          </div>
          <div className="finance-row">
            <span>{t("买家余额")}</span>
            <strong>${displayAmount(finance.buyerBalance)}</strong>
          </div>
          <div className="finance-row">
            <span>{t("转入账号")}</span>
            <strong>{finance.identity.user}{t(" · 当前账号")}</strong>
          </div>
        </div>
        <div className="finance-field">
          <div className="finance-row">
            <label htmlFor="transfer-amount">{t("划转金额")}</label>
            <button
              className="quiet"
              disabled={busy || blocked}
              onClick={() => {
                clear();
                setAmount(displayAmount(balance));
              }}
            >{t("全部收益")}</button>
          </div>
          <input
            id="transfer-amount"
            inputMode="decimal"
            aria-describedby="transfer-hint"
            value={pending?.amount ?? amount}
            disabled={busy || blocked}
            onChange={(e) => {
              clear();
              setAmount(e.target.value);
            }}
          />
          <small id="transfer-hint">{t("金额以 USD 计价，最多 9 位小数；完成后不可撤回。")}</small>
        </div>
        {(error || guard.error) && (
          <p role="alert" className="finance-error">
            {t(error, { amount })} {t(guard.error)}
          </p>
        )}
        {message && (
          <p role="status" className="finance-note">
            {t(message)}
          </p>
        )}
        {pending ? (
          <>
            <p className="finance-note" data-testid="pending-transfer">
              {t(pending.status === 'pending' ? '处理中' : '结果未确认')} ·
              requestId={pending.requestId}{t(" · 原金额 ")}{pending.amount}
            </p>
            <div className="inline-actions finance-actions">
              <button
                disabled={busy || !!guard.error}
                onClick={() => void execute(true)}
              >{t("刷新原操作")}</button>
              <button
                disabled={busy || !!guard.error}
                aria-busy={busy}
                onClick={() => void execute(true)}
              >{t("核对原操作")}</button>
            </div>
          </>
        ) : (
          <div className="finance-actions">
            <button
              className="primary"
              disabled={busy || blocked}
              onClick={validate}
            >{t("核对划转")}</button>
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
                <Dialog.Title>{t("确认划转")}</Dialog.Title>
                <Dialog.Description>{t("演示金额 ")}{prepared.amount}{t(" USD 将转入同一 Hive 账号")}{t(' ')}
                  {prepared.user}{t(" 的买家余额，完成后不可撤回。")}</Dialog.Description>
                <div className="dialog-actions">
                  <button disabled={busy} onClick={() => setPrepared(null)}>{t("取消")}</button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void execute().then(() => setPrepared(null))}
                  >
                    {t(busy ? '处理中…' : '确认划转')}
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
