import {useHiveSwitch,type HiveSwitchModel} from '../features/hive/useHiveSwitch';
import {HiveSwitchChooser,HiveSwitchProgress} from '../features/hive/HiveSwitchControls';
import {switchPending,type HiveSwitchClient} from '../system/hiveSwitch';
import {DevicePairingPage} from '../features/device/DevicePairingPage';
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
import {FirstLaunchWizard} from '../features/device/FirstLaunchWizard';
import {observeFirstLaunch,firstLaunchIntent,firstLaunchReceipt,firstLaunchAdmission,type FirstLaunchSession} from '../system/firstLaunch';
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
import type {SystemBridge,NotificationSource} from '../system/bridge';
import type {Page} from '../client/types';
import {t,useLanguage} from '../i18n/index';

interface NativeProps {
 /** Platform accounts with automatic service preparation. */
 hiveSwitchClient?:HiveSwitchClient;autoService?:boolean;
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
function NativeFirstLaunch({props,snapshot,model,onNavigate,nativeLanguageFeedback,admission,onIntent,onReceipt,firstProfile=false,onScopeRefresh}:{firstProfile?:boolean;onScopeRefresh:()=>Promise<unknown>;props:NativeProps;snapshot:DesktopSnapshot;model:DesktopState|undefined;admission:ReturnType<typeof firstLaunchAdmission>;onIntent:(hive:string,name:string)=>void;onReceipt:(view:DeviceView)=>void;onNavigate:(page:'accounts'|'overview')=>void;nativeLanguageFeedback:ReactNode}){
 const [diagnostic,setDiagnostic]=useState(false),[busy,setBusy]=useState(false),[checking,setChecking]=useState(false),[operationError,setOperationError]=useState<UiFailure|null>(null);
 const working=useRef(false),mounted=useRef(true),sequence=useRef(0);
 const nativeUnavailable=!firstProfile&&snapshot.native.state!=='ready';
 const returnToSetup=()=>{setDiagnostic(false);requestAnimationFrame(()=>document.querySelector<HTMLElement>(nativeUnavailable?'#first-launch-native-title':'.first-launch-wizard h1')?.focus());};
 useEffect(()=>{if(diagnostic)document.getElementById('first-launch-diagnostics-title')?.focus();},[diagnostic]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;sequence.current++;};},[]);
 const instance=snapshot.native.metadata?.instance;
 // A native instance owns operation receipts; the mounted wizard owns the session draft.
 useEffect(()=>{sequence.current++;working.current=false;setBusy(false);setChecking(false);setOperationError(null);},[instance,nativeUnavailable]);
 const diagnostics=useMemo(()=>props.diagnosticsFactory(instance,snapshot.runtime?.network_revision??0,snapshot.runtime?.run_id,snapshot.bindingRevision??0),[props.diagnosticsFactory,instance,snapshot.bindingRevision]);
 const run=async(action?:(active:()=>boolean)=>Promise<unknown>,check=false)=>{
  if(working.current||!model)return;working.current=true;const attempt=++sequence.current;const active=()=>mounted.current&&attempt===sequence.current&&(firstProfile||model.getSnapshot().native.state==='ready')&&model.getSnapshot().native.metadata?.instance===instance;
  (check?setChecking:setBusy)(true);if(!check)setOperationError(null);
  try{if(model.getSnapshot().busy)await model.refresh();if(!active())return;await action?.(active);if(active())await model.refresh();if(active()&&!identityFailure(model.getSnapshot()))setOperationError(null);}
  catch(cause){if(active()){setOperationError(normalizeFailure(cause,'device_pairing'));await model.refresh();}}
  finally{if(attempt===sequence.current){working.current=false;if(mounted.current)(check?setChecking:setBusy)(false);}}
 };
 const problem=snapshot.deviceContextFailure?.code!=='DEVICE_CONTEXT_UNCONFIGURED'?snapshot.deviceContextFailure:null;
 const error=firstProfile?null:admission.failure??problem??snapshot.recoveryError??snapshot.deviceError??snapshot.error??snapshot.startupReadError??(snapshot.native.error?normalizeFailure(snapshot.native.error,'bridge_startup'):null)??null;
 const fresh=firstProfile||snapshot.native.state==='ready'&&snapshot.bindingRevision!==undefined&&snapshot.deviceContextFailure?.code==='DEVICE_CONTEXT_UNCONFIGURED'&&snapshot.recoveryObservation==='absent'&&snapshot.device?.state==='unbound'&&!error&&snapshot.startup?.state==='ready';
 return <>
  <div hidden={diagnostic}>
   {firstProfile?null:nativeUnavailable?<main className="first-launch-content"><h1 id="first-launch-native-title" tabIndex={-1}>{snapshot.native.state==='starting'?t('正在启动 Bee…'):t('状态待核对')}</h1><StartupRecoveryNotice snapshot={snapshot} onQuery={()=>model?.observeStartup()??Promise.resolve()} onRetry={()=>model?.retryStartup()??Promise.resolve()} onDiagnostics={()=>setDiagnostic(true)}/></main>:<StartupRecoveryNotice snapshot={snapshot} onQuery={()=>model?.observeStartup()??Promise.resolve()} onRetry={()=>model?.retryStartup()??Promise.resolve()} onDiagnostics={()=>setDiagnostic(true)}/>}
   {nativeLanguageFeedback}
   <div hidden={nativeUnavailable}><FirstLaunchWizard view={firstProfile?{state:'unbound'}:admission.view} context={snapshot.deviceContext} refreshStatus={snapshot.refresh} completed={admission.completed} initialLoading={!fresh&&!admission.view?.recovery&&!error} busy={busy} checking={checking} error={error} operationError={operationError} begin={(hive,name)=>{onIntent(hive,name);return run(async active=>{const view=await props.client.begin(hive,name);if(active())onReceipt(view);await onScopeRefresh();});}} refresh={()=>run(()=>model?.recheckStartup()??Promise.resolve(),true)} open={()=>run(()=>props.client.open())} onOpenHive={()=>run(props.openHive)} onNavigate={onNavigate} onDiagnostics={()=>setDiagnostic(true)}/></div>
  </div>
  {diagnostic&&<main className="first-launch-content"><h1 id="first-launch-diagnostics-title" tabIndex={-1}>{t('诊断')}</h1><button onClick={returnToSetup}>{t('返回设备设置')}</button><StartupRecoveryNotice snapshot={snapshot} diagnostics onQuery={()=>model?.observeStartup()??Promise.resolve()} onRetry={()=>model?.retryStartup()??Promise.resolve()} onDiagnostics={()=>{}}/><NativeDiagnosticsPage client={diagnostics} instance={snapshot.native.state==='ready'?instance:undefined} bindingRevision={snapshot.bindingRevision??0} networkRevision={snapshot.runtime?.network_revision??0} runId={snapshot.runtime?.run_id} onReport={model?.acceptDiagnosticReport} onNavigate={returnToSetup}/></main>}
 </>;
}
function NativeWorkspace({props,snapshot,model,page,setPage,preferences,preferencesReady,onSaved,nativeFeedback,switching}:{switching:HiveSwitchModel;props:NativeProps;snapshot:DesktopSnapshot;model:DesktopState|undefined;page:Page;setPage:(page:Page)=>void;preferences:PreferencesSnapshot;preferencesReady:boolean;onSaved:(v:PreferencesSnapshot)=>void;nativeFeedback:ReactNode}){
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
 const switchingPending=switchPending(switching.snapshot),firstProfile=!!switching.snapshot&&!switching.snapshot.profiles.current_profile&&!switchingPending;
 const switchControl=props.hiveSwitchClient?<HiveSwitchChooser model={switching} view={view}/>:null,switchStatus=props.hiveSwitchClient?<HiveSwitchProgress model={switching}/>:null;
 const beginDevice=(hive:string,name:string)=>void run(async()=>{await props.client.begin(hive,name);await switching.refresh();});
 const ready=native.state==='ready',startupReadOnly=props.systemBridge.startupStatus?snapshot.startup?.state!=='ready':!!snapshot.startup&&snapshot.startup.state!=='ready';
 const sharedProblem=snapshot.error??identityFailure(snapshot)??null;
 const showSharedProblem=ready&&!startupReadOnly&&!!sharedProblem&&sharedProblem!==snapshot.startup?.failure;
 useEffect(()=>{diagnostics.setContext(snapshot.runtime?.network_revision??0,snapshot.runtime?.run_id,snapshot.bindingRevision??0);},[diagnostics,snapshot.runtime?.network_revision,snapshot.runtime?.run_id,snapshot.bindingRevision]);
 return <AppShell autoService={props.autoService} desktopStatus={presentation} navigationRequest={navigationRequest} page={page} onNavigate={navigatePage} demo={false} deviceMode deviceName={view?.identity?.name??snapshot.deviceContext?.name} hive={view?.hive??snapshot.deviceContext?.hive} connected={!snapshot.error&&!runtime.error&&!runtime.uncertain&&runtime.view?.connection==='connected'} debug={props.autoService&&page==='accounts'?<span className="account-page-count">{!startupReadOnly&&Object.values(accounts.views).length===2&&!Object.keys(accounts.readFailures).some(key=>accounts.readFailures[key as 'openai'|'claude'])?t('{count} 个已接入',{count:Object.values(accounts.views).filter(account=>account.selection.state==='selected').length}):t('接入数量待确认')}</span>:<button disabled={!snapshot.deviceContext?.hive||busy} onClick={()=>void run(props.openHive)}>{t('打开 Hive 控制台')}</button>}>
  {!firstProfile&&!switchingPending&&<StartupRecoveryNotice snapshot={snapshot} diagnostics={page==='diagnostics'} onQuery={()=>model?.observeStartup()??Promise.resolve()} onRetry={()=>model?.retryStartup()??Promise.resolve()} onDiagnostics={()=>navigate({page:'diagnostics'})}/>}
  {showSharedProblem&&page!=='overview'&&<div><FailureNotice failure={sharedProblem} check="startup_check" onNavigate={navigate}/><button disabled={busy||snapshot.busy} onClick={()=>void run(()=>model?.recheckStartup()??Promise.resolve(),false)}>{t('重新检查设备')}</button></div>}
  {recovery&&<button className="recovery-return" onClick={returnFromRecovery}>{t('返回原处')}</button>}
  {error&&page!=='overview' &&<FailureNotice failure={error} check="device_status" onNavigate={navigate}/>}
  {nativeFeedback}
  {(!ready&&(firstProfile||switchingPending)||switchingPending&&page!=='overview')&&<div data-nav-section="device" tabIndex={-1}><DevicePairingPage inputDraft={switching} switchControl={switchControl} switchStatus={switchStatus} view={firstProfile?{state:'unbound'}:undefined} busy={busy} error={error} begin={beginDevice} refresh={()=>void switching.refresh()} canRefresh={false} open={()=>{}}/></div>}
  {ready&&page==='overview'&&<NativeOverviewPage inputDraft={switching} switchControl={switchControl} switchStatus={switchStatus} canRefresh={!startupReadOnly||!!snapshot.recovery} showAccounts={!startupReadOnly} presentation={presentation} onNavigate={navigate} accounts={accounts} runtime={runtime} supply={sharedSupply} view={view} context={snapshot.deviceContext} recovery={snapshot.recovery} recoveryError={snapshot.recoveryError} refreshStatus={snapshot.refresh} recover={recover} operationError={error} busy={busy} checking={checking} initialLoading={!view&&!snapshot.recovery&&!sharedProblem&&!snapshot.recoveryError&&!snapshot.refresh.lastConfirmedAt} error={startupReadOnly?null:error??sharedProblem} reportedFailure={snapshot.startup?.failure} begin={beginDevice} refresh={()=>void run(()=>model?.recheckStartup()??Promise.resolve(),false,true)} open={()=>void run(()=>snapshot.recovery?props.client.recoveryOpen():props.client.open())}/>}
  {ready&&!startupReadOnly&&page==='accounts'&&<NativeAccountsPage navigationRequest={navigationRequest} onNavigate={navigate} runtime={runtime} accounts={accounts} supply={sharedSupply} deviceError={error||(showSharedProblem?null:snapshot.deviceError)}/>}
  {page==='diagnostics'&&<><NativeDiagnosticsPage navigationRequest={navigationRequest} onReport={model?.acceptDiagnosticReport} client={diagnostics} onNavigate={navigate} instance={ready&&!startupReadOnly?instance:undefined} bindingRevision={snapshot.bindingRevision??0} networkRevision={snapshot.runtime?.network_revision??0} runId={snapshot.runtime?.run_id}/><details className="native-diagnostic-evidence"><summary>{t('运行详情')}</summary><pre>{JSON.stringify({runtime:snapshot.error??runtime.error,runtimeOperation:runtime.view?.operation?.error,runtimeAuthorization:runtime.view?Object.fromEntries(Object.entries(runtime.view.platforms).map(([platform,value])=>[platform,value.account.authorization.error])):undefined,device:error||snapshot.deviceError,supply:sharedSupply?.state.errors,defaults:accounts.defaultsError,accounts:accounts.errors,sources:accounts.sourceReadFailed,accountEvidence:Object.fromEntries(Object.entries(accounts.views).map(([platform,s])=>[platform,{candidate:s.candidate.error,authorization:s.authorization.error,hive:s.hive.error,capabilities:s.capabilities.map(c=>({origin:c.origin,error:c.error})),operation:s.operation?.error,issues:s.issues}]))},null,2)}</pre></details></>}
  {page==='settings'&&<NativeSettingsPage navigationRequest={navigationRequest} draft={settingsDraft} onDraftChange={change=>setSettingsDraft(previous=>({...previous,...change}))} isCurrentScope={()=>{const current=model?.getSnapshot();return mounted.current&&current?.currentProfile===snapshot.currentProfile&&current?.native.metadata?.instance===instance&&current?.bindingRevision===snapshot.bindingRevision;}} readRuntime={async()=>{await refresh();const current=model?.getSnapshot();return {view:current?.runtime??null,failure:current?.error??null};}} os={native.metadata?.os} contextKnown={!!snapshot.deviceContext||snapshot.deviceError?.code==='DEVICE_CONTEXT_UNCONFIGURED'||view?.state==='unbound'} onNavigate={navigate} updateControls={<NativeUpdateControls client={props.updateClient} currentVersion={native.metadata?.bee_version} platform={native.metadata ? `${({darwin:'macOS',windows:'Windows',linux:'Linux'} as Record<string,string>)[native.metadata.os]??native.metadata.os} · ${native.metadata.arch}` : undefined}/>} paired={view?.state==='bound'} preferences={preferences} preferencesClient={props.preferencesClient} notificationsClient={props.notificationsClient} networkClient={props.networkClient} hive={view?.hive??snapshot.deviceContext?.hive} version={native.metadata?.bee_version} onSaved={onSaved}/>}
 </AppShell>;
}
export function NativeApp(props:NativeProps){
 const switching=useHiveSwitch(props.hiveSwitchClient,props.systemBridge);
 const currentProfile=useRef(switching.snapshot?.profiles.current_profile);currentProfile.current=switching.snapshot?.profiles.current_profile;
 const [notificationSource,setNotificationSource]=useState<NotificationSource|null>(null);
 const [snapshot,setSnapshot]=useState<DesktopSnapshot>(initial),[model,setModel]=useState<DesktopState>(),[page,setPage]=useState<Page>('overview');
 const [firstLaunch,setFirstLaunch]=useState<FirstLaunchSession>({});
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
 const scopeReady=!props.hiveSwitchClient||switching.snapshot!==undefined;
 const initialScope=useRef(switching.snapshot?.current_scope);initialScope.current=switching.snapshot?.current_scope;
 useEffect(()=>{
  if(!scopeReady)return;
  const coordinator=createDesktopState({scope:initialScope.current,openaiQueries:true,bridge:props.systemBridge,device:props.client,runtime:props.runtimeFactory,accounts:props.accountFactory,supply:props.supply});
  setModel(coordinator);const off=coordinator.subscribe(()=>{const next=coordinator.getSnapshot();setFirstLaunch(previous=>observeFirstLaunch(previous,next));setSnapshot(next);});
  return()=>{off();coordinator.dispose();};
 },[props.systemBridge,props.client,props.runtimeFactory,props.accountFactory,props.supply,scopeReady]);
 const currentScope=JSON.stringify(switching.snapshot?.current_scope);
 useEffect(()=>{if(switching.snapshot)model?.setCurrentScope(switching.snapshot.current_scope);},[model,currentScope]);
 useEffect(()=>{let active=true,off:(()=>void)|undefined;void props.systemBridge.onNotification?.(next=>{if(!active)return;if(typeof next==='string'){setNotificationSource(null);setPage(next);return;}const source=next.target.source;if(!next.can_navigate||source&&(source.profile_id!==next.current_profile||source.profile_id!==currentProfile.current)){setNotificationSource(source);return;}setNotificationSource(null);setPage(next.target.page);}).then(dispose=>{if(active)off=dispose;else dispose();},cause=>console.error('Notification navigation registration failed',cause));return()=>{active=false;off?.();};},[props.systemBridge]);
 const nativeLanguageFeedback=localeFailure&&<div><FailureNotice failure={localeFailure} check="native_locale_sync"/><button disabled={localeReading} onClick={()=>void retryNativeLanguage()}>{t('重新同步原生语言')}</button></div>;
 const admission=firstLaunchAdmission(firstLaunch,snapshot);
 const firstProfile=!!switching.snapshot&&!switching.snapshot.profiles.current_profile&&!switchPending(switching.snapshot)&&switching.snapshot.profiles.migration_blockers.length===0;
 if(!admission.workspace&&!switchPending(switching.snapshot))return <NativeFirstLaunch firstProfile={firstProfile} onScopeRefresh={switching.refresh} props={props} snapshot={snapshot} model={model} admission={admission} onIntent={(hive,name)=>setFirstLaunch(previous=>firstLaunchIntent(previous,model?.getSnapshot()??snapshot,hive,name))} onReceipt={view=>setFirstLaunch(previous=>firstLaunchReceipt(previous,model?.getSnapshot()??snapshot,view))} onNavigate={destination=>{if(!firstLaunchAdmission(firstLaunch,model?.getSnapshot()??snapshot).completed)return;setFirstLaunch(previous=>({...previous,dismissed:previous.attempt?.operationId,knownBinding:true}));setPage(destination);}} nativeLanguageFeedback={nativeLanguageFeedback}/>;
 return <NativeWorkspace switching={switching} key={`${switching.snapshot?.profiles.current_profile??'no-profile'}:${switching.snapshot?.profiles.revision??0}:${snapshot.native.metadata?.instance??'starting'}:${snapshot.bindingRevision??0}`} props={props} snapshot={snapshot} model={model} page={page} setPage={setPage} preferences={preferences} preferencesReady={preferencesTrusted} onSaved={acceptPreferences} nativeFeedback={<>{notificationSource&&<div className="problem-notice" role="status"><p>{t('此通知来自 Hive {origin}。请在 Hive 列表中选择该地址后核对。',{origin:notificationSource.origin})}</p><div className="inline-actions"><button onClick={()=>{setPage('overview');switching.setChooserOpen(true);}}>{t('查看 Hive 列表')}</button><button aria-label={t('关闭通知提示')} onClick={()=>setNotificationSource(null)}>{t('关闭')}</button></div></div>}{localeFailure&&<div><FailureNotice failure={localeFailure} check="native_locale_sync"/><button disabled={localeReading} onClick={()=>void retryNativeLanguage()}>{t('重新同步原生语言')}</button></div>}</>}/>;
}
