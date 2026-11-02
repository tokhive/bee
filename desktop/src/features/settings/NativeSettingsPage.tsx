import {FailureNotice} from '../../components/ProblemNotice';
import {settingsTabForSection,type NavigationRequest,type NavigationTarget} from '../../app/navigation';
import {normalizeFailure,requestNotSent,type UiFailure} from '../../system/failures';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Tabs} from 'radix-ui';
import {version as appVersion} from '../../../package.json';
import '../../styles/section-tabs.css';
import {ConfirmDialog} from '../../components/ConfirmDialog';
import {t,formatDate,currentLocale} from '../../i18n/index';
import type {RuntimeSnapshot} from '../../system/runtime';
import type {DesktopPreferences,PreferencesClient,PreferencesSnapshot} from '../../system/preferences';
import type {AutostartSnapshot,NotificationPermission,createNotificationsClient} from '../../system/notifications';
import type {NetworkClient,NetworkSnapshot,NetworkTestResult} from '../../system/network';
import './native-settings.css';

interface SettingsControl {operation:string|null;networkRead:number;permissionRead:number;autostartRead:number;deliveryRead:number}
export interface NativeSettingsDraft {
 proxy?:string;origin?:string;dirty?:boolean;tab?:string;control?:SettingsControl;
 saved?:PreferencesSnapshot;network?:NetworkSnapshot|null;permission?:NotificationPermission|null;autostart?:AutostartSnapshot|null;test?:NetworkTestResult|null;
 busy?:string|null;error?:UiFailure|null;notice?:string;permissionError?:UiFailure|null;autostartError?:UiFailure|null;autostartReadError?:UiFailure|null;deliveryError?:UiFailure|null;networkReadError?:UiFailure|null;preferenceReadError?:UiFailure|null;
 proxySave?:'pending'|'confirmed'|'unknown'|'failed';saveFailure?:UiFailure|null;savedProxy?:{value:string;revision:number};saveReadConfirmed?:boolean;
 applyState?:'pending'|'confirmed'|'unknown'|'failed';applyFailure?:UiFailure|null;
 notificationState?:'pending'|'confirmed'|'unknown';autostartState?:'pending'|'confirmed'|'unknown';autostartDesired?:boolean;autostartReadConfirmed?:boolean;
 runtime?:RuntimeSnapshot|null;runtimeReadError?:UiFailure|null;
}
export interface NativeSettingsPageProps {
 draft?:NativeSettingsDraft;onDraftChange?:(change:Partial<NativeSettingsDraft>)=>void;navigationRequest?:NavigationRequest;
 preferences:PreferencesSnapshot;
 preferencesClient:PreferencesClient;
 notificationsClient:ReturnType<typeof createNotificationsClient>;
 networkClient:NetworkClient;
 hive?:string;os?:string;contextKnown?:boolean;isCurrentScope?:()=>boolean;readRuntime?:()=>Promise<{view:RuntimeSnapshot|null;failure:UiFailure|null}>;
 paired?:boolean;
 version?:string;
 updateControls?:ReactNode;
 onSaved:(snapshot:PreferencesSnapshot)=>void;
 onNavigate?:(target:NavigationTarget)=>void;
}
function path(value:string){return t(({direct:'直连',local_proxy:'本机代理',environment_proxy:'进程环境代理',unknown:'尚未确认'} as Record<string,string>)[value]??'尚未确认');}
function officialPath(value:string,platform:'openai'|'claude'){return path(value.split(';').find(part=>part.startsWith(`${platform}=`))?.split('=')[1]??'unknown');}
const checkNames={local_proxy:'本机代理连接',openai_read_only:'OpenAI 只读端点',claude_read_only:'Claude 只读端点'};
const draftProxy=(preferences:DesktopPreferences,origin:string)=>preferences.proxies.find(entry=>entry.origin===origin&&entry.device_scope===null)?.connect_proxy??'';

export function NativeSettingsPage({preferences,preferencesClient,notificationsClient,networkClient,hive,paired=false,version,updateControls,onSaved,onNavigate,draft,onDraftChange,navigationRequest,os,contextKnown=false,isCurrentScope,readRuntime}:NativeSettingsPageProps){
 const [localDraft,setLocalDraft]=useState<NativeSettingsDraft>({control:{operation:null,networkRead:0,permissionRead:0,autostartRead:0,deliveryRead:0}});
 const currentDraft=draft??localDraft,draftRef=useRef(currentDraft);draftRef.current=currentDraft;
 const patchDraft=(change:Partial<NativeSettingsDraft>)=>{const next={...draftRef.current,...change};draftRef.current=next;if(onDraftChange)onDraftChange(change);else setLocalDraft(next);};
 const draftOrigin=currentDraft.origin??hive??preferences.preferences.proxies.find(entry=>entry.device_scope===null)?.origin??'';
 const setDraftOrigin=(origin:string)=>patchDraft({origin});
 const proxy=currentDraft.proxy??(paired?'':draftProxy(preferences.preferences,hive??draftOrigin));
 const setProxy=(proxy:string)=>patchDraft({proxy});
 const target=navigationRequest?.target;
 useEffect(()=>{if(target?.page==='settings'&&target.section&&target.section in settingsTabForSection)patchDraft({tab:settingsTabForSection[target.section as keyof typeof settingsTabForSection]});},[navigationRequest?.sequence]);
 const saved=currentDraft.saved&&currentDraft.saved.preferences.revision>=preferences.preferences.revision?currentDraft.saved:preferences;
 const network=currentDraft.network??null,permission=currentDraft.permission??null,autostart=currentDraft.autostart??null,test=currentDraft.test??null;
 const busy=currentDraft.busy??null,error=currentDraft.error??null,notice=currentDraft.notice??'',permissionError=currentDraft.permissionError??null,autostartError=currentDraft.autostartError??null,autostartReadError=currentDraft.autostartReadError??null,deliveryError=currentDraft.deliveryError??null;
 const control=currentDraft.control??localDraft.control!;
 const mounted=useRef(false),proxyDirty=useRef(!!currentDraft.dirty);proxyDirty.current=!!currentDraft.dirty;
 const owner=useRef({preferencesClient,notificationsClient,networkClient});owner.current={preferencesClient,notificationsClient,networkClient};
 const current=()=>!!(isCurrentScope?isCurrentScope():mounted.current)&&owner.current.preferencesClient===preferencesClient&&owner.current.notificationsClient===notificationsClient&&owner.current.networkClient===networkClient;
 const setTest=(test:NetworkTestResult|null)=>patchDraft({test});
 const setProxyValue=(value:NetworkSnapshot)=>{patchDraft({network:value});if(paired&&!draftRef.current.dirty)setProxy(value.saved_proxy);};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{if(!paired&&!draftRef.current.dirty){const origin=hive??draftOrigin;if(origin!==draftOrigin)setDraftOrigin(origin);setProxy(draftProxy(saved.preferences,origin));}},[preferences,hive,paired]);
 const prefs=saved.preferences;
 function acceptPreferences(value:PreferencesSnapshot){if(!current())return;patchDraft({saved:value});onSaved(value);if(value.error)throw value.error;}
 async function readPreferences(){try{const value=await preferencesClient.read();if(!current())return;acceptPreferences(value);patchDraft({preferenceReadError:null});return value;}catch(cause){if(current())patchDraft({preferenceReadError:normalizeFailure(cause,'preferences_read')});}}
 async function refreshNetwork(){
  const request=++control.networkRead;
  try{const value=await networkClient.snapshot();if(!current()||request!==control.networkRead)return;setProxyValue(value);patchDraft({networkReadError:value.error?normalizeFailure(value.error,'network_snapshot'):null});return value;}
  catch(cause){if(current()&&request===control.networkRead)patchDraft({networkReadError:normalizeFailure(cause,'network_snapshot')});}
 }
 async function refreshRuntime(){if(!readRuntime)return;try{const value=await readRuntime();if(current())patchDraft({runtime:value.view,runtimeReadError:value.failure});}catch(cause){if(current())patchDraft({runtimeReadError:normalizeFailure(cause,'runtime_snapshot')});}}
 async function readOs(){
  const permissionRequest=++control.permissionRead,autostartRequest=++control.autostartRead,deliveryRequest=++control.deliveryRead;
  const results=await Promise.allSettled([notificationsClient.permission(),notificationsClient.autostartStatus(),notificationsClient.deliveryStatus()]);if(!current())return;
  if(permissionRequest===control.permissionRead){const r=results[0];patchDraft(r.status==='fulfilled'?{permission:r.value,permissionError:null,notificationState:'confirmed'}:{permission:null,permissionError:normalizeFailure(r.reason,'notification_permission')});}
  if(autostartRequest===control.autostartRead){
   const r=results[1];
   // Status can carry a preference-read error even when the OS returned a boolean.
   if(r.status==='fulfilled'&&!r.value.error&&typeof r.value.registered==='boolean')patchDraft({autostart:r.value,autostartState:'confirmed',autostartReadConfirmed:true,autostartError:null,autostartReadError:null});
   else patchDraft({autostartReadConfirmed:false,autostartReadError:r.status==='rejected'?normalizeFailure(r.reason,'autostart_status'):r.value.error?normalizeFailure(r.value.error,'autostart_status'):null});
  }
  if(deliveryRequest===control.deliveryRead){const r=results[2];patchDraft({deliveryError:r.status==='fulfilled'?(r.value.error?normalizeFailure(r.value.error,'notification_delivery'):null):normalizeFailure(r.reason,'notification_delivery')});}
 }
 useEffect(()=>{if(control.operation)return;void refreshNetwork();void readOs();},[preferencesClient,notificationsClient,networkClient]);
 async function run(name:string,action:()=>Promise<unknown>){
  if(control.operation)return;control.operation=name;patchDraft({busy:name,error:null,notice:''});
  try{await action();}catch(cause){if(current())patchDraft({error:normalizeFailure(cause,'settings_'+name)});}
  finally{control.operation=null;if(current())patchDraft({busy:null});}
 }
 async function savePreference(change:Partial<DesktopPreferences>){const value=await preferencesClient.save(prefs.revision,{...prefs,...change});acceptPreferences(value);}
 function changePreference(change:Partial<DesktopPreferences>){void run('preferences',async()=>{await savePreference(change);if(current())patchDraft({notice:'偏好已保存。'});});}
 async function enableNotifications(){
  const request=++control.permissionRead;patchDraft({notificationState:'pending',permission:null,permissionError:null});
  try{const allowed=await notificationsClient.enable();if(current()&&request===control.permissionRead)patchDraft({permission:allowed,notificationState:'confirmed'});}
  catch(cause){if(current()&&request===control.permissionRead)patchDraft({permission:null,notificationState:'unknown',permissionError:normalizeFailure(cause,'notification_enable')});}
 }
 function notifications(enabled:boolean){void run('notifications',async()=>{await savePreference({notifications_enabled:enabled});if(!current())return;patchDraft({notice:'通知偏好已保存。'});if(enabled)await enableNotifications();});}
 function setStartup(enabled:boolean){void run('autostart',async()=>{
  if(draftRef.current.autostartState==='unknown')return;
  const request=++control.autostartRead;patchDraft({autostartDesired:enabled,autostartState:'pending',autostartError:null});
  try{
   const actual=await notificationsClient.autostartSet(enabled);if(!current()||request!==control.autostartRead)return;
   if(typeof actual.registered!=='boolean'){patchDraft({autostartState:'unknown',autostartReadConfirmed:false,autostartError:actual.error?normalizeFailure(actual.error,'autostart_set'):null});return;}
   // Native set saves the desired preference before applying and reading registration.
   // A boolean proves the observed registration; its write failure still remains visible.
   patchDraft({autostart:actual,autostartState:'confirmed',autostartDesired:enabled,autostartReadConfirmed:true,autostartError:actual.error?normalizeFailure(actual.error,'autostart_set'):null,autostartReadError:null});
   await readPreferences();if(current()&&!actual.error&&actual.registered===enabled)patchDraft({notice:'已核对系统启动登记。'});
  }
  catch(cause){if(current()&&request===control.autostartRead)patchDraft({autostartState:'unknown',autostartReadConfirmed:false,autostartError:normalizeFailure(cause,'autostart_set')});}
 });}
 function saveProxy(){void run('save-proxy',async()=>{
  if(draftRef.current.proxySave==='unknown'&&!draftRef.current.saveReadConfirmed||draftRef.current.applyState==='pending')return;
  control.networkRead++;patchDraft({proxySave:'pending',saveFailure:null,saveReadConfirmed:false});
  const origin=hive??draftOrigin.trim();
  try{const value=await networkClient.saveProxy({proxy,origin:origin||null,expectedRevision:prefs.revision});if(!current())return;acceptPreferences(value);patchDraft({proxySave:'confirmed',savedProxy:{value:proxy,revision:value.preferences.revision},dirty:false,notice:'代理配置已保存。'});if(!paired)setProxy(draftProxy(value.preferences,origin));await refreshNetwork();}
  catch(cause){if(current()){const fail=normalizeFailure(cause,'network_save_proxy');patchDraft({proxySave:requestNotSent(fail)?'failed':'unknown',saveFailure:fail});}}
 });}
 async function applySaved(){await run('apply',async()=>{
  if(draftRef.current.applyState==='unknown')return;
  control.networkRead++;patchDraft({applyState:'pending',applyFailure:null});
  try{const actual=await networkClient.applySaved(true);if(!current())return;setProxyValue(actual);patchDraft({applyState:actual.error?'failed':'confirmed',applyFailure:actual.error?normalizeFailure(actual.error,'network_apply'):null});}
  catch(cause){if(!current())return;const fail=normalizeFailure(cause,'network_apply');patchDraft({applyState:requestNotSent(fail)?'failed':'unknown',applyFailure:fail});}
  if(current())await Promise.allSettled([refreshNetwork(),refreshRuntime()]);
 });}
 const applyFailure=currentDraft.applyFailure,networkReadError=currentDraft.networkReadError;
 const saveBlocked=currentDraft.proxySave==='pending'||currentDraft.proxySave==='unknown'&&!currentDraft.saveReadConfirmed||currentDraft.applyState==='pending';
 const applyBlocked=!!busy||!!networkReadError||currentDraft.applyState==='unknown';
 const permissionHelp=os==='darwin'||os==='macos'?'在 macOS“系统设置 → 通知 → Bee”中允许通知。应用内提醒会继续显示。':os==='windows'?'在 Windows“设置 → 系统 → 通知 → Bee”中允许通知。应用内提醒会继续显示。':'请在当前桌面环境的通知设置中核对 Bee 权限；具体位置取决于桌面环境。应用内提醒会继续显示。';

 return <Tabs.Root className="native-settings section-tabs" data-testid="native-settings" value={currentDraft.tab??'network'} onValueChange={tab=>patchDraft({tab})}>
  <Tabs.List className="section-tabs-list ns-tabs" aria-label={t('设置分类')}><Tabs.Trigger value="general">{t('通用')}</Tabs.Trigger><Tabs.Trigger value="network">{t('网络与代理')}</Tabs.Trigger><Tabs.Trigger value="system">{t('通知与启动')}</Tabs.Trigger><Tabs.Trigger value="about">{t('关于')}</Tabs.Trigger></Tabs.List>
  {(error||saved.error)&&<div className="ns-failure"><FailureNotice failure={error||saved.error} check="settings_operation" onNavigate={onNavigate}/>{saved.error&&<button disabled={!!busy} onClick={()=>void run('preferences',readPreferences)}>{t('重新读取偏好')}</button>}</div>}{currentDraft.preferenceReadError&&<div className="ns-failure"><FailureNotice failure={currentDraft.preferenceReadError} check="preferences_read"/>{autostart&&<p>{t('系统登记回执已保留，偏好读取尚未确认。')}</p>}<button disabled={!!busy} onClick={()=>void run('preferences',readPreferences)}>{t('重新读取偏好')}</button></div>}{notice&&notice!=='代理配置已保存。'&&<p className="operation-message" role="status">{t(notice)}</p>}
  <Tabs.Content value="general">  <section className="ns-section" aria-labelledby="ns-preferences-title"><header><h2 id="ns-preferences-title">{t('语言与外观')}</h2><p>{t('保存到当前系统用户，重启后保留。')}</p></header>
   <div className="ns-row"><label htmlFor="ns-language">{t('语言')}</label><select id="ns-language" data-settings-section="appearance" disabled={!!busy||!!saved.error} value={prefs.language} onChange={event=>changePreference({language:event.target.value as DesktopPreferences['language']})}><option value="system">{t('跟随系统')}</option><option value="zh">{t('中文')}</option><option value="en">English</option></select></div>
   <div className="ns-row"><label htmlFor="ns-theme">{t('外观')}</label><select id="ns-theme" disabled={!!busy||!!saved.error} value={prefs.theme} onChange={event=>changePreference({theme:event.target.value as DesktopPreferences['theme']})}><option value="system">{t('跟随系统')}</option><option value="light">{t('浅色')}</option><option value="dark">{t('深色')}</option></select></div>
  </section></Tabs.Content>
  <Tabs.Content value="network">  <section className="ns-section" aria-labelledby="ns-network-title"><header><h2 id="ns-network-title">{t('网络与代理')}</h2><p>{t(proxy?'使用本机代理时，先启动对应代理工具，再保存或测试。':'可直接连接；只有需要本机代理时才填写下面的地址。')}</p></header>
<div className="ns-network-layout"><div className="ns-network-editor"><p className="ns-scope"><span>{t('适用范围')}</span>{hive||draftOrigin||t('尚未配对')}</p>   <form onSubmit={event=>{event.preventDefault();saveProxy();}}>{!paired&&!hive&&<label className="ns-proxy-input" htmlFor="ns-draft-origin">{t('代理草稿的 Hive 地址')}<input id="ns-draft-origin" name="hive-origin" autoComplete="off" type="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={2048} disabled={!!busy||!!saved.error} value={draftOrigin} placeholder="https://hive.example" onChange={event=>{const origin=event.target.value;setDraftOrigin(origin);proxyDirty.current=false;patchDraft({dirty:false});setProxy(draftProxy(prefs,origin.trim()));setTest(null);}}/></label>}{!paired&&<p className="feature-note">{t('配对前可保存代理草稿；绑定该 Hive 后再应用。')}</p>}<label className="ns-proxy-input" htmlFor="ns-proxy">{t('本机 HTTP 代理')}<input id="ns-proxy" name="local-http-proxy" autoComplete="off" data-settings-section="network" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={256} disabled={!!busy||!!saved.error} value={proxy} placeholder="http://127.0.0.1:7890" onChange={event=>{proxyDirty.current=true;patchDraft({dirty:true});setProxy(event.target.value);setTest(null);}}/></label>
    <p className="feature-note">{t('留空关闭。仅支持无认证的回环 IP 与端口；不修改系统代理。')}</p><div className="inline-actions ns-network-actions"><button className="primary" type="submit" disabled={!!busy||!!saved.error||saveBlocked}>{t('保存代理')}</button><button type="button" disabled={!!busy} aria-busy={busy==='test'} onClick={()=>void run('test',async()=>{const value=await networkClient.test(proxy);if(current())setTest(value);})}>{t(busy==='test'?'正在测试…':'测试连接')}</button></div>
   </form>
   {test&&<div className="ns-test" role="status"><p>{t('这三个目标只检查上游网络可达性，不检查 Hive；HTTP 401、403、429 不证明授权或额度。')}</p><ul>{test.checks.map(check=><li key={check.id}><div><strong>{t(checkNames[check.id])}</strong><span>{t(check.status==='ok'?'可达':check.status==='failed'?'失败':'已跳过')}</span></div><p>{path(check.path)}{check.http_status!==null&&` · HTTP ${check.http_status}`}</p><p>{({local_proxy:'CONNECT chatgpt.com:443',openai_read_only:'GET https://chatgpt.com/backend-api/wham/usage',claude_read_only:'GET https://api.anthropic.com/api/oauth/profile'} as const)[check.id]}</p><details><summary>{t('检查详情')}</summary><p>{check.message}</p><time dateTime={test.observed_at}>{formatDate(test.observed_at,currentLocale())}</time></details></li>)}</ul></div>}
   {currentDraft.proxySave==='confirmed'&&<p className="operation-message" role="status">{t(networkReadError?'代理配置已保存；生效状态尚未确认。':network?.pending_restart?'代理已保存；当前仍使用上次生效配置。':'代理配置已保存。')}</p>}
   {currentDraft.saveFailure&&<FailureNotice failure={currentDraft.saveFailure} check="network_save_proxy" onNavigate={onNavigate}/>}
   {currentDraft.proxySave==='unknown'&&<div className="ns-recovery"><p role="status">{t(currentDraft.saveReadConfirmed?'上次保存请求结果尚未确认；当前配置已重新读取。检查后可明确保存新的选择。':'保存请求结果尚未确认；先读取当前偏好和网络状态，不会重复保存。')}</p><button disabled={!!busy} onClick={()=>void run('read-save',async()=>{const [saved,network]=await Promise.all([readPreferences(),refreshNetwork()]);if(current()&&saved&&!saved.error&&network&&!network.error&&saved.preferences.revision===network.saved_revision)patchDraft({saveReadConfirmed:true});})}>{t('核对当前保存配置')}</button></div>}
   {applyFailure&&<FailureNotice failure={applyFailure} check="network_apply" onNavigate={onNavigate}/>}
   {currentDraft.applyState&&<div className="ns-recovery"><p role="status">{t(currentDraft.applyState==='unknown'?'应用请求结果尚未确认；只读取当前配置与运行状态，不会再次停止或应用。':currentDraft.applyState==='pending'?'正在等待网络应用回执…':applyFailure?.check==='network_restore'||applyFailure?.code==='NETWORK_RESTORE_UNCONFIRMED'?'网络配置已生效，但贡献恢复未完成。':currentDraft.applyState==='failed'?'网络应用未完整确认；配置和运行状态分别列出。':'已收到网络应用回执；贡献状态以当前读取为准。')}</p>{currentDraft.runtimeReadError?<FailureNotice failure={currentDraft.runtimeReadError} check="runtime_snapshot"/>:<p>{t('当前贡献进程')}：{t(({running:'运行中',stopped:'已停止',starting:'正在启动',stopping:'正在停止',failed:'运行失败'} as Record<string,string>)[currentDraft.runtime?.local??'']??'尚未确认')}</p>}</div>}
   {paired&&network?.pending_restart&&<div className="ns-pending"><p>{t('下次启动生效。当前连接继续使用已生效配置。')}</p><ConfirmDialog destructive trigger={<button className="ns-danger-button" disabled={applyBlocked}>{t('停止并重新启动以应用')}</button>} title={t('应用保存的代理？')} description={t('将停止当前贡献，可能中断任务；随后按此前运行选择恢复，保留暂停和待确认换号。')} confirmLabel={t('停止并重新启动')} busy={busy==='apply'} onConfirm={async()=>{void applySaved();}}/></div>}
</div><aside className="ns-observed" aria-label={t('配置与实际路径')}><header><h3>{t('配置与实际路径')}</h3><button type="button" disabled={!!busy} onClick={()=>void run('network',async()=>{await Promise.allSettled([refreshNetwork(),refreshRuntime()]);})}>{t('刷新生效路径')}</button></header>   <dl className="ns-network-summary"><div><dt>{t('已保存配置')}</dt><dd>{paired?(currentDraft.savedProxy&&(!network||currentDraft.savedProxy.revision>network.saved_revision)?currentDraft.savedProxy.value||t('代理未启用'):network?network.saved_proxy||t('代理未启用'):t('尚未读取')):(draftProxy(prefs,hive??draftOrigin.trim())||t('代理未启用'))}</dd></div><div><dt>{t(networkReadError?'上次确认的生效配置':'当前生效配置')}</dt><dd>{network?(network.effective_proxy||t('代理未启用')):t('尚未确认')}</dd></div></dl>
   {networkReadError&&<FailureNotice failure={networkReadError} check="network_snapshot" onNavigate={onNavigate}/>}<table className="ns-paths"><caption>{t(networkReadError?'上次确认的实际路径':'当前实际生效路径')}</caption><thead><tr><th scope="col">{t('流量')}</th><th scope="col">{t('路径')}</th></tr></thead><tbody><tr><th scope="row">{t('Bee 转发的上游连接')}</th><td>{path(network?.paths.relay??'unknown')}</td></tr><tr><th scope="row">{t('官方查询与续期')}</th><td>OpenAI: {officialPath(network?.paths.official??'unknown','openai')}<br/>Claude: {officialPath(network?.paths.official??'unknown','claude')}</td></tr><tr><th scope="row">Hive HTTP / WebSocket</th><td>{t(network?'沿用进程环境':'尚未确认')}</td></tr><tr><th scope="row">{t('官方客户端登录')}</th><td>{t(network?'由官方客户端管理':'尚未确认')}</td></tr></tbody></table>
   <p className="feature-note">{t('官方查询优先使用进程环境代理，并遵守直连规则；环境配置原文不会显示。')}</p>
</aside></div></section></Tabs.Content>
  <Tabs.Content value="system"><section className="ns-section" aria-labelledby="ns-system-title" data-settings-section="notifications" tabIndex={-1}><header><h2 id="ns-system-title">{t('通知与启动')}</h2><p>{t('偏好与系统实际状态分别显示。')}</p></header>   <div className="ns-row ns-system-row"><div><label className="ns-check"><input type="checkbox" disabled={!!busy||!!saved.error||currentDraft.notificationState==='unknown'} checked={prefs.notifications_enabled} onChange={event=>notifications(event.target.checked)}/><span>{t('接收系统通知')}</span></label><p>{t('授权、换号、离线和额度问题仍会保留在应用内。')}</p></div><div className="ns-os-status"><span>{t('系统权限')}</span><strong>{t(permission==='granted'?'已允许':permission==='denied'?'已拒绝':permission==='prompt'?'尚未允许':'尚未确认')}</strong></div></div>
   {permissionError&&<FailureNotice failure={permissionError} check="system_permissions"/>}
   {deliveryError&&<div className="ns-delivery-error"><FailureNotice failure={deliveryError} check="notification_delivery"/>{prefs.notifications_enabled&&permission==='granted'&&<button disabled={!!busy} onClick={()=>void run('notification-retry',async()=>{await notificationsClient.retry();if(current())patchDraft({notice:'将在下次后台检查时重试明确失败的通知。'});})}>{t('重试失败的通知')}</button>}</div>}
   {permission==='denied'&&<p className="feature-note">{t(permissionHelp)}</p>}{currentDraft.notificationState==='unknown'&&<p className="feature-note">{t('通知授权请求结果尚未确认；请重新检查系统状态，不会重复请求授权。')}</p>}
   {prefs.notifications_enabled&&permission==='prompt'&&<button disabled={!!busy} onClick={()=>void run('permission',enableNotifications)}>{t('允许系统通知')}</button>}
   <div className="ns-row ns-system-row"><div><label className="ns-check"><input type="checkbox" disabled={!!busy||!!saved.error||currentDraft.autostartState==='unknown'} checked={currentDraft.autostartDesired??autostart?.desired??prefs.autostart_desired} onChange={event=>setStartup(event.target.checked)}/><span>{t('登录系统后启动 Bee')}</span></label><p>{t('登录系统后按既有运行意图恢复；不会自动授权、接入账号或解除手动暂停。')}</p></div><div className="ns-os-status"><span>{t(autostart&&(currentDraft.autostartState==='unknown'||currentDraft.autostartReadConfirmed===false)?'上次确认的系统登记':'系统登记')}</span><strong>{t(autostart?.registered===true?'已登记':autostart?.registered===false?'未登记':'尚未确认')}</strong></div></div>
   {currentDraft.autostartState==='unknown'&&<p>{t('启动登记请求结果尚未确认；只读取系统登记与偏好，不会重复登记。')}</p>}{autostart&&currentDraft.autostartState==='confirmed'&&currentDraft.autostartReadConfirmed===true&&typeof autostart.registered==='boolean'&&autostart.registered!==(currentDraft.autostartDesired??autostart.desired)&&<p className="feature-note">{t('期望启动选项与系统登记不一致；请核对实际登记及失败详情。')}</p>}{autostartError&&<FailureNotice failure={autostartError} check="autostart_set"/>}{autostartReadError&&<FailureNotice failure={autostartReadError} check="autostart_status"/>}
   <div className="ns-secondary-actions"><button disabled={!!busy} onClick={()=>void run('os',async()=>{await Promise.allSettled([readOs(),readPreferences()]);})}>{t('重新检查系统状态')}</button></div>
<p className="ns-window-note">{t('关窗后继续后台运行，可从托盘、菜单或再次启动找回窗口。')}</p></section></Tabs.Content>
  <Tabs.Content value="about"><section className="ns-section ns-about" data-settings-section="about" tabIndex={-1} aria-label={t('关于 Bee')}><header><h2>{t('关于 Bee')}</h2><p>{t('当前应用、运行核心与 Hive 信息。')}</p></header>{updateControls}{updateControls&&version!==appVersion&&<p className="ns-core-version feature-note">{t('Bee 版本')}：{version||t('尚未读取')}</p>}<dl>{!updateControls&&<><div><dt>{t('桌面应用版本')}</dt><dd>{appVersion}</dd></div><div><dt>{t('Bee 版本')}</dt><dd>{version||t('尚未读取')}</dd></div></>}<div><dt>Hive</dt><dd>{hive??t(contextKnown?'尚未配置 Hive':'本机 Hive 信息尚未确认')}</dd></div></dl><p className="feature-note">{t(paired?'Hive 设备身份已核对。':hive?'显示上次保存的 Hive，远端身份尚未确认。':contextKnown?'请在概览连接本机设备；配对不会自动开始贡献。':'本机保存信息尚未确认；不能据此判定设备未绑定。')}</p></section></Tabs.Content>
 </Tabs.Root>;
}
