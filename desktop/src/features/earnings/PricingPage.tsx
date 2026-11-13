import { t } from '../../i18n/index';
import { useRef, useState } from 'react';
import type { Finance, Quote } from '../../client/types';
import { FinanceHeading, type FinanceAction } from './EarningsPage';
import { amountUnits, decimalUnits, displayAmount, validFactor } from './money';
export function PricingPage({
  finance,
  action,
}: {
  finance: Finance;
  action: FinanceAction;
}) {
  const [mode, setMode] = useState<Quote['mode']>(finance.quote.mode);
  const [factor, setFactor] = useState(finance.quote.factor);
  const [version, setVersion] = useState(finance.quote.version);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const clear = () => {
    setError('');
    setMessage('');
  };
  async function save() {
    if (lock.current) return;
    clear();
    if (mode === 'custom' && !validFactor(factor)) {
      setError(
        '报价系数“{factor}”无效，要求大于 0、小于 10，且最多 9 位小数。',
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const r = await action({
        type: 'saveQuote',
        mode,
        factor,
        originalVersion: version,
      });
      if (r.kind === 'confirmed') {
        setMessage(r.message);
        setVersion(version + 1);
      } else setError(r.kind === 'failed' ? r.error.message : r.message);
    } catch (cause) {
      setError(`演示报价保存失败：${String(cause)}；未确认生效。`);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <FinanceHeading
        title={t("报价设置")}
        description={t("选择平台默认报价，或统一设置自己的报价系数")}
      />
      <div className="quote-current" data-testid="active-quote">
        <span>{t("当前已生效")}</span>
        <strong>
          {t(finance.quote.mode === 'default'
            ? '平台默认报价'
            : `自定义系数 × ${displayAmount(finance.quote.factor)}`)}
        </strong>
        <small>{t("版本 ")}{t(finance.quote.version)}</small>
      </div>
      <div className="finance-form">
        <fieldset disabled={busy || finance.quoteUnknown}>
          <legend className="sr-only">{t("报价模式")}</legend>
          <label className="quote-choice">
            <span>
              <input
                type="radio"
                aria-label={t("使用平台默认")}
                name="quote-mode"
                checked={mode === 'default'}
                onChange={() => {
                  setMode('default');
                  clear();
                }}
              />{t(' ')}{t("使用平台默认")}</span>
            <small>{t("采用平台默认系数。")}</small>
          </label>
          <div className="quote-choice">
            <label>
              <input
                type="radio"
                name="quote-mode"
                checked={mode === 'custom'}
                onChange={() => {
                  setMode('custom');
                  clear();
                }}
              />{t(' ')}{t("自定义报价系数")}</label>
            <small>{t("一个系数统一应用于全部平台、模型及计费项。")}</small>
            {mode === 'custom' && (
              <label className="finance-field">{t("报价系数")}<input
                  aria-label={t("报价系数")}
                  inputMode="decimal"
                  value={factor}
                  onChange={(e) => {
                    setFactor(e.target.value);
                    clear();
                  }}
                />
                <small>{t("大于 0、小于 10，最多 9 位小数。")}</small>
              </label>
            )}
          </div>
        </fieldset>
      </div>
      <section className="earnings-panel quote-preview">
        <div className="section-heading">
          <h3>{t("报价预览")}</h3>
          <small>{t("当前草稿 · 保存后生效")}</small>
        </div>
        <div className="finance-table">
          <table>
            <thead>
              <tr>
                <th>{t("模型 / 输入")}</th>
                <th>{t("示例基准价 / 百万 Token")}</th>
                <th>{t("你的实收 / 百万 Token")}</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['GPT-5.5', '2'],
                ['Claude Sonnet', '3'],
              ].map(([name, base]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>${t(base)}.00</td>
                  <td>
                    {t(validFactor(mode === 'default' ? '0.1' : factor)
                      ? `$${decimalUnits((amountUnits(base) * amountUnits(mode === 'default' ? '0.1' : factor)) / 1000000000n)}`
                      : '待填写有效系数')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="finance-note">{t("实收单价 = 示例基准价 × 有效系数。正式价格待 Hive 接入；保存不会修改已接收任务的结算价格。")}</p>
        <p className="finance-note" data-testid="accepted-quote">{t("已接收演示任务快照：系数 ")}{finance.acceptedQuote.factor}{t(" · 版本")}{t(' ')}
          {t(finance.acceptedQuote.version)}
        </p>
      </section>
      {error && (
        <p role="alert" className="finance-error">
          {t(error, { factor })}
        </p>
      )}
      {finance.quoteUnknown && !error && (
        <p role="alert" className="finance-error">{t("报价结果未确认；不允许覆盖保存，请核实原操作。")}</p>
      )}
      {message && <p role="status">{t(message)}</p>}
      <div className="inline-actions finance-actions">
        <button
          disabled={busy || finance.quoteUnknown}
          onClick={() => {
            setMode(finance.quote.mode);
            setFactor(finance.quote.factor);
            setVersion(finance.quote.version);
            clear();
          }}
        >{t("重新读取 / 放弃修改")}</button>
        <button
          className="primary"
          disabled={busy || finance.quoteUnknown}
          aria-busy={busy}
          onClick={() => void save()}
        >
          {t(busy ? '保存中…' : '保存报价')}
        </button>
      </div>
    </>
  );
}
