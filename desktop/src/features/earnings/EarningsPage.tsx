import { t } from '../../i18n/index';
import { useState } from 'react';
import type {
  BeeClient,
  DesktopSnapshot,
  OperationResult,
  Platform,
} from '../../client/types';
import { StatusView } from '../../components/StatusView';
import { PricingPage } from './PricingPage';
import { TransferPage } from './TransferPage';
import { WithdrawalPage } from './WithdrawalPage';
import { amountUnits, decimalUnits, displayAmount } from './money';

export type FinanceAction = (
  command: Parameters<BeeClient['dispatch']>[0],
) => Promise<OperationResult>;
export function EarningsPage({
  snapshot,
  client,
}: {
  snapshot: DesktopSnapshot;
  client: BeeClient;
}) {
  const [sub, setSub] = useState('summary');
  const [range, setRange] = useState<7 | 30>(7);
  const [platform, setPlatform] = useState<'all' | Platform>('all');
  const [ledger, setLedger] = useState('settlement');
  const [page, setPage] = useState(1);
  const refresh = () => {
    void client.dispatch({ type: 'refresh' });
  };
  const state = snapshot.finance;
  if (state.status === 'loading')
    return <StatusView kind="loading" title={t("正在读取收益")} />;
  if (state.status === 'error')
    return (
      <StatusView kind="error" title={t("收益读取失败")} onRetry={refresh}>
        {t(state.error.message)}
      </StatusView>
    );
  if (snapshot.earnings.status !== 'ready')
    return (
      <StatusView
        kind={snapshot.earnings.status === 'loading' ? 'loading' : 'error'}
        title={t("收益余额尚未确认")}
        onRetry={refresh}
      >
        {t(snapshot.earnings.status === 'error'
          ? snapshot.earnings.error.message
          : '等待当前余额读取。')}
      </StatusView>
    );
  const f = state.value,
    earnings = snapshot.earnings.value;
  const action: FinanceAction = (command) => client.dispatch(command);
  const back = () => setSub('summary');
  if (sub !== 'summary')
    return (
      <div className="earnings-page">
        <button className="quiet finance-back" onClick={back}>{t("返回收益")}</button>
        {sub === 'pricing' ? (
          <PricingPage finance={f} action={action} />
        ) : sub === 'transfer' ? (
          <TransferPage
            finance={f}
            balance={earnings.balance}
            action={action}
          />
        ) : (
          <WithdrawalPage balance={earnings.balance} />
        )}
      </div>
    );
  const included = f.settlements.filter((s) => s.daysAgo < range);
  const selected = included.filter(
    (s) => platform === 'all' || s.platform === platform,
  );
  const sum = (rows: typeof selected) =>
    rows.reduce((n, s) => n + amountUnits(s.amount), 0n);
  const rows = ledger === 'transfer' ? f.transfers : f.settlements;
  const pages = Math.max(1, Math.ceil(rows.length / 3));
  const current = Math.min(page, pages);
  const bars = Array.from({ length: range }, (_, daysAgo) =>
    sum(selected.filter((s) => s.daysAgo === daysAgo)),
  ).reverse();
  const maximum = bars.reduce((max, n) => (n > max ? n : max), 1n);
  return (
    <div className="earnings-page">
      <header className="finance-heading">
        <div>
          <h2>{t("收益与结算")}</h2>
          <p>{t("金额以 USD 计价 · 演示数据")}</p>
        </div>
        <div className="inline-actions">
          <button onClick={() => setSub('pricing')}>{t("报价设置")}</button>
          <button onClick={() => setSub('withdraw')}>{t("提现")}</button>
          <button className="primary" onClick={() => setSub('transfer')}>{t("划转至买家余额")}</button>
        </div>
      </header>
      <section className="finance earnings-summary" aria-label={t("钱包与收益")}>
        {[
          ['收益余额', earnings.balance, '全部平台，可用于划转'],
          ['今日收益', earnings.today, '全部平台'],
          ['累计收益', earnings.total, '全部已结算收益'],
        ].map(([label, value, note], i) => (
          <div key={label}>
            <p>{t(label)}</p>
            <div
              className="amount"
              data-testid={i === 0 ? 'earnings-balance' : undefined}
            >
              <span>$</span>
              {displayAmount(value)}
            </div>
            <small>{t(note)}</small>
          </div>
        ))}
      </section>
      <div className="finance-filters">
        <label>{t("平台筛选")}{t(' ')}
          <select
            aria-label={t("平台筛选")}
            value={platform}
            onChange={(e) => setPlatform(e.target.value as typeof platform)}
          >
            <option value="all">{t("全部平台")}</option>
            <option value="openai">OpenAI</option>
            <option value="claude">Claude</option>
          </select>
        </label>
        <div className="inline-actions">
          {([7, 30] as const).map((days) => (
            <button
              key={days}
              aria-pressed={range === days}
              onClick={() => setRange(days)}
            >{t("近 ")}{t(days)}{t(" 天")}</button>
          ))}
        </div>
      </div>
      <div className="earnings-panels">
        <section className="earnings-panel" aria-label={t("收益趋势")}>
          <h3>{t("收益趋势")}</h3>
          <p className="chart-total" data-testid="range-total">
            ${decimalUnits(sum(selected))}{t(' ')}
            <small>{t("近 ")}{t(range)}{t(" 天 ·")}{t(' ')}
              {t(platform === 'all'
                ? '全部平台'
                : platform === 'openai'
                  ? 'OpenAI'
                  : 'Claude')}
            </small>
          </p>
          <div
            className="earnings-chart"
            role="img"
            aria-label={t(`近${range}天已结算收益${decimalUnits(sum(selected))}美元`)}
          >
            {bars.map((n, i) => (
              <div key={i} title={t(`${range - 1 - i}天前：$${decimalUnits(n)}`)}>
                <span style={{ height: `${Number((n * 100n) / maximum)}%` }} />
              </div>
            ))}
          </div>
          <div className="chart-axis">
            <span>{t(range - 1)}{t(" 天前")}</span>
            <span>{t("今天")}</span>
          </div>
        </section>
        <section
          className="earnings-panel"
          aria-label={t("平台收益汇总")}
          data-testid="platform-totals"
        >
          <h3>{t("平台收益汇总")}</h3>
          <small>{t("同为近 ")}{t(range)}{t(" 天 · 全部平台")}</small>
          {(['openai', 'claude'] as Platform[]).map((p) => (
            <div className="finance-row" key={p}>
              <span>{t(p === 'openai' ? 'OpenAI' : 'Claude')}</span>
              <strong>
                ${decimalUnits(sum(included.filter((s) => s.platform === p)))}
              </strong>
            </div>
          ))}
          <small>{t("移除账号后，平台历史收益继续保留。")}</small>
        </section>
      </div>
      <section aria-label={t("钱包流水")}>
        <div className="finance-tabs">
          <button
            aria-pressed={ledger === 'settlement'}
            onClick={() => {
              setLedger('settlement');
              setPage(1);
            }}
          >{t("结算记录")}</button>
          <button
            aria-pressed={ledger === 'transfer'}
            onClick={() => {
              setLedger('transfer');
              setPage(1);
            }}
          >{t("划转记录")}</button>
        </div>
        <p className="finance-note">{t("全部平台 · 仅展示结算与划转，不包含买家身份或请求内容")}</p>
        {rows.length ? (
          <>
            <div className="finance-table">
              <table>
                <thead>
                  <tr>
                    <th>{t("流水号")}</th>
                    <th>{t("时间")}</th>
                    <th>{t("类型")}</th>
                    <th>{t("金额 / USD")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice((current - 1) * 3, current * 3).map((r) => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>{r.date}</td>
                      <td>
                        {t('status' in r
                          ? r.status === 'confirmed'
                            ? '演示划转'
                            : '划转未确认'
                          : '收益结算')}
                      </td>
                      <td>
                        {t('status' in r ? '-' : '+')}
                        {displayAmount(r.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="finance-pagination">
              <button
                aria-label={t("上一页流水")}
                disabled={current === 1}
                onClick={() => setPage(current - 1)}
              >{t("上一页")}</button>
              <span data-testid="ledger-page">
                {t(current)} / {t(pages)}
              </span>
              <button
                aria-label={t("下一页流水")}
                disabled={current === pages}
                onClick={() => setPage(current + 1)}
              >{t("下一页")}</button>
            </div>
          </>
        ) : (
          <StatusView
            kind="empty"
            title={t(ledger === 'transfer' ? '暂无划转记录' : '暂无结算记录')}
          >{t("完成演示")}{t(ledger === 'transfer' ? '划转' : '结算')}{t("后会显示在这里。")}</StatusView>
        )}
      </section>
    </div>
  );
}
export function FinanceHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="finance-heading">
      <div>
        <h2>{t(title)}</h2>
        <p>{t(description)}</p>
      </div>
    </header>
  );
}
