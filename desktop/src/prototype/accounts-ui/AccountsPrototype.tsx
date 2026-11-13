// Throwaway prototype of the confirmed overview and accounts layout. Not production UI.
import {useState} from 'react';
import logo from '../../assets/app-icon-dark.svg';
import './prototype.css';

type WindowUsage = {label: string; used: number | null; reset: string};
type Row = {
  platform: string;
  identity: string;
  plan: string;
  expires: string;
  connected: boolean;
  paused: boolean;
  windows: WindowUsage[];
  login: string;
};
const rows: Row[] = [
  {platform: 'OpenAI', identity: 'e57087c4', plan: 'Plus', expires: '2027-01-15', connected: true, paused: true, windows: [{label: '5 小时', used: 3, reset: '21:27'}, {label: '7 日', used: 2, reset: '未知'}], login: ''},
  {platform: 'Claude', identity: '尚未接入', plan: '未知套餐', expires: '未知', connected: false, paused: false, windows: [{label: '额度', used: null, reset: '未知'}], login: '登录 Claude'},
];

function Meter({label, used}: WindowUsage) {
  return <div className="proto-meter"><div className="proto-meter-label"><span>{label}</span><strong>{used == null ? '尚未核对' : `${used}%`}</strong></div><div className="proto-track" aria-hidden="true"><i style={{width: used == null ? 0 : `${used}%`}} /></div></div>;
}
function overviewStatus(row: Row, running: boolean) {
  if (!row.connected) return {label: '不能接单', reasons: ['尚未配置平台账号或市场未开放']};
  if (!running) return {label: '不能接单', reasons: ['Hive 未看到此平台的 Bee 连接', 'Hive 没有可用的加密授权']};
  if (row.paused) return {label: '不能接单', reasons: ['已手动暂停']};
  return {label: '可接单', reasons: []};
}
function accountStatus(row: Row, running: boolean) {
  if (!row.connected) return {label: '不能接单', reasons: [`还没有 ${row.platform} 登录`]};
  if (!running) return {label: '已暂停', reasons: []};
  return overviewStatus(row, running);
}

export function Overview({running, onToggle}: {running: boolean; onToggle: () => void}) {
  return <div className="proto-overview">
    <section className="proto-block" aria-label="设备">
      <h2>设备</h2>
      <div className="proto-device-row"><span>已绑定</span><strong>Bee Desktop</strong><span>owner@example.com</span><span>dev.tokhive.ai</span></div>
    </section>
    <section className="proto-block" aria-label="平台">
      <div className="proto-section-heading"><h2>平台</h2><div className="proto-hive"><span className={running ? 'proto-pill' : 'proto-pill off'}><i />{running ? '已连接' : '未连接'}</span><button className="primary" type="button" onClick={onToggle}>{running ? '停止贡献' : '开始贡献'}</button></div></div>
      <div className="proto-a-head"><span>平台</span><span>套餐</span><span>状态</span><span>用量</span><span /></div>
      <div className="proto-a-list">{rows.map(row => { const current = overviewStatus(row, running); return <article key={row.platform}><div className="proto-who"><strong>{row.platform}</strong><small>{row.identity}</small></div><span>{row.plan}</span><div className="proto-status"><strong>{current.label}</strong>{current.reasons.map(reason => <small key={reason}>{reason}</small>)}</div><div className="proto-meters">{row.windows.map(item => <Meter key={item.label} {...item} />)}</div><div className="proto-switch">{running && row.connected ? <button type="button" className="quiet">{row.paused ? '恢复接单' : '暂停接单'}</button> : null}</div></article>; })}</div>
    </section>
  </div>;
}

function Accounts({running, onOpen}: {running: boolean; onOpen: (platform: string) => void}) {
  return <div className="proto-a">
    <div className="proto-a-head"><span>平台</span><span>套餐</span><span>状态</span><span>用量</span><span className="proto-sr">操作</span></div>
    <div className="proto-a-list">{rows.map(row => { const current = accountStatus(row, running); return <article key={row.platform}><div className="proto-who"><strong>{row.platform}</strong><small>{row.identity}</small></div><span>{row.plan}</span><div className="proto-status"><strong>{current.label}</strong>{current.reasons.map(reason => <small key={reason}>{reason}</small>)}</div><div className="proto-meters">{row.windows.map(item => <Meter key={item.label} {...item} />)}</div><div className="proto-actions">{row.login ? <button className="primary" type="button">{row.login}</button> : <button className="primary proto-slot" type="button" tabIndex={-1} aria-hidden="true">登录 Claude</button>}{running && row.connected ? <button className="quiet" type="button">{row.paused ? '恢复接单' : '暂停接单'}</button> : <button className="quiet proto-slot" type="button" tabIndex={-1} aria-hidden="true">暂停接单</button>}<button className="quiet" type="button" onClick={() => onOpen(row.platform)}>详情</button></div></article>; })}</div>
  </div>;
}

function Detail({platform, onClose}: {platform: string; onClose: () => void}) {
  const row = rows.find(item => item.platform === platform)!;
  const [open, setOpen] = useState(true);
  const stores = platform === 'OpenAI' ? ['自动', '文件', '钥匙串'] : ['文件', '钥匙串'];
  return <aside className="detail-sheet" aria-label={`${platform} 详情`}>
    <header><h2>{platform}</h2><button type="button" className="quiet" onClick={onClose}>关闭</button></header>
    <dl className="proto-facts">
      <div><dt>当前账号</dt><dd>{row.identity}</dd></div>
      <div><dt>套餐</dt><dd>{row.plan}</dd></div>
      <div><dt>授权到期</dt><dd>{row.expires}</dd></div>
      {row.windows.map(item => <div key={item.label}><dt>{item.label}重置</dt><dd>{item.reset}</dd></div>)}
    </dl>
    {row.connected && <div className="proto-sheet-actions"><button type="button">换号</button><button type="button">重新登录</button></div>}
    <div className="proto-read">
      <button type="button" className="proto-read-title" aria-expanded={open} onClick={() => setOpen(value => !value)}><strong>凭证读取方式</strong><span>{open ? '收起' : '展开'}</span></button>
      {open && <div className="proto-read-body">
        <label>目录<input placeholder="默认目录" /></label>
        <label>存储方式<select defaultValue={stores[0]}>{stores.map(item => <option key={item}>{item}</option>)}</select></label>
        <p>留空则读取默认位置。这里不粘贴密钥。</p>
      </div>}
    </div>
  </aside>;
}

export function AccountsPrototype() {
  const params = new URLSearchParams(location.search);
  const initial = params.get('page') === 'overview' ? 'overview' : 'accounts';
  const [page, setPage] = useState<'overview' | 'accounts'>(initial);
  const [running, setRunning] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  function choose(next: 'overview' | 'accounts') {
    const query = new URLSearchParams(location.search);
    query.set('prototype', 'accounts');
    query.set('page', next);
    history.replaceState(null, '', `${location.pathname}?${query}`);
    setPage(next);
    setDetail(null);
  }
  return <div className="app-shell accounts-prototype">
    <aside className="sidebar"><div className="brand"><img src={logo} alt="" />Bee</div><nav aria-label="主导航"><button type="button" aria-current={page === 'overview' ? 'page' : undefined} onClick={() => choose('overview')}>概览</button><button type="button" aria-current={page === 'accounts' ? 'page' : undefined} onClick={() => choose('accounts')}>AI 账号</button><button type="button">诊断</button><button type="button">设置</button></nav></aside>
    <div className="workspace">
      <header className="toolbar"><span className="device">本机设备</span></header>
      <main>
        <div className="page-heading"><div><h1>{page === 'overview' ? '概览' : 'AI 账号'}</h1><p>{page === 'overview' ? '看状态和贡献。不在这里接入账号。' : '在这里接入。开始贡献不会解除暂停。'}</p></div></div>
        {page === 'overview' ? <Overview running={running} onToggle={() => setRunning(value => !value)} /> : <Accounts running={running} onOpen={setDetail} />}
      </main>
    </div>
    {detail && <Detail key={detail} platform={detail} onClose={() => setDetail(null)} />}
  </div>;
}
