import type {AccountSnapshot,AccountWindow,AccountCapabilities,AccountPlatform} from '../../system/accounts';
import type {NavigationTarget} from '../../app/navigation';
import type {UiFailure} from '../../system/failures';
type AccountFailure=Pick<UiFailure,'code'|'check'|'message'|'evidence'>;
export const sameAccountFailure=(a:AccountFailure|null|undefined,b:AccountFailure|null|undefined)=>!!a&&!!b&&a.code===b.code&&a.check===b.check&&a.message===b.message&&JSON.stringify(Object.entries(a.evidence).sort())===JSON.stringify(Object.entries(b.evidence).sort());
export interface AccountPresentation {identity:string|null;plan:string|null;expiresAt:string|null;observedAt:string|null;windows:AccountWindow[];quotaState:'unknown'|'current'|'stale'|'unconfirmed'}
export function accountPresentation(snapshot:AccountSnapshot|undefined,dirty:boolean,now:number,readFailed=false,remoteUnconfirmed=false):AccountPresentation {
 const fingerprint=snapshot?.selection.state==='selected'?snapshot.selection.fingerprint:null;
 const result:AccountPresentation={identity:fingerprint?.slice(0,16)??null,plan:null,expiresAt:null,observedAt:null,windows:[],quotaState:'unknown'};
 if(!snapshot||!fingerprint)return result;
 const candidate=!dirty&&snapshot.candidate.fingerprint===fingerprint;
 if(candidate){result.plan=snapshot.candidate.plan;result.expiresAt=snapshot.candidate.expires_at;}
 const available=snapshot.capabilities.filter(c=>c.origin==='official'?candidate:snapshot.hive.fingerprint===fingerprint);
 const fresh=(c:AccountCapabilities)=>c.status==='ready'&&!!c.observed_at&&!!c.valid_until&&Date.parse(c.valid_until)>now&&!c.windows.some(w=>w.reset_at&&Date.parse(w.reset_at)<=now)&&!(result.expiresAt&&Date.parse(result.expiresAt)<=now);
 const observation=available.find(c=>c.origin==='official'&&fresh(c))??available.find(fresh)??available.find(c=>c.observed_at);
 if(observation){result.observedAt=observation.observed_at;result.plan=observation.plan??result.plan;result.windows=observation.windows.map(w=>({...w}));result.quotaState=observation.windows.length?(readFailed||remoteUnconfirmed&&observation.origin==='hive'&&fresh(observation)?'unconfirmed':fresh(observation)?'current':'stale'):'unknown';}
 return result;
}

export type AccountAction='select'|'confirm_change'|'clear_selection'|'authorize';
export interface AccountActionContext {autoService?:boolean;view:AccountSnapshot|undefined;platform:AccountPlatform;now:number;dirty:boolean;busy:boolean;unknown:boolean;submissionBlocked:boolean;sharedReadFailure?:UiFailure|null;defaultsReady:boolean;runtime:{local:string}|undefined;runtimeBlocked:boolean}
export interface AccountActionBlock {message:string;target:NavigationTarget|null;reason?:string|null}
/** One predicate owns both the disabled button and its adjacent explanation. */
export function accountActionBlock(action:AccountAction,c:AccountActionContext):AccountActionBlock|null {
 const {view,platform}=c;
 const source:NavigationTarget={page:'accounts',section:'source',platform};
 const blocked=(message:string,target:NavigationTarget|null=null,reason?:string|null)=>({message,target,reason});
 if(!view)return blocked('账号状态尚未确认，暂不能提交。');
 if(action!=='authorize'&&c.sharedReadFailure)return blocked('共享状态读取未确认，暂不能提交账号操作；请先核对当前读取问题。',c.sharedReadFailure.check==='account_defaults'?source:{page:'overview',section:'runtime'});
 if(action!=='authorize'&&c.submissionBlocked)return blocked('接入前需先恢复设备身份；本机来源仍可读取。',{page:'overview',section:'device'});
 if(c.busy)return blocked('正在提交账号操作，请等待本次结果。');
 const maintenance=view.login_maintenance;
 if(maintenance&&maintenance.phase!=='restored'&&!(action==='confirm_change'&&maintenance.phase==='confirmation_required'))return blocked('此平台的登录维护尚未完成，请先核对维护结果。',{page:'accounts',section:'account',platform});
 const pending=!!view.operation&&['pending','running','reconciling'].includes(view.operation.state);
 const continuation=action==='confirm_change'&&view.operation?.state==='reconciling'&&view.operation.error?.code==='confirmation_not_submitted';
 if(pending&&!continuation)return blocked(view.operation?.kind==='authorize'?'官方登录仍在进行；关闭详情不会取消登录。':'已有账号操作待核对；只查询原操作，不会重复提交。');
 if(c.unknown)return blocked('上次操作结果待核对；确认结果前不能再次提交。');
 if(c.runtime?.local==='starting'||c.runtime?.local==='stopping')return blocked('贡献正在启动或停止，完成后再操作账号。',{page:'overview',section:'runtime'});
 if(!view.features[action].available){
  const reason=view.features[action].reason;
  const copy:Record<string,string>={runtime_ownership_and_source_barrier_required:'当前管理版本无法安全换号，请先检查运行与账号保护条件。',verified_official_authorization_adapter_required:'此版本未提供已核验的官方登录支持。',runtime_drain_and_detach_required:'此版本无法安全移除已注册账号。'};
  return blocked(copy[reason??'']??'此版本未开放该账号操作；请在详情核对限制。',null,reason);
 }
 if(action==='authorize'){
  if(!c.defaultsReady)return blocked('凭证读取方式尚未确认，暂不能启动官方登录。',source);
  if(c.runtimeBlocked||!c.runtime)return blocked('贡献运行状态待确认，暂不能启动官方登录。',{page:'overview',section:'runtime'});
  if(!(c.autoService?['stopped','waiting','failed','running']:['stopped','waiting','failed']).includes(c.runtime.local))return blocked('官方登录前请先停止贡献；前往概览停止后再返回。',{page:'overview',section:'runtime'});
  return null;
 }
 const selected=view.selection.state==='selected';
 if(action==='clear_selection')return !selected||view.hive.fingerprint!==null||view.hive.generation!==null?blocked('只能取消尚未在 Hive 注册的本地选择。'):null;
 if(c.dirty)return blocked('来源已改变，请等待重新读取后再确认。',source);
 if(view.candidate.state!=='available'||!view.candidate.reference)return blocked('所选来源尚无可接入候选，请检查凭证读取方式。',source);
 if(!view.candidate.expires_at||Date.parse(view.candidate.expires_at)<=c.now+30000)return blocked('候选授权即将过期，请重新登录或更新来源后等待重新读取。',source);
 if(action==='confirm_change'&&(!selected||view.candidate.fingerprint!==null&&view.candidate.fingerprint===view.selection.fingerprint))return blocked('当前候选与已接入账号相同，无需换号。');
 if(action==='select'&&selected)return blocked('此平台已有接入账号，请在详情确认换号。',{page:'accounts',section:'account',platform});
 return null;
}

export const loginMaintenanceCopy:Record<NonNullable<AccountSnapshot['login_maintenance']>['phase'],string>={
 pause_pending:'正在确认此平台暂停接单…',
 paused:'此平台已暂停，正在准备登录维护…',
 isolated:'此平台已隔离，正在准备官方登录…',
 authorizing:'正在等待此平台的官方登录完成…',
 reconciling:'此平台的登录维护结果待确认；只核对原过程。',
 restored:'此平台的账号维护已恢复。',
 confirmation_required:'发现不同账号，请在详情确认换号；原账号选择仍保留。',
 blocked:'此平台的登录维护受阻，请查看具体原因。',
};

export function accountPhase(view:AccountSnapshot|undefined,dirty:boolean,reading:boolean,now:number):string {
 if(dirty)return reading?'正在读取已有登录…':'来源已更改，等待自动读取。';
 if(!view||view.candidate.state==='not_checked')return reading?'正在读取已有登录…':'所选来源的登录状态待确认。';
 if(view.candidate.state==='available'){
  if(!view.candidate.expires_at||Date.parse(view.candidate.expires_at)<=now+30000)return '候选授权即将过期，请重新登录或更新来源后等待重新读取。';
  if(view.selection.state!=='selected')return '已有登录，尚未接入';
  if(view.candidate.fingerprint&&view.candidate.fingerprint!==view.selection.fingerprint)return '发现不同账号，请在详情确认换号；原账号选择仍保留。';
  return '';
 }
 if(view.candidate.state==='source_missing')return '所选来源未找到登录；可调整读取位置或使用官方登录。';
 if(view.candidate.state==='expired')return '所选来源的授权已过期，请重新登录。';
 if(view.candidate.state==='source_changed')return '所选来源已改变，需重新读取并确认候选。';
 return '所选来源暂不能提供可接入账号，请查看具体原因。';
}

export interface SupplyProblem {summary:string;impact:string;handler:'user'|'administrator'|'wait';target:NavigationTarget|null}
const supplyProblems:Record<string,Omit<SupplyProblem,'target'>&{section?:'source'|'account'|'connection'}>={
 manually_paused:{summary:'已手动暂停',impact:'恢复接单只解除此平台暂停；不会开始贡献，其他阻塞仍需满足。',handler:'user'},
 banned:{summary:'管理员已禁用此平台供给',impact:'请联系 Hive 管理员核对此平台的供给权限。',handler:'administrator'},
 device_draining:{summary:'设备替换中，仅收尾已接请求',impact:'等待已有请求完成收尾；当前不能接收新请求。',handler:'wait'},
 offline:{summary:'Hive 未看到此平台的 Bee 连接',impact:'请在概览核对贡献运行和实际连接原因。',handler:'user',section:'connection'},
 not_configured:{summary:'此 Hive 未提供更具体的接单原因',impact:'请联系 Hive 管理员核对平台配置；当前原因不能证明市场或账号状态。',handler:'administrator'},
 account_not_registered:{summary:'Hive 账号注册尚未完成',impact:'本机账号选择和 Hive 注册是独立状态；当前未证明注册或同步已完成。',handler:'wait'},
 market_not_open:{summary:'Hive 尚未开放 {platform} 模型交易',impact:'请联系 Hive 管理员核对该平台的市场发布与价格配置。',handler:'administrator'},
 supply_not_enabled:{summary:'Hive 尚未启用此平台供给',impact:'请联系 Hive 管理员配置该设备的静态或平台动态供给。',handler:'administrator'},
 supply_device_restricted:{summary:'Hive 供给绑定限制了当前设备',impact:'请联系 Hive 管理员核对设备和供给绑定。',handler:'administrator'},
 account_not_admitted:{summary:'当前账号不在 Hive 供给准入集合中',impact:'请联系 Hive 管理员核对当前账号准入。',handler:'administrator'},
 model_unavailable:{summary:'账号没有可用的市场模型',impact:'请联系 Hive 管理员核对该账号或供给的可用模型。',handler:'administrator'},
 authorization_unavailable:{summary:'Hive 没有可用的加密授权',impact:'当前尚未确认有可用授权；只有实际同步事实才能确认同步进度。',handler:'wait'},
 capabilities_unknown:{summary:'账号模型和额度报告尚未确认',impact:'等待实际报告核对；历史额度不能支持可接单结论。',handler:'wait'},
 plan_not_configured:{summary:'管理员尚未配置套餐并发上限',impact:'请联系 Hive 管理员配置该套餐的并发上限。',handler:'administrator'},
 concurrency_full:{summary:'账号并发请求已满',impact:'等待已有请求结束；当前没有可承诺的恢复时刻。',handler:'wait'},
 rate_limited:{summary:'上游平台限流中',impact:'恢复取决于上游限制；仅按实际报告的重试条件核对。',handler:'wait'},
 quota_unknown:{summary:'账号额度窗口尚未确认',impact:'额度未知；以实际来源读取和报告为准，不能按零额度处理。',handler:'wait'},
 quota_exhausted:{summary:'账号订阅额度已耗尽',impact:'请查看全部额度窗口与已报告的重置时间；恢复按钮不能解除额度限制。',handler:'wait'},
 codex_source_unavailable:{summary:'无法读取 Codex 官方登录',impact:'请检查 OpenAI 的所选凭证来源与具体读取原因。',handler:'user',section:'source'},
 claude_source_unavailable:{summary:'无法读取 Claude Code 官方登录',impact:'请检查 Claude 的所选凭证来源与具体读取原因。',handler:'user',section:'source'},
 codex_confirmation_required:{summary:'Codex 账号变更待确认',impact:'请核对 OpenAI 当前和目标账号，再明确确认换号。',handler:'user',section:'account'},
 claude_confirmation_required:{summary:'Claude Code 账号变更待确认',impact:'请核对 Claude 当前和目标账号，再明确确认换号。',handler:'user',section:'account'},
 codex_authorization_rejected:{summary:'OpenAI 已拒绝此账号授权',impact:'请在 OpenAI 账号详情重新登录；官方登录前需先停止贡献。',handler:'user',section:'account'},
 claude_authorization_rejected:{summary:'Anthropic 已拒绝此账号授权',impact:'请在 Claude 账号详情重新登录；官方登录前需先停止贡献。',handler:'user',section:'account'},
};
export const reasonCopy:Record<string,string>=Object.fromEntries(Object.entries(supplyProblems).map(([reason,p])=>[reason,p.summary]));
export function supplyProblem(reason:string,platform:AccountPlatform):SupplyProblem {
 const p=supplyProblems[reason];
 if(!p)return {summary:'平台接单原因尚未识别',impact:'请保留原因码并联系 Hive 管理员核对。',handler:'administrator',target:null};
 return {summary:p.summary,impact:p.impact,handler:p.handler,target:p.section==='connection'?{page:'overview',section:'connection'}:p.section?{page:'accounts',section:p.section,platform}:null};
}
