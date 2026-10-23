import type { Account } from '../../client/types';
import { DetailSheet } from '../../components/DetailSheet';
export function AccountDetails({ account }: { account: Account }) {
  const authorized = account.authorization === 'valid';
  return (
    <DetailSheet
      trigger={<button>查看详情</button>}
      title={`${account.label} 账号详情`}
      description="演示账号能力和市场开放状态分别列出；不包含登录凭证。"
    >
      <dl>
        <dt>账号</dt>
        <dd>{account.identifier ?? '未知'}</dd>
        <dt>订阅套餐</dt>
        <dd>{account.plan}</dd>
        <dt>授权</dt>
        <dd>{authorized ? '有效（仅演示）' : '授权已失效'}</dd>
        <dt>接入来源</dt>
        <dd>{account.source === 'existing-login' ? '已有官方登录（演示）' : '官方授权'}</dd>
        <dt>额度窗口</dt>
        <dd>
          {account.quota
            ? `${account.quota.window} · 剩余 ${account.quota.remaining}%`
            : '额度未知'}
        </dd>
        <dt>重置时间</dt>
        <dd>{account.quota?.resetsAt ?? '未知'}</dd>
        <dt>更新时间</dt>
        <dd>{account.updatedAt ?? '未知'}</dd>
      </dl>
      <section className="account-models" aria-label="模型能力与市场开放">
        <h3>模型能力与市场开放</h3>
        {account.models?.map((model) => (
          <div className="model-row" key={model.name}>
            <strong>{model.name}</strong>
            <span>{model.marketOpen ? '平台已开放' : '平台暂未开放'}</span>
            <small>
              {!authorized
                ? '授权已失效，需重新确认账号能力'
                : `${model.supported ? '账号支持' : '账号不支持'} · ${model.supported && model.marketOpen && !account.removal ? '可用于演示交易' : '当前不可交易'}`}
            </small>
          </div>
        ))}
      </section>
    </DetailSheet>
  );
}
