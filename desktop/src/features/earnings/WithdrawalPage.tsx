import { t } from '../../i18n/index';
import { useState } from 'react';
import { FinanceHeading } from './EarningsPage';
import { displayAmount } from './money';
export function WithdrawalPage({ balance }: { balance: string }) {
  const [amount, setAmount] = useState('');
  const [submitted, setSubmitted] = useState(false);
  return (
    <>
      <FinanceHeading title={t("提现")} description={t("演示数据")} />
      <form
        className="finance-form"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
        }}
      >
        <div className="finance-summary-box">
          <div className="finance-row">
            <span>{t("收益余额")}</span>
            <strong>${displayAmount(balance)}</strong>
          </div>
          <div className="finance-row">
            <span>{t("收款方式")}</span>
            <strong>{t("暂未开放")}</strong>
          </div>
        </div>
        <label className="finance-field">{t("提现金额")}<input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <div className="finance-actions">
          <button className="primary" type="submit">{t("提交提现")}</button>
        </div>
        {submitted && (
          <p role="alert" className="finance-error">{t("暂不支持提现")}</p>
        )}
      </form>
    </>
  );
}
