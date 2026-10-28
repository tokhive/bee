// Throwaway diagnostic UI variants. Fixtures only: no bridge, account reads,
// network checks, persistence, system permission calls or runtime operations.
const paths = {
  overview:'M3 3h18v18H3z M9 3v18 M9 9h12',accounts:'M14 3a7 7 0 0 0-6 10L3 18v3h3l2-2h3l3-3a7 7 0 1 0 0-13z M16 7h.01',
  diagnostics:'M2 12h4l3-9 5 18 3-9h5',settings:'M4 6h16 M4 12h16 M4 18h16 M8 4v4 M16 10v4 M10 16v4',
  monitor:'M3 3h18v13H3z M8 21h8 M12 16v5',check:'m5 12 4 4L19 6',close:'m6 6 12 12 M18 6 6 18',
  warning:'m12 3 10 18H2z M12 9v5 M12 17h.01',minus:'M5 12h14',chevron:'m6 9 6 6 6-6',right:'m9 5 7 7-7 7',
  refresh:'M20 7v5h-5 M4 17v-5h5 M6.1 7a7 7 0 0 1 11.6-2L20 8 M4 16l2.3 3A7 7 0 0 0 18 17',
  download:'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5',external:'M14 3h7v7 M21 3 10 14 M10 3H3v18h18v-7',
  shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6',clock:'M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  moon:'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11',sun:'M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6 1.4 1.4 M17 17l1.4 1.4 M5.6 18.4 1.4-1.4 M17 7l1.4-1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
};
const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.diagnostics}"/></svg>`;
const esc = (value) => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const variants = {
  A:{name:'紧凑分组',description:'按设备、OpenAI、Claude 分组，检查结果与处理入口就近展示。',short:'分组列表 · 原位展开'},
  B:{name:'列表与详情',description:'左侧选择检查项，右侧集中展示失败原因、证据和处理入口。',short:'左右并列 · 集中证据'},
  C:{name:'问题优先',description:'先呈现需要处理的平台，正常与未完成的检查保留在下方。',short:'先看问题 · 其余收起'},
};
const params = new URLSearchParams(location.search);
const state = {variant:variants[params.get('variant')] ? params.get('variant') : 'A',theme:params.get('theme') === 'dark' ? 'dark' : 'light',tab:params.get('tab') === 'logs' ? 'logs' : 'checks',scene:params.get('scene') === 'empty' ? 'empty' : 'completed',selected:'openai-authorization',running:false,cancelled:false,logsLoaded:false,module:'all',platform:'all',level:'all',logLimit:5,runTimer:null};
const fixtureTime='10 月 28 日 14:32';
const check = (id,group,label,status,message,evidence,action=null) => ({id,group,label,status,message,evidence,action});
const checks = [
  check('device','设备与连接','设备身份','pass','本机设备归属已核对。',{检查:'设备归属',结果:'与当前 Hive 绑定一致',观察时间:fixtureTime}),
  check('runtime','设备与连接','贡献进程','pass','已连接由本应用管理的 Bee。',{检查:'运行归属',结果:'管理进程与贡献进程一致',观察时间:fixtureTime}),
  check('hive','设备与连接','Hive 连接','pass','Hive 身份与当前设备一致。',{请求:'GET /api/bee/identity',HTTP状态:'200',观察时间:fixtureTime}),
  check('proxy','设备与连接','网络路径','pass','上游使用本机代理，Hive 沿用进程环境。',{上游:'本机 HTTP 代理',官方查询:'本机 HTTP 代理',Hive:'沿用进程环境',观察时间:fixtureTime}),
  check('openai-source','OpenAI','官方登录来源','pass','已核对当前选择的官方登录。',{来源类型:'官方默认位置 · 文件',选择:'已接入',观察时间:fixtureTime}),
  check('openai-authorization','OpenAI','官方授权','fail','官方授权已失效，请前往账号页处理。',{检查:'official_authorization',请求:'GET /backend-api/wham/usage',HTTP状态:'401',公开错误码:'authorization_expired',观察时间:fixtureTime},'前往账号'),
  check('openai-quota','OpenAI','订阅额度','skipped','授权未通过，本次未完成额度检查。',{检查:'订阅额度',原因:'官方授权已失效',观察时间:fixtureTime}),
  check('openai-capabilities','OpenAI','能力同步','skipped','授权未通过，本次未完成能力检查。',{检查:'能力同步',原因:'官方授权已失效',观察时间:fixtureTime}),
  check('openai-account','OpenAI','账号绑定','pass','所选账号与当前 Hive 绑定一致。',{检查:'账号绑定',结果:'已核对',观察时间:fixtureTime}),
  check('openai-supply','OpenAI','接单条件','fail','官方授权已失效，当前不能接收新任务。',{检查:'接单条件',原因:'authorization_unavailable',观察时间:fixtureTime},'前往账号'),
  check('claude-source','Claude','官方登录来源','pass','已核对当前选择的官方登录。',{来源类型:'官方默认位置 · 钥匙串',选择:'已接入',观察时间:fixtureTime}),
  check('claude-authorization','Claude','官方授权','pass','官方授权已核对。',{检查:'official_authorization',HTTP状态:'200',观察时间:fixtureTime}),
  check('claude-quota','Claude','订阅额度','warning','5 小时额度已耗尽，等待窗口重置。',{额度窗口:'5 小时',已用:'100%',重置时间:'今天 16:40',观察时间:fixtureTime},'查看账号'),
  check('claude-capabilities','Claude','能力同步','pass','账号能力已同步。',{检查:'能力同步',结果:'已核对',观察时间:fixtureTime}),
  check('claude-account','Claude','账号绑定','pass','所选账号与当前 Hive 绑定一致。',{检查:'账号绑定',结果:'已核对',观察时间:fixtureTime}),
  check('claude-supply','Claude','接单条件','fail','订阅额度已耗尽，当前不能接收新任务。',{检查:'接单条件',原因:'quota_exhausted',观察时间:fixtureTime},'查看账号'),
];
const logs = [
  {time:'14:32:16',level:'error',module:'accounts',platform:'openai',title:'OpenAI 官方授权检查未通过',code:'authorization_expired',evidence:'check=official_authorization · HTTP 401'},
  {time:'14:32:15',level:'warning',module:'accounts',platform:'claude',title:'Claude 5 小时订阅额度已耗尽',code:'quota_exhausted',evidence:'window=5h · used=100%'},
  {time:'14:32:14',level:'info',module:'network',platform:null,title:'已核对本机代理路径',code:'network_policy_observed',evidence:'relay=local_proxy · hive=process_environment'},
  {time:'14:32:13',level:'info',module:'diagnostics',platform:null,title:'Hive 身份已核对',code:'hive_identity_verified',evidence:'GET /api/bee/identity · HTTP 200'},
  {time:'14:32:12',level:'info',module:'runtime',platform:null,title:'已连接本应用管理的贡献进程',code:'owned_runtime_connected',evidence:'check=runtime_ownership · result=verified'},
  {time:'14:32:11',level:'info',module:'diagnostics',platform:null,title:'本次诊断开始',code:'diagnostics_started',evidence:'source=user_action · mode=read_only'},
];
const labels={pass:'通过',fail:'失败',warning:'提醒',skipped:'未检查'};
const statusIcon={pass:'check',fail:'close',warning:'warning',skipped:'minus'};
const badge=(status)=>`<span class="status ${status}">${icon(statusIcon[status])}${labels[status]}</span>`;
const stateIcon=(status)=>`<span class="state-icon ${status}">${icon(statusIcon[status])}</span>`;
const activeChecks=()=>state.cancelled?checks.map((item,index)=>index<4?item:{...item,status:'skipped',message:'检查已取消，本项未完成。',action:null}):checks;
const totals=()=>activeChecks().reduce((value,item)=>({...value,[item.status]:(value[item.status]||0)+1}),{pass:0,fail:0,warning:0,skipped:0});
const summaryLine=()=>`<div class="summary-line">${Object.entries(totals()).map(([status,count])=>`<span class="${status}"><i class="dot" style="background:currentColor"></i>${count} ${labels[status]}</span>`).join('')}</div>`;
const reportMeta=()=>`<div class="report-meta"><span>${icon('clock')}<strong>${state.cancelled?'检查已取消':'本次检查完成'}</strong> · ${fixtureTime}</span>${summaryLine()}</div>`;
const privacy=()=>`<div class="privacy-note">${icon('shield')}诊断只读取状态，不会开始贡献或自动修复。</div>`;
const evidenceRows=(item)=>Object.entries(item.evidence).map(([key,value])=>`<div><dt>${esc(key)}</dt><dd>${esc(value)}</dd></div>`).join('');
function row(item){return `<div class="check-row">${stateIcon(item.status)}<div class="check-copy"><strong>${esc(item.label)}</strong><p>${esc(item.message)}</p></div>${badge(item.status)}${item.action?`<button class="button quiet small" data-action="navigate">${item.action}</button>`:''}<button class="row-evidence" data-evidence="${item.id}" aria-expanded="false" aria-label="展开${item.group} ${item.label}证据">${icon('chevron')}</button></div><div class="inline-evidence" id="evidence-${item.id}" hidden><dl>${Object.entries(item.evidence).map(([key,value])=>`<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}</dl></div>`;}
function VariantA(){return reportMeta()+['设备与连接','OpenAI','Claude'].map(group=>{
  const values=activeChecks().filter(item=>item.group===group),fails=values.filter(item=>item.status==='fail').length,warnings=values.filter(item=>item.status==='warning').length;
  const hint=fails?`${fails} 项失败${warnings?` · ${warnings} 项提醒`:''}`:values.every(item=>item.status==='pass')?`${values.length} 项全部通过`:'部分检查未完成';
  return `<details class="group" ${group==='OpenAI'?'open':''}><summary><span>${icon('chevron').replace('<svg ','<svg class="group-chevron" ')}<strong>${group}</strong><small>${values.length} 项检查</small></span><span class="status ${fails?'fail':warnings?'warning':values.every(item=>item.status==='pass')?'pass':'skipped'}">${hint}</span></summary>${values.map(row).join('')}</details>`;
}).join('')+privacy();}
function VariantB(){const selected=activeChecks().find(item=>item.id===state.selected);return reportMeta()+`<div class="inspector"><div class="inspection-list" aria-label="选择检查项">${['设备与连接','OpenAI','Claude'].map(group=>`<div class="list-group-title">${group}</div>${activeChecks().filter(item=>item.group===group).map(item=>`<button data-select="${item.id}" aria-pressed="${item.id===selected.id}"><span><i class="dot ${item.status}"></i>${item.label}</span>${badge(item.status)}</button>`).join('')}`).join('')}</div><section class="inspection-detail" aria-label="检查详情"><div class="detail-kicker"><span>${selected.group} / ${selected.label}</span>${badge(selected.status)}</div><h2>${esc(selected.status==='fail'&&selected.id==='openai-authorization'?'官方授权已失效':selected.label)}</h2><p class="description">${esc(selected.message)}${selected.id==='openai-authorization'?' 当前账号仍保留，处理授权后可重新运行诊断。':''}</p>${selected.action?`<div class="next-action"><button class="button" data-action="navigate">${selected.action}${icon('right')}</button></div>`:''}<div class="evidence-title">本次检查的公开证据</div><dl class="evidence-table">${evidenceRows(selected)}</dl><div class="privacy-note">${icon('shield')}仅展示脱敏后的公开检查信息</div></section></div>`+privacy();}
function VariantC(){const items=activeChecks(),issues=['OpenAI','Claude'].map(group=>({group,items:items.filter(item=>item.group===group&&['fail','warning'].includes(item.status))})).filter(group=>group.items.length);return `<div class="issue-summary"><span class="state-icon">${icon(issues.length?'warning':'check')}</span><div><h2>${state.cancelled?'本次检查已取消':`${issues.length} 个平台需要处理`}</h2><p>${totals().pass} 项通过 · ${totals().fail} 项失败 · ${totals().warning} 项提醒 · ${totals().skipped} 项未检查</p></div><time>${fixtureTime}</time></div><div class="section-label"><span>需要处理</span><span>先查看原因，再前往对应页面处理</span></div><div class="issues">${issues.map(group=>`<section class="issue-row">${stateIcon('fail')}<div class="issue-copy"><div><h3>${group.group==='OpenAI'?'OpenAI 官方授权已失效':'Claude 订阅额度已耗尽'}</h3></div><p>${group.group==='OpenAI'?'授权检查未通过，当前不能接收新任务。':'5 小时额度已用完，预计今天 16:40 重置。'}</p><details><summary>${group.items.map(item=>`${item.label}：${labels[item.status]}`).join(' · ')}${'　查看证据'}</summary>${group.items.map(item=>`<p>${esc(item.label)} · ${Object.entries(item.evidence).map(([key,value])=>`${esc(key)}=${esc(value)}`).join(' · ')}</p>`).join('')}</details></div><button class="button small" data-action="navigate">前往账号${icon('right')}</button></section>`).join('')||'<div class="check-row">没有已经确认的问题；未完成项目请查看下方。</div>'}</div>${['skipped','pass'].map(status=>`<details class="compact-results"><summary><span>${icon(statusIcon[status])}${status==='pass'?'通过的检查':'尚未完成的检查'} <small>${totals()[status]} 项</small></span>${icon('chevron')}</summary>${items.filter(item=>item.status===status).map(item=>row({...item,label:`${item.group} · ${item.label}`})).join('')}</details>`).join('')}`+privacy();}
function logPanel(){const moduleNames={diagnostics:'诊断',accounts:'账号',network:'网络',runtime:'贡献进程'},levelNames={info:'信息',warning:'提醒',error:'错误'};
  const filtered=logs.filter(item=>(state.module==='all'||item.module===state.module)&&(state.platform==='all'||item.platform===state.platform)&&(state.level==='all'||item.level===state.level));
  const select=(label,key,options)=>`<label>${label}<select data-filter="${key}" aria-label="${label}">${Object.entries(options).map(([value,text])=>`<option value="${value}" ${state[key]===value?'selected':''}>${text}</option>`).join('')}</select></label>`;
  return `<div class="log-tools"><div class="log-filters">${select('模块','module',{all:'全部模块',...moduleNames})}${select('平台','platform',{all:'全部平台',openai:'OpenAI',claude:'Claude'})}${select('级别','level',{all:'全部级别',...levelNames})}</div><small>${state.logsLoaded?'最近读取 14:32':'仅在点击刷新后读取'}</small></div>${!state.logsLoaded?`<div class="empty"><span class="state-icon">${icon('diagnostics')}</span><h2>按需查看安全日志</h2><p>选择筛选范围后，点击右上方「刷新日志」。切换页签不会自动读取。</p></div>`:`<div class="log-table-wrap"><table class="log-table"><thead><tr><th>时间</th><th>级别</th><th>安全事件</th></tr></thead><tbody>${filtered.slice(0,state.logLimit).map(item=>`<tr><td>${item.time}</td><td>${badge(item.level==='info'?'pass':item.level==='error'?'fail':'warning').replace('通过','信息').replace('失败','错误')}</td><td><strong>${item.title}</strong><div class="log-meta">${moduleNames[item.module]}${item.platform?` / ${item.platform==='openai'?'OpenAI':'Claude'}`:''} · ${item.code}</div><details><summary>公开证据</summary><p>${item.evidence}</p></details></td></tr>`).join('')||'<tr><td colspan="3">当前筛选范围内没有保留的记录。</td></tr>'}</tbody></table></div><div class="log-footer"><span>当前显示 ${Math.min(filtered.length,state.logLimit)} 条 · 仅包含本机保留范围</span>${filtered.length>state.logLimit?'<button class="button small" data-action="more">加载更多</button>':''}</div>`}<div class="privacy-note">${icon('shield')}不包含登录凭证、个人路径或请求内容。日志有界保留，较早记录可能已轮转。</div>`;
}
function emptyPanel(){return `<div class="empty"><span class="state-icon">${icon('diagnostics')}</span><h2>${state.running?'正在检查设备、账号与网络…':'尚未运行诊断'}</h2><p>${state.running?'检查只读取已选择来源的状态。取消会保留已取得的结果。':'主动运行一次诊断，查看当前设备的检查结果。进入页面不会自动开始检查。'}</p></div>`;}
function actions(){return state.tab==='logs'?`<button class="button" data-action="refresh">${icon('refresh')}刷新日志</button>`:`${state.running?'<button class="button" data-action="cancel">取消诊断</button>':''}<button class="button primary" data-action="run" ${state.running?'disabled':''}>${icon('diagnostics')}${state.running?'诊断进行中':state.scene==='empty'?'运行诊断':'重新运行诊断'}</button><button class="button" data-action="export" ${state.scene==='empty'||state.running?'disabled':''}>${icon('download')}导出报告</button>`;}
function render(){document.documentElement.dataset.theme=state.theme;document.getElementById('review-label').textContent=`${state.variant} · ${variants[state.variant].name}`;document.getElementById('variant-description').textContent=variants[state.variant].description;document.getElementById('scene').value=state.scene;
  document.getElementById('theme').innerHTML=icon(state.theme==='light'?'moon':'sun');document.getElementById('theme').setAttribute('aria-label',state.theme==='light'?'切换深色主题':'切换浅色主题');
  for(const tab of ['checks','logs']){const button=document.getElementById(`tab-${tab}`);button.setAttribute('aria-selected',String(state.tab===tab));button.tabIndex=state.tab===tab?0:-1;}
  document.getElementById('tab-actions').innerHTML=actions();const panel=document.getElementById('panel');panel.dataset.layout=state.variant;panel.setAttribute('aria-labelledby',`tab-${state.tab}`);panel.innerHTML=state.tab==='logs'?logPanel():state.scene==='empty'?emptyPanel():({A:VariantA,B:VariantB,C:VariantC}[state.variant])();
  document.getElementById('variant-buttons').innerHTML=Object.entries(variants).map(([key,value])=>`<button data-variant="${key}" aria-pressed="${state.variant===key}"><span class="variant-key">${key}</span><div><strong>${value.name}</strong><small>${value.short}</small></div></button>`).join('');
  const url=new URL(location.href);url.searchParams.set('variant',state.variant);url.searchParams.set('theme',state.theme);url.searchParams.set('tab',state.tab);url.searchParams.set('scene',state.scene);history.replaceState(null,'',url);
}
let toastTimer;function toast(message){clearTimeout(toastTimer);document.getElementById('toast').textContent=message;toastTimer=setTimeout(()=>document.getElementById('toast').textContent='',3200);}
function chooseVariant(variant){state.variant=variant;render();console.info('Bee S2 preview',{variant,layout:variants[variant].name,theme:state.theme,tab:state.tab,scene:state.scene,fixtureOnly:true});}
function cycle(direction){const keys=Object.keys(variants);chooseVariant(keys[(keys.indexOf(state.variant)+direction+keys.length)%keys.length]);}
document.getElementById('theme').onclick=()=>{state.theme=state.theme==='light'?'dark':'light';render();};
document.getElementById('scene').onchange=(event)=>{clearTimeout(state.runTimer);state.running=false;state.cancelled=false;state.scene=event.target.value;render();};
document.getElementById('previous').onclick=()=>cycle(-1);document.getElementById('next').onclick=()=>cycle(1);
document.getElementById('variant-buttons').onclick=(event)=>{const button=event.target.closest('[data-variant]');if(button)chooseVariant(button.dataset.variant);};
document.querySelector('.tabs').onclick=(event)=>{const button=event.target.closest('[data-tab]');if(button){state.tab=button.dataset.tab;render();}};
document.addEventListener('keydown',(event)=>{if(document.getElementById('export-dialog').open||event.target.closest('input,textarea,select,[contenteditable="true"],[role="tab"]'))return;if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();cycle(event.key==='ArrowLeft'?-1:1);}});
document.querySelector('.tabs').onkeydown=(event)=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();state.tab=state.tab==='checks'?'logs':'checks';render();document.getElementById(`tab-${state.tab}`).focus();}};
document.addEventListener('click',(event)=>{
  const selected=event.target.closest('[data-select]');if(selected){state.selected=selected.dataset.select;render();return;}
  const evidence=event.target.closest('[data-evidence]');if(evidence){const detail=document.getElementById(`evidence-${evidence.dataset.evidence}`);detail.hidden=!detail.hidden;evidence.setAttribute('aria-expanded',String(!detail.hidden));return;}
  const action=event.target.closest('[data-action]')?.dataset.action;if(!action)return;
  if(action==='navigate')toast('预览：正式应用将前往 AI 账号页，不会自动登录或恢复贡献。');
  if(action==='export')document.getElementById('export-dialog').showModal();
  if(action==='refresh'){state.logsLoaded=true;state.logLimit=5;render();toast('预览：已显示所选范围的合成安全日志。');}
  if(action==='more'){state.logLimit+=5;render();}
  if(action==='run'){state.running=true;state.cancelled=false;state.scene='empty';render();state.runTimer=setTimeout(()=>{state.running=false;state.scene='completed';render();},1600);}
  if(action==='cancel'){clearTimeout(state.runTimer);state.running=false;state.cancelled=true;state.scene='completed';render();}
});
document.getElementById('panel').onchange=(event)=>{if(event.target.dataset.filter){state[event.target.dataset.filter]=event.target.value;state.logsLoaded=false;state.logLimit=5;render();}};
document.getElementById('confirm-export').onclick=()=>toast('预览：已确认报告范围；本页不写入真实报告文件。');
document.getElementById('hive-link').onclick=()=>toast('预览：正式应用将打开已保存的 Hive 站点。');
document.getElementById('app-navigation').innerHTML=[['overview','概览'],['accounts','AI 账号'],['diagnostics','诊断'],['settings','设置']].map(([key,label])=>`<button ${key==='diagnostics'?'aria-current="page"':key==='settings'?'data-preview-settings':'disabled title="本轮预览展示诊断与设置"'}>${icon(key)}${label}</button>`).join('');
document.getElementById('device-icon').innerHTML=icon('monitor');document.getElementById('toolbar-device').innerHTML=`${icon('monitor')}本机设备`;document.getElementById('external-icon').innerHTML=icon('external');document.getElementById('export-privacy').innerHTML=`${icon('shield')}不包含凭证、个人路径或请求内容。最多 5 MiB，超出会标明截断。`;
chooseVariant(state.variant);

document.querySelector('[data-preview-settings]').onclick=()=>{location.href='2026-10-28-bee-s2-settings-prototype.html?variant=B';};
