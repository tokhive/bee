import {useRuntime} from '../features/lifecycle/useRuntime';
import {NativeRuntimeControls} from '../features/lifecycle/NativeRuntimeControls';
import type {RuntimeFactory} from '../system/runtime';
import type {AuthorizeFactory} from '../system/authorize';
import {useSupply} from '../features/supply/useSupply';
import {useAccounts} from '../features/accounts/useAccounts';
import {NativeAccountsPage} from '../features/accounts/NativeAccountsPage';
import type {AccountFactory} from '../system/accounts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { StatusView } from '../components/StatusView';
import { SupplyPanel } from '../features/supply/SupplyPanel';
import type { SupplyFactory } from '../system/supply';
import { DevicePairingPage } from '../features/device/DevicePairingPage';
import type { DeviceClient, DeviceView } from '../system/device';
import type { BridgeStatus, SystemBridge } from '../system/bridge';
import type { Page, Preferences } from '../client/types';
import { t, useLanguage } from '../i18n/index';
function failure(cause:unknown):string {
 if(cause instanceof Error)return cause.message;
 if(typeof cause==='object'&&cause!==null&&'message' in cause)return `${'code' in cause?String(cause.code)+': ':''}${String(cause.message)}`;
 return String(cause);
}
interface NativeUi {page:Page;language:Preferences['language'];theme:Preferences['theme']}
function NativeWorkspace({client,supply,accountFactory,runtimeFactory,authorizeFactory,native,ui,updateUi}:{client:DeviceClient;supply:SupplyFactory;accountFactory:AccountFactory;runtimeFactory:RuntimeFactory;authorizeFactory:AuthorizeFactory;native:BridgeStatus;ui:NativeUi;updateUi:(next:Partial<NativeUi>)=>void}) {
 const {page,language,theme}=ui;
 const setPage=(page:Page)=>updateUi({page});
 const [view,setView]=useState<DeviceView>();const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 useLanguage(language);
 useEffect(()=>{document.documentElement.dataset.theme=theme;},[theme]);
 const working=useRef(false);const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const run=useCallback(async(operation:()=>Promise<DeviceView|void>)=>{
  if(working.current)return;working.current=true;setBusy(true);setError('');
  try{const next=await operation();if(mounted.current&&next)setView(next);}
  catch(cause){if(mounted.current)setError(failure(cause));}
  finally{working.current=false;if(mounted.current)setBusy(false);}
 },[]);
 const refresh=useCallback(()=>run(()=>client.status()),[client,run]);
 useEffect(()=>{if(native.state==='ready')void refresh();},[native.state,refresh]);
 useEffect(()=>{
  if(native.state!=='ready'||busy||error||!(view?.state==='pending'||view?.state==='draining'))return;
  const timer=setTimeout(()=>void refresh(),(view.poll_interval_seconds??2)*1000);
  return()=>clearTimeout(timer);
 },[native.state,busy,error,view,refresh]);
 const supplyClient=useMemo(()=>view?.state==='bound'&&view.identity&&view.hive?supply({hive:view.hive,deviceId:view.identity.id}):undefined,[supply,view?.state,view?.hive,view?.identity?.id]);
 const accountClient=useMemo(()=>native.metadata?accountFactory(native.metadata.instance):undefined,[accountFactory,native.metadata?.instance]);
 const runtimeClient=useMemo(()=>native.metadata?runtimeFactory(native.metadata.instance):undefined,[runtimeFactory,native.metadata?.instance]);
 const authorizeClient=useMemo(()=>native.metadata?authorizeFactory(native.metadata.instance):undefined,[authorizeFactory,native.metadata?.instance]);
 const runtime=useRuntime(runtimeClient,native.state==='ready');
 const accounts=useAccounts(accountClient,native.state==='ready',authorizeClient);
 const sharedSupply=useSupply(supplyClient,native.state==='ready'&&(page==='overview'||page==='accounts'),busy||!!error,Object.values(accounts.views).filter(s=>s.hive.state==='confirmation_required').map(s=>s.platform));
 return <AppShell page={page} onNavigate={setPage} demo={false} deviceMode>
  {native.state!=='ready'?<StatusView kind={native.state==='starting'?'loading':'error'} title={t('原生管理进程')}>
   {native.error?`${native.error.code}: ${native.error.message}`:t('正在读取 Bee…')}
  </StatusView>:<>
   {page==='overview'&&<><DevicePairingPage view={view} busy={busy} error={error} begin={(hive,name)=>void run(()=>client.begin(hive,name))} refresh={()=>void refresh()} open={()=>void run(()=>client.open())}/><NativeRuntimeControls runtime={runtime}/>{sharedSupply&&<SupplyPanel supply={sharedSupply}/>}</>}
   {page==='accounts'&&<NativeAccountsPage runtime={runtime} accounts={accounts} supply={sharedSupply} deviceError={error}/>}
   {page==='earnings'&&<StatusView kind="unavailable" title={t('收益')}>{t('真实收益尚未接通。')}</StatusView>}
   {page==='diagnostics'&&<section className="settings-list"><div><strong>{t('原生管理进程')}</strong><span>{native.state}</span></div><div><strong>{t('版本')}</strong><span>{native.metadata?.bee_version}</span></div><div><strong>{t('真实贡献')}</strong><span>{runtime.view?.local??t('未知')}</span></div><div><strong>{t('设备核对')}</strong><span>{error||view?.state||t('未知')}</span></div></section>}
   {page==='settings'&&<div className="settings-page"><section className="settings-form">
    <label>{t('语言')}<select aria-label={t('语言')} value={language} onChange={e=>updateUi({language:e.target.value as Preferences['language']})}><option value="system">{t('跟随系统')}</option><option value="zh">{t('中文')}</option><option value="en">English</option></select></label>
    <label>{t('外观')}<select aria-label={t('外观')} value={theme} onChange={e=>updateUi({theme:e.target.value as Preferences['theme']})}><option value="system">{t('跟随系统')}</option><option value="light">{t('浅色')}</option><option value="dark">{t('深色')}</option></select></label>
    <p className="feature-note">{t('外观和语言仅用于本次运行。设备绑定保存在独立的受保护配置中。')}</p>
    <p>{t('Hive 地址')}: {view?.hive||t('尚未设置')}</p>
    <p className="feature-note">{t('已保存设备配置时禁止直接切换 Hive；原配置将保留。')}</p>
   </section></div>}
  </>}
 </AppShell>;
}

export function NativeApp({client,supply,accountFactory,runtimeFactory,authorizeFactory,systemBridge}:{client:DeviceClient;supply:SupplyFactory;accountFactory:AccountFactory;runtimeFactory:RuntimeFactory;authorizeFactory:AuthorizeFactory;systemBridge:SystemBridge}) {
 const [native,setNative]=useState<BridgeStatus>({state:'starting'});
 const [ui,setUi]=useState<NativeUi>({page:'overview',language:'system',theme:'system'});
 const updateUi=useCallback((next:Partial<NativeUi>)=>setUi(current=>({...current,...next})),[]);
 useEffect(()=>{
  let active=true,updated=false;let off:(()=>void)|undefined;
  const failed=(cause:unknown)=>{if(active&&!updated)setNative({state:'failed',error:{code:'NATIVE_STATUS_FAILED',message:failure(cause)}});};
  void systemBridge.onStatus(status=>{updated=true;if(active)setNative(status);}).then(dispose=>{if(active)off=dispose;else dispose();},failed);
  void systemBridge.status().then(status=>{if(active&&!updated)setNative(status);},failed);
  return()=>{active=false;off?.();};
 },[systemBridge]);
 return <NativeWorkspace key={`${native.state}:${native.metadata?.instance??''}`} client={client} supply={supply} accountFactory={accountFactory} runtimeFactory={runtimeFactory} authorizeFactory={authorizeFactory} native={native} ui={ui} updateUi={updateUi}/>;
}
