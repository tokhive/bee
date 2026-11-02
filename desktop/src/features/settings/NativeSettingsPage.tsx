import {FailureNotice} from '../../components/ProblemNotice';
import {settingsTabForSection,type NavigationRequest,type NavigationTarget} from '../../app/navigation';
import {normalizeFailure,type UiFailure} from '../../system/failures';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Tabs} from 'radix-ui';
import {version as appVersion} from '../../../package.json';
import '../../styles/section-tabs.css';
import {ConfirmDialog} from '../../components/ConfirmDialog';
import {t} from '../../i18n/index';
import type {DesktopPreferences,PreferencesClient,PreferencesSnapshot} from '../../system/preferences';
import type {AutostartSnapshot,NotificationPermission,createNotificationsClient} from '../../system/notifications';
import type {NetworkClient,NetworkSnapshot,NetworkTestResult} from '../../system/network';
import './native-settings.css';

export interface NativeSettingsDraft {proxy?:string;origin?:string;dirty?:boolean;tab?:string}
export interface NativeSettingsPageProps {
 draft?:NativeSettingsDraft;onDraftChange?:(draft:NativeSettingsDraft)=>void;navigationRequest?:NavigationRequest;
 preferences:PreferencesSnapshot;
 preferencesClient:PreferencesClient;
 notificationsClient:ReturnType<typeof createNotificationsClient>;
 networkClient:NetworkClient;
 hive?:string;
 paired?:boolean;
 version?:string;
 updateControls?:ReactNode;
 onSaved:(snapshot:PreferencesSnapshot)=>void;
 onNavigate?:(target:NavigationTarget)=>void;
}
const failure=(cause:unknown)=>normalizeFailure(cause,'settings_operation');
function path(value:string){return t(({direct:'直连',local_proxy:'本机代理',environment_proxy:'进程环境代理',unknown:'尚未确认'} as Record<string,string>)[value]??'尚未确认');}
function officialPath(value:string,platform:'openai'|'claude'){return path(value.split(';').find(part=>part.startsWith(`${platform}=`))?.split('=')[1]??'unknown');}
const checkNames={local_proxy:'本机代理连接',openai_read_only:'OpenAI 只读端点',claude_read_only:'Claude 只读端点'};
const draftProxy=(preferences:DesktopPreferences,origin:string)=>preferences.proxies.find(entry=>entry.origin===origin&&entry.device_scope===null)?.connect_proxy??'';

export function NativeSettingsPage({preferences,preferencesClient,notificationsClient,networkClient,hive,paired=false,version,updateControls,onSaved,onNavigate,draft,onDraftChange,navigationRequest}:NativeSettingsPageProps){
 const [localDraft,setLocalDraft]=useState<NativeSettingsDraft>({});
 const currentDraft=draft??localDraft,draftRef=useRef(currentDraft);draftRef.current=currentDraft;
 const patchDraft=(change:Partial<NativeSettingsDraft>)=>{const next={...draftRef.current,...change};draftRef.current=next;if(onDraftChange)onDraftChange(next);else setLocalDraft(next);};
 const draftOrigin=currentDraft.origin??hive??preferences.preferences.proxies.find(entry=>entry.device_scope===null)?.origin??'';
 const setDraftOrigin=(origin:string)=>patchDraft({origin});
 const proxy=currentDraft.proxy??(paired?'':draftProxy(preferences.preferences,hive??draftOrigin));
 const setProxy=(proxy:string)=>patchDraft({proxy});
 const target=navigationRequest?.target;
 useEffect(()=>{if(target?.page==='settings'&&target.section&&target.section in settingsTabForSection)patchDraft({tab:settingsTabForSection[target.section as keyof typeof settingsTabForSection]});},[navigationRequest?.sequence]);
 const [saved,setSaved]=useState(preferences),[network,setNetwork]=useState<NetworkSnapshot|null>(null);
 const [permission,setPermission]=useState<NotificationPermission|null>(null),[autostart,setAutostart]=useState<AutostartSnapshot|null>(null),[test,setTest]=useState<NetworkTestResult|null>(null);
 const [busy,setBusy]=useState<string|null>(null),[error,setError]=useState<UiFailure|null>(null),[notice,setNotice]=useState(''),[permissionError,setPermissionError]=useState<UiFailure|null>(null),[autostartError,setAutostartError]=useState<UiFailure|null>(null);
 const [deliveryError,setDeliveryError]=useState<UiFailure|null>(null);
 const mounted=useRef(false),operation=useRef(false),generation=useRef(0),networkRead=useRef(0),permissionRead=useRef(0),autostartRead=useRef(0),deliveryRead=useRef(0),proxyDirty=useRef(!!currentDraft.dirty);
 const owner=useRef({preferencesClient,notificationsClient,networkClient,hive,paired});owner.current={preferencesClient,notificationsClient,networkClient,hive,paired};
 const current=()=>mounted.current&&owner.current.preferencesClient===preferencesClient&&owner.current.notificationsClient===notificationsClient&&owner.current.networkClient===networkClient&&owner.current.hive===hive&&owner.current.paired===paired;
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{setSaved(previous=>preferences.preferences.revision>=previous.preferences.revision?preferences:previous);},[preferences]);
 useEffect(()=>{
  if(paired||proxyDirty.current)return;
  const origin=hive??(draftOrigin||preferences.preferences.proxies.find(entry=>entry.device_scope===null)?.origin||'');
  if(origin!==draftOrigin)setDraftOrigin(origin);setProxy(draftProxy(preferences.preferences,origin));
 },[preferences,hive,paired]);
 useEffect(()=>{
  const epoch=++generation.current,request=++networkRead.current,permissionRequest=++permissionRead.current,autostartRequest=++autostartRead.current;operation.current=false;setBusy(null);setNetwork(null);setTest(null);if(!proxyDirty.current)setProxy(paired?'':draftProxy(preferences.preferences,hive??draftOrigin));setError(null);setNotice('');setPermission(null);setAutostart(null);setPermissionError(null);setAutostartError(null);
  void networkClient.snapshot().then(value=>{if(current()&&epoch===generation.current&&request===networkRead.current){setNetwork(value);if(paired&&!proxyDirty.current)setProxy(value.saved_proxy);if(value.error)setError(failure(value.error));}},cause=>{if(current()&&epoch===generation.current&&request===networkRead.current)setError(failure(cause));});
  void notificationsClient.permission().then(value=>{if(current()&&epoch===generation.current&&permissionRequest===permissionRead.current)setPermission(value);},cause=>{if(current()&&epoch===generation.current&&permissionRequest===permissionRead.current)setPermissionError(failure(cause));});
  void notificationsClient.autostartStatus().then(value=>{if(current()&&epoch===generation.current&&autostartRequest===autostartRead.current){setAutostart(value);if(value.error)setAutostartError(failure(value.error));}},cause=>{if(current()&&epoch===generation.current&&autostartRequest===autostartRead.current)setAutostartError(failure(cause));});
  const deliveryRequest=++deliveryRead.current;setDeliveryError(null);
  void notificationsClient.deliveryStatus().then(value=>{if(current()&&epoch===generation.current&&deliveryRequest===deliveryRead.current)setDeliveryError(value.error?failure(value.error):null);},cause=>{if(current()&&epoch===generation.current&&deliveryRequest===deliveryRead.current)setDeliveryError(failure(cause));});
  return()=>{generation.current++;networkRead.current++;};
 },[preferencesClient,notificationsClient,networkClient,hive,paired]);
 const prefs=saved.preferences;
 function acceptPreferences(value:PreferencesSnapshot){if(!current())return;setSaved(value);onSaved(value);if(value.error)throw value.error;}
 async function run(name:string,action:()=>Promise<unknown>){
  if(operation.current)return;operation.current=true;setBusy(name);setError(null);setNotice('');const epoch=generation.current;
  try{await action();}catch(cause){if(current()&&epoch===generation.current)setError(failure(cause));}
  finally{if(current()&&epoch===generation.current){operation.current=false;setBusy(null);}}
 }
 async function savePreference(change:Partial<DesktopPreferences>){
  const value=await preferencesClient.save(prefs.revision,{...prefs,...change});acceptPreferences(value);
 }
 async function refreshNetwork(){
  const request=++networkRead.current,value=await networkClient.snapshot();if(!current()||request!==networkRead.current)return;
  setNetwork(value);if(paired&&!proxyDirty.current)setProxy(value.saved_proxy);if(value.error)throw value.error;return value;
 }
 function changePreference(change:Partial<DesktopPreferences>){void run('preferences',async()=>{await savePreference(change);if(current())setNotice('偏好已保存。');});}
 function notifications(enabled:boolean){void run('notifications',async()=>{
  await savePreference({notifications_enabled:enabled});if(!current())return;
  if(enabled){permissionRead.current++;const allowed=await notificationsClient.enable();if(!current())return;setPermission(allowed);setPermissionError(null);}
  if(current())setNotice('通知偏好已保存。');
 });}
 function setStartup(enabled:boolean){void run('autostart',async()=>{
  autostartRead.current++;const actual=await notificationsClient.autostartSet(enabled);if(!current())return;setAutostart(actual);setAutostartError(actual.error?failure(actual.error):null);
  const value=await preferencesClient.read();acceptPreferences(value);
  if(actual.error)throw actual.error;
  if(actual.registered!==enabled)throw new Error(`AUTOSTART_UNCONFIRMED: desired=${enabled} registered=${actual.registered}; required=matching OS readback`);
  if(current())setNotice('已核对系统启动登记。');
 });}
 async function applySaved(){await run('apply',async()=>{
  networkRead.current++;const actual=await networkClient.applySaved(true);if(!current())return;setNetwork(actual);if(actual.error)throw actual.error;setNotice('已应用保存的代理，并按此前选择恢复。');
 });}
 return <Tabs.Root className="native-settings section-tabs" data-testid="native-settings" value={currentDraft.tab??'network'} onValueChange={tab=>patchDraft({tab})}>
  <Tabs.List className="section-tabs-list ns-tabs" aria-label={t('设置分类')}><Tabs.Trigger value="general">{t('通用')}</Tabs.Trigger><Tabs.Trigger value="network">{t('网络与代理')}</Tabs.Trigger><Tabs.Trigger value="system">{t('通知与启动')}</Tabs.Trigger><Tabs.Trigger value="about">{t('关于')}</Tabs.Trigger></Tabs.List>
  {(error||saved.error)&&<div className="ns-failure"><FailureNotice failure={error||saved.error} check="settings_operation" onNavigate={onNavigate}/>{saved.error&&<button disabled={!!busy} onClick={()=>void run('preferences',async()=>acceptPreferences(await preferencesClient.read()))}>{t('重新读取偏好')}</button>}</div>}{notice&&<p className="operation-message" role="status">{t(notice)}</p>}
  <Tabs.Content value="general">  <section className="ns-section" aria-labelledby="ns-preferences-title"><header><h2 id="ns-preferences-title">{t('语言与外观')}</h2><p>{t('保存到当前系统用户，重启后保留。')}</p></header>
   <div className="ns-row"><label htmlFor="ns-language">{t('语言')}</label><select id="ns-language" data-settings-section="appearance" disabled={!!busy||!!saved.error} value={prefs.language} onChange={event=>changePreference({language:event.target.value as DesktopPreferences['language']})}><option value="system">{t('跟随系统')}</option><option value="zh">{t('中文')}</option><option value="en">English</option></select></div>
   <div className="ns-row"><label htmlFor="ns-theme">{t('外观')}</label><select id="ns-theme" disabled={!!busy||!!saved.error} value={prefs.theme} onChange={event=>changePreference({theme:event.target.value as DesktopPreferences['theme']})}><option value="system">{t('跟随系统')}</option><option value="light">{t('浅色')}</option><option value="dark">{t('深色')}</option></select></div>
  </section></Tabs.Content>
  <Tabs.Content value="network">  <section className="ns-section" aria-labelledby="ns-network-title"><header><h2 id="ns-network-title">{t('网络与代理')}</h2><p>{t('先启动本机代理工具，再保存或测试连接。')}</p></header>
<div className="ns-network-layout"><div className="ns-network-editor"><p className="ns-scope"><span>{t('适用范围')}</span>{hive||draftOrigin||t('尚未配对')}</p>   <form onSubmit={event=>{event.preventDefault();void run('save-proxy',async()=>{
    const origin=hive??draftOrigin.trim(),value=await networkClient.saveProxy({proxy,origin:origin||null,expectedRevision:prefs.revision});acceptPreferences(value);if(!current())return;proxyDirty.current=false;patchDraft({dirty:false});if(!paired)setProxy(draftProxy(value.preferences,origin));const actual=await refreshNetwork();if(current())setNotice(paired&&actual?.pending_restart?'代理已保存；下次启动生效。':'代理配置已保存。');
   });}}>{!paired&&!hive&&<label className="ns-proxy-input" htmlFor="ns-draft-origin">{t('代理草稿的 Hive 地址')}<input id="ns-draft-origin" type="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={2048} disabled={!!busy||!!saved.error} value={draftOrigin} placeholder="https://hive.example" onChange={event=>{const origin=event.target.value;setDraftOrigin(origin);proxyDirty.current=false;patchDraft({dirty:false});setProxy(draftProxy(prefs,origin.trim()));setTest(null);}}/></label>}{!paired&&<p className="feature-note">{t('配对前可保存代理草稿；绑定该 Hive 后再应用。')}</p>}<label className="ns-proxy-input" htmlFor="ns-proxy">{t('本机 HTTP 代理')}<input id="ns-proxy" data-settings-section="network" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={256} disabled={!!busy||!!saved.error} value={proxy} placeholder="http://127.0.0.1:7890" onChange={event=>{proxyDirty.current=true;patchDraft({dirty:true});setProxy(event.target.value);setTest(null);}}/></label>
    <p className="feature-note">{t('留空关闭。仅支持无认证的回环 IP 与端口；不修改系统代理。')}</p><div className="inline-actions ns-network-actions"><button className="primary" type="submit" disabled={!!busy||!!saved.error}>{t('保存代理')}</button><button type="button" disabled={!!busy} aria-busy={busy==='test'} onClick={()=>void run('test',async()=>{const value=await networkClient.test(proxy);if(current())setTest(value);})}>{t(busy==='test'?'正在测试…':'测试连接')}</button></div>
   </form>
   {test&&<div className="ns-test" role="status"><p>{t('只检查网络可达性，不证明授权或额度，不会开始贡献。')}</p><ul>{test.checks.map(check=><li key={check.id}><div><strong>{t(checkNames[check.id])}</strong><span>{t(check.status==='ok'?'可达':check.status==='failed'?'失败':'已跳过')}</span></div><p>{path(check.path)}{check.http_status!==null&&` · HTTP ${check.http_status}`}</p><p>{check.message}</p></li>)}</ul></div>}
   {paired&&network?.pending_restart&&<div className="ns-pending"><p>{t('下次启动生效。当前连接继续使用已生效配置。')}</p><ConfirmDialog destructive trigger={<button className="ns-danger-button" disabled={!!busy}>{t('停止并重新启动以应用')}</button>} title={t('应用保存的代理？')} description={t('将停止当前贡献，可能中断任务；随后按此前运行选择恢复，保留暂停和待确认换号。')} confirmLabel={t('停止并重新启动')} busy={busy==='apply'} onConfirm={applySaved}/></div>}
</div><aside className="ns-observed" aria-label={t('配置与实际路径')}><header><h3>{t('配置与实际路径')}</h3><button type="button" disabled={!!busy} onClick={()=>void run('network',refreshNetwork)}>{t('刷新生效路径')}</button></header>   <dl className="ns-network-summary"><div><dt>{t('已保存配置')}</dt><dd>{paired?(network?(network.saved_proxy||t('代理未启用')):t('尚未读取')):(draftProxy(prefs,hive??draftOrigin.trim())||t('代理未启用'))}</dd></div><div><dt>{t('当前生效配置')}</dt><dd>{network?(network.effective_proxy||t('代理未启用')):t('尚未确认')}</dd></div></dl>
   <table className="ns-paths"><caption>{t('当前实际生效路径')}</caption><thead><tr><th scope="col">{t('流量')}</th><th scope="col">{t('路径')}</th></tr></thead><tbody><tr><th scope="row">{t('Bee 转发的上游连接')}</th><td>{path(network?.paths.relay??'unknown')}</td></tr><tr><th scope="row">{t('官方查询与续期')}</th><td>OpenAI: {officialPath(network?.paths.official??'unknown','openai')}<br/>Claude: {officialPath(network?.paths.official??'unknown','claude')}</td></tr><tr><th scope="row">Hive HTTP / WebSocket</th><td>{t(network?'沿用进程环境':'尚未确认')}</td></tr><tr><th scope="row">{t('官方客户端登录')}</th><td>{t(network?'由官方客户端管理':'尚未确认')}</td></tr></tbody></table>
   <p className="feature-note">{t('官方查询优先使用进程环境代理，并遵守直连规则；环境配置原文不会显示。')}</p>
</aside></div></section></Tabs.Content>
  <Tabs.Content value="system"><section className="ns-section" aria-labelledby="ns-system-title" data-settings-section="notifications" tabIndex={-1}><header><h2 id="ns-system-title">{t('通知与启动')}</h2><p>{t('偏好与系统实际状态分别显示。')}</p></header>   <div className="ns-row ns-system-row"><div><label className="ns-check"><input type="checkbox" disabled={!!busy||!!saved.error} checked={prefs.notifications_enabled} onChange={event=>notifications(event.target.checked)}/><span>{t('希望接收系统通知')}</span></label><p>{t('授权、换号、离线和额度问题仍会保留在应用内。')}</p></div><div className="ns-os-status"><span>{t('系统权限')}</span><strong>{t(permission==='granted'?'已允许':permission==='denied'?'已拒绝':permission==='prompt'?'尚未允许':'尚未确认')}</strong></div></div>
   {permissionError&&<FailureNotice failure={permissionError} check="system_permissions"/>}
   {deliveryError&&<div className="ns-delivery-error"><FailureNotice failure={deliveryError} check="notification_delivery"/>{prefs.notifications_enabled&&permission==='granted'&&<button disabled={!!busy} onClick={()=>void run('notification-retry',async()=>{await notificationsClient.retry();if(current())setNotice('将在下次后台检查时重试明确失败的通知。');})}>{t('重试失败的通知')}</button>}</div>}
   {permission==='denied'&&<p className="feature-note">{t('请在系统设置中允许 Bee 发送通知；应用内提醒会继续显示。')}</p>}
   {prefs.notifications_enabled&&permission==='prompt'&&<button disabled={!!busy} onClick={()=>void run('permission',async()=>{permissionRead.current++;const value=await notificationsClient.enable();if(current()){setPermission(value);setPermissionError(null);}})}>{t('允许系统通知')}</button>}
   <div className="ns-row ns-system-row"><div><label className="ns-check"><input type="checkbox" disabled={!!busy||!!saved.error} checked={prefs.autostart_desired} onChange={event=>setStartup(event.target.checked)}/><span>{t('登录桌面后启动 Bee')}</span></label><p>{t('保留此前运行选择，不会自动授权或解除暂停。')}</p></div><div className="ns-os-status"><span>{t('系统登记')}</span><strong>{t(autostart?.registered===true?'已登记':autostart?.registered===false?'未登记':'尚未确认')}</strong></div></div>
   {autostartError&&<FailureNotice failure={autostartError} check="system_permissions"/>}
   <div className="ns-secondary-actions"><button disabled={!!busy} onClick={()=>void run('os',async()=>{
    permissionRead.current++;autostartRead.current++;deliveryRead.current++;const results=await Promise.allSettled([notificationsClient.permission(),notificationsClient.autostartStatus(),notificationsClient.deliveryStatus()]);if(!current())return;
    if(results[0].status==='fulfilled'){setPermission(results[0].value);setPermissionError(null);}else setPermissionError(failure(results[0].reason));
    if(results[1].status==='fulfilled'){setAutostart(results[1].value);setAutostartError(results[1].value.error?failure(results[1].value.error):null);}else setAutostartError(failure(results[1].reason));
    if(results[2].status==='fulfilled')setDeliveryError(results[2].value.error?failure(results[2].value.error):null);else setDeliveryError(failure(results[2].reason));
   })}>{t('重新检查系统状态')}</button></div>
<p className="ns-window-note">{t('关窗后继续后台运行，可从托盘、菜单或再次启动找回窗口。')}</p></section></Tabs.Content>
  <Tabs.Content value="about"><section className="ns-section ns-about" data-settings-section="about" tabIndex={-1} aria-label={t('关于 Bee')}><header><h2>{t('关于 Bee')}</h2><p>{t('当前应用、运行核心与 Hive 信息。')}</p></header>{updateControls}{updateControls&&version!==appVersion&&<p className="ns-core-version feature-note">{t('Bee 版本')}：{version||t('尚未读取')}</p>}<dl>{!updateControls&&<><div><dt>{t('桌面应用版本')}</dt><dd>{appVersion}</dd></div><div><dt>{t('Bee 版本')}</dt><dd>{version||t('尚未读取')}</dd></div></>}<div><dt>Hive</dt><dd>{hive??t('尚未配对')}</dd></div></dl></section></Tabs.Content>
 </Tabs.Root>;
}
