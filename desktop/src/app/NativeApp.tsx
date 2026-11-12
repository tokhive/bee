import {FailureNotice} from '../components/ProblemNotice';
import {normalizeFailure,type UiFailure} from '../system/failures';
import {validNavigationTarget,type NavigationTarget,type RecoveryContext,type NavigationRequest} from './navigation';
import {deriveDesktopStatus} from '../presentation/desktopStatus';
import {NativeUpdateControls} from '../features/settings/NativeUpdateControls';
import type {UpdateClient} from '../system/updater';
import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {AppShell} from '../components/AppShell';
import {StartupRecoveryNotice} from '../components/StartupRecoveryNotice';
import {NativeOverviewPage} from '../features/overview/NativeOverviewPage';
import {NativeAccountsPage} from '../features/accounts/NativeAccountsPage';
import {useAccounts} from '../features/accounts/useAccounts';
import {useRuntime} from '../features/lifecycle/useRuntime';
import {useSupply} from '../features/supply/useSupply';
import {NativeDiagnosticsPage} from '../features/diagnostics/NativeDiagnosticsPage';
import {NativeSettingsPage,type NativeSettingsDraft} from '../features/settings/NativeSettingsPage';
import {createDesktopState,type DesktopSnapshot,type DesktopState,idleRefresh} from '../system/desktopState';
import {defaultPreferences,type PreferencesClient,type PreferencesSnapshot} from '../system/preferences';
import type {createNotificationsClient} from '../system/notifications';
import type {NetworkClient} from '../system/network';
import type {DiagnosticsClient} from '../system/diagnostics';
import type {DeviceClient,DeviceView,DeviceRecoveryView} from '../system/device';
import type {AccountFactory} from '../system/accounts';
import type {RuntimeFactory} from '../system/runtime';
import type {AuthorizeFactory} from '../system/authorize';
import type {SupplyFactory} from '../system/supply';
import type {SystemBridge} from '../system/bridge';
import type {Page} from '../client/types';
import {t,useLanguage} from '../i18n/index';

interface NativeProps {
 /** Platform accounts with automatic service preparation. */
 autoService?:boolean;
 client:DeviceClient;supply:SupplyFactory;accountFactory:AccountFactory;runtimeFactory:RuntimeFactory;authorizeFactory:AuthorizeFactory;systemBridge:SystemBridge;
 updateClient:UpdateClient;preferencesClient:PreferencesClient;notificationsClient:ReturnType<typeof createNotificationsClient>;networkClient:NetworkClient;
 diagnosticsFactory:(instance:string|undefined,networkRevision:number,runId?:string|null,bindingRevision?:number)=>DiagnosticsClient;
 openHive:()=>Promise<unknown>;
}
const failure=(cause:unknown)=>normalizeFailure(cause,'device_status');
function supplyWriteContext(snapshot:DesktopSnapshot,local:Partial<Record<'openai'|'claude',string>>={}){
 return Object.fromEntries((['openai','claude'] as const).map(p=>{
  const account=snapshot.accounts[p],runtime=snapshot.runtime;
  return [p,JSON.stringify([runtime?.local,runtime?.run_id,runtime?.platforms[p]?.selection_revision,!!(snapshot.error??identityFailure(snapshot)),account?.selection.state,account?.selection.fingerprint,account?.hive.state,account?.hive.fingerprint,account?.hive.generation,!!snapshot.accountErrors[p],local[p]])];
 }));
}
const identityFailure=(s:DesktopSnapshot)=>s.deviceError??s.recoveryError??s.diagnosticFailure??(s.startup?.state==='blocked'?s.startup.failure:null);
const initial:DesktopSnapshot={native:{state:'starting'},deviceError:null,accounts:{},accountErrors:{},supplies:{},supplyErrors:{},error:null,busy:false,refresh:idleRefresh(),accountRefresh:{},supplyRefresh:{}};
function NativeWorkspace({props,snapshot,model,page,setPage,preferences,preferencesReady,onSaved,nativeLanguageFeedback}:{props:NativeProps;snapshot:DesktopSnapshot;model:DesktopState|undefined;page:Page;setPage:(page:Page)=>void;preferences:PreferencesSnapshot;preferencesReady:boolean;onSaved:(v:PreferencesSnapshot)=>void;nativeLanguageFeedback:ReactNode}){
 const {native,device:view}=snapshot;
 const [navigationRequest,setNavigationRequest]=useState<NavigationRequest>(()=>{const target={page};return {target:validNavigationTarget(target)?target:{page:'overview'},sequence:0};});
 const [recovery,setRecovery]=useState<RecoveryContext|null>(null);
 const [settingsDraft,setSettingsDraft]=useState<NativeSettingsDraft>({control:{operation:null,networkRead:0,permissionRead:0,autostartRead:0,deliveryRead:0}});
 const [sourceDirectories,setSourceDirectories]=useState<Partial<Record<'openai'|'claude',string>>>({});
 const setSourceDirectory=useCallback((platform:'openai'|'claude',value:string)=>setSourceDirectories(v=>({...v,[platform]:value})),[]);
 const presentation=deriveDesktopStatus(snapshot,Date.now(),props.autoService);
 const requestNavigation=(target:NavigationTarget)=>{setPage(target.page);setNavigationRequest(v=>({target,sequence:v.sequence+1}));};
 const navigate=(target:NavigationTarget)=>{
  if(!validNavigationTarget(target))return;
  const element=document.activeElement?.closest<HTMLElement>('[data-nav-section]');
  const section=element?.dataset.navSection,platform=element?.dataset.navPlatform;
  const from=page==='accounts'&&element?.classList.contains('native-account-row')?{page,...(platform?{platform}:{})}:{...navigationRequest.target,page,...(section?{section}:{}),...(platform?{platform}:{})};
  setRecovery({from:validNavigationTarget(from)?from:{page:'overview'},target});requestNavigation(target);
 };
 const returnFromRecovery=()=>{if(recovery){requestNavigation(recovery.from);setRecovery(null);}};
 const navigatePage=(next:Page)=>{const target={page:next};if(validNavigationTarget(target)){setRecovery(null);requestNavigation(target);}};
 useEffect(()=>{const target={page};if(navigationRequest.target.page!==page&&validNavigationTarget(target)){setRecovery(null);setNavigationRequest(v=>({target,sequence:v.sequence+1}));}},[page,navigationRequest.target.page]);
 const [busy,setBusy]=useState(false),[checking,setChecking]=useState(false),[error,setError]=useState<UiFailure|null>(null);const working=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const refresh=useCallback(()=>model?.refresh()??Promise.resolve(),[model]);
 const pause=useCallback(()=>model?.pause(),[model]);
 const run=async(action?:()=>Promise<DeviceView|unknown>,refreshAfter=true,check=false)=>{
  if(working.current)return;working.current=true;const setPending=check?setChecking:setBusy;setPending(true);if(!check)setError(null);
  const generation=model?.generation(),current=()=>mounted.current&&model?.generation()===generation;
  try{
   const binding=(value:DeviceView|undefined)=>JSON.stringify([value?.state,value?.hive,value?.user_code,value?.identity?.id]);
   const intent=model?.getSnapshot().device;
   if(action&&!check&&model?.getSnapshot().busy){
    await refresh();if(!current())return;
    const next=model?.getSnapshot();
    if(next?.error||next?.deviceError||binding(intent)!==binding(next?.device))return;
   }
   await action?.();if(current()&&refreshAfter)await refresh();
   if(check&&current()&&!model?.getSnapshot().error&&!identityFailure(model?.getSnapshot()??initial))setError(null);
  }catch(cause){if(current())setError(failure(cause));}
  finally{working.current=false;if(mounted.current)setPending(false);}
 };
 const recover=async(decision:'begin_pairing'|'adopt_owner'|'renew_expired',transaction?:DeviceRecoveryView)=>{
  if(working.current)return false;working.current=true;setBusy(true);setError(null);
  const generation=model?.generation(),current=()=>mounted.current&&model?.generation()===generation;
  try{
   if(model?.getSnapshot().busy)await refresh();if(!current())return false;
   let observed=model?.getSnapshot();
   if(!transaction&&!observed?.recoveryError&&(!observed?.recovery||observed.recovery.phase==='completed')){
    await model?.recheckStartup();if(!current())return false;observed=model?.getSnapshot();
   }
   if(transaction){
    const next=observed?.recovery;
    if(!next||next.operation_id!==transaction.operation_id||next.revision!==transaction.revision||next.phase!==transaction.phase||observed?.recoveryError)throw {code:'DEVICE_RECOVERY_PRECONDITION',message:'recovery confirmation no longer matches current observation; actual='+String(next?.revision)+' expected='+transaction.revision+' phase='+String(next?.phase),details:{check:'device_recovery_confirm',observed_at:new Date().toISOString(),evidence:{actual:String(next?.revision),required:String(transaction.revision)}}};
   }else if(observed?.recovery&&observed.recovery.phase!=='completed'||observed?.recoveryError||!['device_replaced','invalid_device_credential'].includes(identityFailure(observed??initial)?.code??''))throw {code:'DEVICE_RECOVERY_PRECONDITION',message:'credential recovery requires current confirmed revoked credentials and no unresolved recovery observation'};
   const prepared=transaction??await props.client.recoveryPrepare();if(!current())return false;
   await props.client.recoveryConfirm(prepared.operation_id,prepared.revision,decision);if(current())await refresh();
   return true;
  }catch(cause){if(current()){setError(normalizeFailure(cause,'device_recovery_confirm'));await refresh();}return false;}
  finally{working.current=false;if(mounted.current)setBusy(false);}
 };
 const instance=native.metadata?.instance;
 const accountClient=useMemo(()=>instance?props.accountFactory(instance):undefined,[props.accountFactory,instance]);
 const runtimeClient=useMemo(()=>instance?props.runtimeFactory(instance):undefined,[props.runtimeFactory,instance]);
 const authorizeCapabilities=JSON.stringify([...(native.metadata?.capabilities??[])].sort());
 const authorizeClient=useMemo(()=>instance?props.authorizeFactory(instance,JSON.parse(authorizeCapabilities) as string[]):undefined,[props.authorizeFactory,instance,authorizeCapabilities]);
 const supplyClient=useMemo(()=>view?.state==='bound'&&view.identity&&view.hive?props.supply({hive:view.hive,deviceId:view.identity.id}):undefined,[props.supply,view?.state,view?.hive,view?.identity?.id]);
 const generation=useCallback(()=>model?.generation()??0,[model]);
 const supplyLocal=useRef<Partial<Record<'openai'|'claude',string>>>({});
 const currentSnapshot=useCallback(()=>model?.getSnapshot()??initial,[model]);
 const runtimeSnapshot=useCallback(()=>{const s=currentSnapshot();return {view:s.runtime,error:s.error,identityError:identityFailure(s),busy:s.busy,refreshStatus:s.refresh};},[currentSnapshot]);
 const supplySnapshot=useCallback(()=>{const s=currentSnapshot();return {views:s.supplies,errors:s.supplyErrors,activePlatform:s.supplyPlatform,error:s.error??identityFailure(s),busy:s.busy,refreshStatus:s.refresh,supplyRefresh:s.supplyRefresh,writeContext:supplyWriteContext(s,supplyLocal.current)};},[currentSnapshot]);
 const runtime=useRuntime(runtimeClient,native.state==='ready',{view:snapshot.runtime,error:snapshot.error,identityError:identityFailure(snapshot),busy:snapshot.busy,refreshStatus:snapshot.refresh,refresh,pause,generation,recordReceipt:model?.recordRuntimeReceipt,snapshot:runtimeSnapshot});
 const accountSnapshot=useCallback(()=>{const s=currentSnapshot();return {...s,deviceError:identityFailure(s)};},[currentSnapshot]);
 const accounts=useAccounts(accountClient,native.state==='ready',authorizeClient,runtime.view,page==='accounts',{autoService:props.autoService,defaults:snapshot.defaults,refreshStatus:snapshot.refresh,accountRefresh:snapshot.accountRefresh,sourceDirectories,setSourceDirectory,sourceReady:preferencesReady,recheckOpenaiReads:model?.recheckOpenaiReads,openaiSource:preferences.preferences.openai_source,
 saveOpenaiSource:async source=>{
  const current=await props.preferencesClient.read();if(current.error)throw current.error;
  const saved=await props.preferencesClient.save(current.preferences.revision,{...current.preferences,openai_source:source});
  if(saved.error)throw saved.error;
  const confirmed=await props.preferencesClient.read();if(confirmed.error)throw confirmed.error;
  if(confirmed.preferences.revision<saved.preferences.revision||JSON.stringify(confirmed.preferences.openai_source)!==JSON.stringify(source))throw {code:'PREFERENCES_UNCONFIRMED',message:'OpenAI source readback differs from saved receipt; required=same directory/store and revision at least '+saved.preferences.revision};
  onSaved(confirmed);return confirmed.preferences.openai_source!;
 },error:snapshot.error,deviceError:identityFailure(snapshot),accountErrors:snapshot.accountErrors,refresh,pause,generation,recordReceipt:model?.recordAccountReceipt,snapshot:accountSnapshot});
 supplyLocal.current=Object.fromEntries((['openai','claude'] as const).map(p=>[p,JSON.stringify([!!runtime.error,runtime.uncertain,!!accounts.writeBusy[p],!!accounts.errors[p],!!accounts.uncertain[p]])]));
 const sharedSupply=useSupply(supplyClient,native.state==='ready',busy||!!error||!!snapshot.error||!!identityFailure(snapshot),Object.values(accounts.views).filter(v=>v.hive.state==='confirmation_required').map(v=>v.platform),{views:snapshot.supplies,errors:snapshot.supplyErrors,activePlatform:snapshot.supplyPlatform,error:snapshot.error??identityFailure(snapshot),busy:snapshot.busy,refreshStatus:snapshot.refresh,supplyRefresh:snapshot.supplyRefresh,refresh,pause,snapshot:supplySnapshot},supplyWriteContext(snapshot,supplyLocal.current));
 const diagnostics=useMemo(()=>props.diagnosticsFactory(instance,snapshot.runtime?.network_revision??0,snapshot.runtime?.run_id,snapshot.bindingRevision??0),[props.diagnosticsFactory,instance,snapshot.bindingRevision]);
 const ready=native.state==='ready',startupReadOnly=props.systemBridge.startupStatus?snapshot.startup?.state!=='ready':!!snapshot.startup&&snapshot.startup.state!=='ready';
 const sharedProblem=snapshot.error??identityFailure(snapshot)??null;
 const showSharedProblem=ready&&!startupReadOnly&&!!sharedProblem&&sharedProblem!==snapshot.startup?.failure;
 useEffect(()=>{diagnostics.setContext(snapshot.runtime?.network_revision??0,snapshot.runtime?.run_id,snapshot.bindingRevision??0);},[diagnostics,snapshot.runtime?.network_revision,snapshot.runtime?.run_id,snapshot.bindingRevision]);
 return <AppShell autoService={props.autoService} desktopStatus={presentation} navigationRequest={navigationRequest} page={page} onNavigate={navigatePage} demo={false} deviceMode deviceName={view?.identity?.name??snapshot.deviceContext?.name} hive={view?.hive??snapshot.deviceContext?.hive} connected={!snapshot.error&&!runtime.error&&!runtime.uncertain&&runtime.view?.connection==='connected'} debug={props.autoService&&page==='accounts'?<span className="account-page-count">{!startupReadOnly&&Object.values(accounts.views).length===2&&!Object.keys(accounts.readFailures).some(key=>accounts.readFailures[key as 'openai'|'claude'])?t('{count} 个已接入',{count:Object.values(accounts.views).filter(account=>account.selection.state==='selected').length}):t('接入数量待确认')}</span>:<button disabled={!snapshot.deviceContext?.hive||busy} onClick={()=>void run(props.openHive)}>{t('打开 Hive 控制台')}</button>}>
  <StartupRecoveryNotice snapshot={snapshot} diagnostics={page==='diagnostics'} onQuery={()=>model?.observeStartup()??Promise.resolve()} onRetry={()=>model?.retryStartup()??Promise.resolve()} onDiagnostics={()=>navigate({page:'diagnostics'})}/>
  {showSharedProblem&&page!=='overview'&&<div><FailureNotice failure={sharedProblem} check="startup_check" onNavigate={navigate}/><button disabled={busy||snapshot.busy} onClick={()=>void run(()=>model?.recheckStartup()??Promise.resolve(),false)}>{t('重新检查设备')}</button></div>}
  {recovery&&<button className="recovery-return" onClick={returnFromRecovery}>{t('返回原处')}</button>}
  {error&&page!=='overview' &&<FailureNotice failure={error} check="device_status" onNavigate={navigate}/>}
  {nativeLanguageFeedback}
  {ready&&page==='overview'&&<NativeOverviewPage canRefresh={!startupReadOnly||!!snapshot.recovery} showAccounts={!startupReadOnly} presentation={presentation} onNavigate={navigate} accounts={accounts} runtime={runtime} supply={sharedSupply} view={view} context={snapshot.deviceContext} recovery={snapshot.recovery} recoveryError={snapshot.recoveryError} refreshStatus={snapshot.refresh} recover={recover} operationError={error} busy={busy} checking={checking} initialLoading={!view&&!snapshot.recovery&&!sharedProblem&&!snapshot.recoveryError&&!snapshot.refresh.lastConfirmedAt} error={startupReadOnly?null:error??sharedProblem} reportedFailure={snapshot.startup?.failure} begin={(hive,name)=>void run(()=>props.client.begin(hive,name))} refresh={()=>void run(()=>model?.recheckStartup()??Promise.resolve(),false,true)} open={()=>void run(()=>snapshot.recovery?props.client.recoveryOpen():props.client.open())}/>}
  {ready&&!startupReadOnly&&page==='accounts'&&<NativeAccountsPage navigationRequest={navigationRequest} onNavigate={navigate} runtime={runtime} accounts={accounts} supply={sharedSupply} deviceError={error||(showSharedProblem?null:snapshot.deviceError)}/>}
  {page==='diagnostics'&&<><NativeDiagnosticsPage navigationRequest={navigationRequest} onReport={model?.acceptDiagnosticReport} client={diagnostics} onNavigate={navigate} instance={ready&&!startupReadOnly?instance:undefined} bindingRevision={snapshot.bindingRevision??0} networkRevision={snapshot.runtime?.network_revision??0} runId={snapshot.runtime?.run_id}/><details className="native-diagnostic-evidence"><summary>{t('运行详情')}</summary><pre>{JSON.stringify({runtime:snapshot.error??runtime.error,runtimeOperation:runtime.view?.operation?.error,runtimeAuthorization:runtime.view?Object.fromEntries(Object.entries(runtime.view.platforms).map(([platform,value])=>[platform,value.account.authorization.error])):undefined,device:error||snapshot.deviceError,supply:sharedSupply?.state.errors,defaults:accounts.defaultsError,accounts:accounts.errors,sources:accounts.sourceReadFailed,accountEvidence:Object.fromEntries(Object.entries(accounts.views).map(([platform,s])=>[platform,{candidate:s.candidate.error,authorization:s.authorization.error,hive:s.hive.error,capabilities:s.capabilities.map(c=>({origin:c.origin,error:c.error})),operation:s.operation?.error,issues:s.issues}]))},null,2)}</pre></details></>}
  {page==='settings'&&<NativeSettingsPage navigationRequest={navigationRequest} draft={settingsDraft} onDraftChange={change=>setSettingsDraft(previous=>({...previous,...change}))} isCurrentScope={()=>{const current=model?.getSnapshot();return mounted.current&&current?.native.metadata?.instance===instance&&current?.bindingRevision===snapshot.bindingRevision;}} readRuntime={async()=>{await refresh();const current=model?.getSnapshot();return {view:current?.runtime??null,failure:current?.error??null};}} os={native.metadata?.os} contextKnown={!!snapshot.deviceContext||snapshot.deviceError?.code==='DEVICE_CONTEXT_UNCONFIGURED'||view?.state==='unbound'} onNavigate={navigate} updateControls={<NativeUpdateControls client={props.updateClient} currentVersion={native.metadata?.bee_version} platform={native.metadata ? `${({darwin:'macOS',windows:'Windows',linux:'Linux'} as Record<string,string>)[native.metadata.os]??native.metadata.os} · ${native.metadata.arch}` : undefined}/>} paired={view?.state==='bound'} preferences={preferences} preferencesClient={props.preferencesClient} notificationsClient={props.notificationsClient} networkClient={props.networkClient} hive={view?.hive??snapshot.deviceContext?.hive} version={native.metadata?.bee_version} onSaved={onSaved}/>}
 </AppShell>;
}
export function NativeApp(props:NativeProps){
 const [snapshot,setSnapshot]=useState<DesktopSnapshot>(initial),[model,setModel]=useState<DesktopState>(),[page,setPage]=useState<Page>('overview');
 const [preferences,setPreferences]=useState<PreferencesSnapshot>({preferences:defaultPreferences(),error:null});
 const preferencesRevision=useRef(preferences.preferences.revision);preferencesRevision.current=preferences.preferences.revision;
 const [preferencesTrusted,setPreferencesTrusted]=useState(false);
 const trustedLanguage=useRef<{language:PreferencesSnapshot['preferences']['language'];revision:number}|null>(null);
 const acceptPreferences=useCallback((value:PreferencesSnapshot)=>{if(value.preferences.revision<preferencesRevision.current)return;preferencesRevision.current=value.preferences.revision;setPreferences(value);if(value.error){setPreferencesTrusted(!!trustedLanguage.current&&trustedLanguage.current.revision===value.preferences.revision&&trustedLanguage.current.language===value.preferences.language);}else{trustedLanguage.current={language:value.preferences.language,revision:value.preferences.revision};setPreferencesTrusted(true);}},[]);
 const locale=useLanguage(preferences.preferences.language);
 const [localeFailure,setLocaleFailure]=useState<UiFailure|null>(null),[localeRetry,setLocaleRetry]=useState(0),[localeReading,setLocaleReading]=useState(false);
 const localeGeneration=useRef(0);
 useEffect(()=>{
  const generation=++localeGeneration.current;
  if(!preferencesTrusted){if(preferences.error)setLocaleFailure(normalizeFailure({code:'NATIVE_LOCALE_PREFERENCES',message:`native language has no trusted saved preference receipt: ${preferences.error.code}: ${preferences.error.message}`},'native_locale_sync'));return;}
  if(!props.systemBridge.syncNativeLocale)return;
  void props.systemBridge.syncNativeLocale(locale,preferences.preferences.revision).then(()=>{if(generation===localeGeneration.current)setLocaleFailure(null);},cause=>{if(generation===localeGeneration.current)setLocaleFailure(normalizeFailure(cause,'native_locale_sync'));});
  return()=>{localeGeneration.current++;};
 },[locale,preferences.preferences.revision,preferences.error,preferencesTrusted,props.systemBridge,localeRetry]);
 const retryNativeLanguage=async()=>{if(localeReading)return;setLocaleReading(true);try{const value=await props.preferencesClient.read();if(value.error)throw value.error;if(value.preferences.revision<preferencesRevision.current)throw {code:'NATIVE_LOCALE_STALE',message:`native language recovery read revision=${value.preferences.revision}; required=at least ${preferencesRevision.current}`};acceptPreferences(value);setLocaleRetry(v=>v+1);}catch(cause){setLocaleFailure(normalizeFailure(cause,'native_locale_sync'));}finally{setLocaleReading(false);}};
 useEffect(()=>{
  let active=true,sequence=0;
  const read=()=>{const request=++sequence,revision=preferencesRevision.current;void props.preferencesClient.read().then(v=>{if(active&&request===sequence)acceptPreferences(v);},cause=>{if(active&&request===sequence)setPreferences(v=>v.preferences.revision>revision?v:{...v,error:normalizeFailure(cause,'preferences_read')});});};
  read();window.addEventListener('focus',read);
  return()=>{active=false;window.removeEventListener('focus',read);};
 },[props.preferencesClient,acceptPreferences]);
 useEffect(()=>{
  const media=window.matchMedia('(prefers-color-scheme: dark)');const apply=()=>{document.documentElement.dataset.theme=preferences.preferences.theme==='system'?(media.matches?'dark':'light'):preferences.preferences.theme;};
  apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);
 },[preferences.preferences.theme]);
 useEffect(()=>{
  const coordinator=createDesktopState({openaiQueries:true,bridge:props.systemBridge,device:props.client,runtime:props.runtimeFactory,accounts:props.accountFactory,supply:props.supply});
  setModel(coordinator);const off=coordinator.subscribe(()=>setSnapshot(coordinator.getSnapshot()));
  return()=>{off();coordinator.dispose();};
 },[props.systemBridge,props.client,props.runtimeFactory,props.accountFactory,props.supply]);
 useEffect(()=>{let active=true,off:(()=>void)|undefined;void props.systemBridge.onNotification?.(next=>{if(active)setPage(next);}).then(dispose=>{if(active)off=dispose;else dispose();},cause=>console.error('Notification navigation registration failed',cause));return()=>{active=false;off?.();};},[props.systemBridge]);
 return <NativeWorkspace key={`${snapshot.native.metadata?.instance??'starting'}:${snapshot.bindingRevision??0}`} props={props} snapshot={snapshot} model={model} page={page} setPage={setPage} preferences={preferences} preferencesReady={preferencesTrusted} onSaved={acceptPreferences} nativeLanguageFeedback={localeFailure&&<div><FailureNotice failure={localeFailure} check="native_locale_sync"/><button disabled={localeReading} onClick={()=>void retryNativeLanguage()}>{t('重新同步原生语言')}</button></div>}/>;
}
