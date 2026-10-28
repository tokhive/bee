import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {AppShell} from '../components/AppShell';
import {StatusView} from '../components/StatusView';
import {DevicePairingPage} from '../features/device/DevicePairingPage';
import {NativeAccountsPage} from '../features/accounts/NativeAccountsPage';
import {useAccounts} from '../features/accounts/useAccounts';
import {NativeRuntimeControls} from '../features/lifecycle/NativeRuntimeControls';
import {useRuntime} from '../features/lifecycle/useRuntime';
import {SupplyPanel} from '../features/supply/SupplyPanel';
import {useSupply} from '../features/supply/useSupply';
import {NativeDiagnosticsPage} from '../features/diagnostics/NativeDiagnosticsPage';
import {NativeSettingsPage} from '../features/settings/NativeSettingsPage';
import {createDesktopState,type DesktopSnapshot,type DesktopState} from '../system/desktopState';
import {defaultPreferences,type PreferencesClient,type PreferencesSnapshot} from '../system/preferences';
import type {createNotificationsClient} from '../system/notifications';
import type {NetworkClient} from '../system/network';
import type {DiagnosticsClient} from '../system/diagnostics';
import type {DeviceClient,DeviceView} from '../system/device';
import type {AccountFactory} from '../system/accounts';
import type {RuntimeFactory} from '../system/runtime';
import type {AuthorizeFactory} from '../system/authorize';
import type {SupplyFactory} from '../system/supply';
import type {SystemBridge} from '../system/bridge';
import type {Page} from '../client/types';
import {t,useLanguage} from '../i18n/index';

interface NativeProps {
 client:DeviceClient;supply:SupplyFactory;accountFactory:AccountFactory;runtimeFactory:RuntimeFactory;authorizeFactory:AuthorizeFactory;systemBridge:SystemBridge;
 preferencesClient:PreferencesClient;notificationsClient:ReturnType<typeof createNotificationsClient>;networkClient:NetworkClient;
 diagnosticsFactory:(instance:string|undefined,networkRevision:number,runId?:string|null)=>DiagnosticsClient;
 openHive:()=>Promise<unknown>;
}
const failure=(cause:unknown):string=>cause instanceof Error?cause.message:typeof cause==='object'&&cause!==null&&'message'in cause?`${'code'in cause?String(cause.code)+': ':''}${String(cause.message)}`:String(cause);
const initial:DesktopSnapshot={native:{state:'starting'},deviceError:'',accounts:{},accountErrors:{},supplies:{},error:'',busy:false};
function NativeWorkspace({props,snapshot,model,page,setPage,preferences,onSaved}:{props:NativeProps;snapshot:DesktopSnapshot;model:DesktopState|undefined;page:Page;setPage:(page:Page)=>void;preferences:PreferencesSnapshot;onSaved:(v:PreferencesSnapshot)=>void}){
 const {native,device:view}=snapshot;
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const working=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const refresh=useCallback(()=>model?.refresh()??Promise.resolve(),[model]);
 const pause=useCallback(()=>model?.pause(),[model]);
 const run=async(action:()=>Promise<DeviceView|unknown>)=>{if(working.current)return;working.current=true;setBusy(true);setError('');const generation=model?.generation(),current=()=>mounted.current&&model?.generation()===generation;try{await action();if(current())await refresh();}catch(cause){if(current())setError(failure(cause));}finally{working.current=false;if(mounted.current)setBusy(false);}};
 const instance=native.metadata?.instance;
 const accountClient=useMemo(()=>instance?props.accountFactory(instance):undefined,[props.accountFactory,instance]);
 const runtimeClient=useMemo(()=>instance?props.runtimeFactory(instance):undefined,[props.runtimeFactory,instance]);
 const authorizeClient=useMemo(()=>instance?props.authorizeFactory(instance):undefined,[props.authorizeFactory,instance]);
 const supplyClient=useMemo(()=>view?.state==='bound'&&view.identity&&view.hive?props.supply({hive:view.hive,deviceId:view.identity.id}):undefined,[props.supply,view?.state,view?.hive,view?.identity?.id]);
 const generation=useCallback(()=>model?.generation()??0,[model]);
 const runtime=useRuntime(runtimeClient,native.state==='ready',{view:snapshot.runtime,error:snapshot.error,busy:snapshot.busy,refresh,pause,generation});
 const accounts=useAccounts(accountClient,native.state==='ready',authorizeClient,runtime.view,{defaults:snapshot.defaults,error:snapshot.error,accountErrors:snapshot.accountErrors,refresh,pause,generation});
 const sharedSupply=useSupply(supplyClient,native.state==='ready',busy||!!error||!!snapshot.error,Object.values(accounts.views).filter(v=>v.hive.state==='confirmation_required').map(v=>v.platform),{views:snapshot.supplies,error:snapshot.error,busy:snapshot.busy,refresh,pause});
 const diagnostics=useMemo(()=>props.diagnosticsFactory(instance,snapshot.runtime?.network_revision??0,snapshot.runtime?.run_id),[props.diagnosticsFactory,instance]);
 const ready=native.state==='ready';
 return <AppShell page={page} onNavigate={setPage} demo={false} deviceMode debug={<button disabled={!view?.hive||busy} onClick={()=>void run(props.openHive)}>{t('打开 Hive 控制台')}</button>}>
  {!ready&&<StatusView kind={native.state==='starting'?'loading':'error'} title={t('原生管理进程')}>{native.error?`${native.error.code}: ${native.error.message}`:t('正在读取 Bee…')}</StatusView>}
  {error&&page!=='overview'&&<p role="alert">{error}</p>}
  {ready&&page==='overview'&&<><DevicePairingPage view={view} busy={busy||snapshot.busy} error={error||snapshot.deviceError} begin={(hive,name)=>void run(()=>props.client.begin(hive,name))} refresh={()=>void run(refresh)} open={()=>void run(()=>props.client.open())}/><NativeRuntimeControls runtime={runtime}/>{sharedSupply&&<SupplyPanel supply={sharedSupply}/>}</>}
  {ready&&page==='accounts'&&<NativeAccountsPage runtime={runtime} accounts={accounts} supply={sharedSupply} deviceError={error||snapshot.deviceError}/>}
  {page==='diagnostics'&&<NativeDiagnosticsPage client={diagnostics} onNavigate={setPage} instance={instance} networkRevision={snapshot.runtime?.network_revision??0} runId={snapshot.runtime?.run_id}/>}
  {page==='settings'&&<NativeSettingsPage paired={view?.state==='bound'} preferences={preferences} preferencesClient={props.preferencesClient} notificationsClient={props.notificationsClient} networkClient={props.networkClient} hive={view?.hive} version={native.metadata?.bee_version} onSaved={onSaved}/>}
 </AppShell>;
}
export function NativeApp(props:NativeProps){
 const [snapshot,setSnapshot]=useState<DesktopSnapshot>(initial),[model,setModel]=useState<DesktopState>(),[page,setPage]=useState<Page>('overview');
 const [preferences,setPreferences]=useState<PreferencesSnapshot>({preferences:defaultPreferences(),error:null});
 const preferencesRevision=useRef(preferences.preferences.revision);preferencesRevision.current=preferences.preferences.revision;
 const acceptPreferences=useCallback((value:PreferencesSnapshot)=>setPreferences(previous=>value.preferences.revision>=previous.preferences.revision?value:previous),[]);
 useLanguage(preferences.preferences.language);
 useEffect(()=>{let active=true;const revision=preferencesRevision.current;void props.preferencesClient.read().then(v=>{if(active)acceptPreferences(v);},cause=>{if(active)setPreferences(v=>v.preferences.revision>revision?v:{...v,error:{code:'PREFERENCES_READ_FAILED',message:failure(cause)}});});return()=>{active=false;};},[props.preferencesClient,acceptPreferences]);
 useEffect(()=>{
  const media=window.matchMedia('(prefers-color-scheme: dark)');const apply=()=>{document.documentElement.dataset.theme=preferences.preferences.theme==='system'?(media.matches?'dark':'light'):preferences.preferences.theme;};
  apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply);
 },[preferences.preferences.theme]);
 useEffect(()=>{
  const coordinator=createDesktopState({bridge:props.systemBridge,device:props.client,runtime:props.runtimeFactory,accounts:props.accountFactory,supply:props.supply});
  setModel(coordinator);const off=coordinator.subscribe(()=>setSnapshot(coordinator.getSnapshot()));
  return()=>{off();coordinator.dispose();};
 },[props.systemBridge,props.client,props.runtimeFactory,props.accountFactory,props.supply]);
 useEffect(()=>{let active=true,off:(()=>void)|undefined;void props.systemBridge.onNotification?.(next=>{if(active)setPage(next);}).then(dispose=>{if(active)off=dispose;else dispose();},cause=>console.error('Notification navigation registration failed',cause));return()=>{active=false;off?.();};},[props.systemBridge]);
 return <NativeWorkspace key={snapshot.native.metadata?.instance??'starting'} props={props} snapshot={snapshot} model={model} page={page} setPage={setPage} preferences={preferences} onSaved={acceptPreferences}/>;
}
