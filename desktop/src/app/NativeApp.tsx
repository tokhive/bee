import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from '../components/AppShell';
import { StatusView } from '../components/StatusView';
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
export function NativeApp({client,systemBridge}:{client:DeviceClient;systemBridge:SystemBridge}) {
 const [page,setPage]=useState<Page>('overview');
 const [native,setNative]=useState<BridgeStatus>({state:'starting'});
 const [view,setView]=useState<DeviceView>();const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const [language,setLanguage]=useState<Preferences['language']>('system');const [theme,setTheme]=useState<Preferences['theme']>('system');
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
 useEffect(()=>{
  let active=true,updated=false;let off:(()=>void)|undefined;
  const failed=(cause:unknown)=>{if(active&&!updated)setNative({state:'failed',error:{code:'NATIVE_STATUS_FAILED',message:failure(cause)}});};
  void systemBridge.onStatus(status=>{updated=true;if(active)setNative(status);}).then(dispose=>{if(active)off=dispose;else dispose();},failed);
  void systemBridge.status().then(status=>{if(active&&!updated)setNative(status);},failed);
  return()=>{active=false;off?.();};
 },[systemBridge]);
 useEffect(()=>{if(native.state==='ready')void refresh();},[native.state,refresh]);
 useEffect(()=>{
  if(native.state!=='ready'||busy||error||!(view?.state==='pending'||view?.state==='draining'))return;
  const timer=setTimeout(()=>void refresh(),(view.poll_interval_seconds??2)*1000);
  return()=>clearTimeout(timer);
 },[native.state,busy,error,view,refresh]);
 return <AppShell page={page} onNavigate={setPage} demo={false} deviceMode>
  {native.state!=='ready'?<StatusView kind={native.state==='starting'?'loading':'error'} title={t('原生管理进程')}>
   {native.error?`${native.error.code}: ${native.error.message}`:t('正在读取 Bee…')}
  </StatusView>:<>
   {page==='overview'&&<DevicePairingPage view={view} busy={busy} error={error} begin={(hive,name)=>void run(()=>client.begin(hive,name))} refresh={()=>void refresh()} open={()=>void run(()=>client.open())}/>}
   {page==='accounts'&&<StatusView kind="unavailable" title={t('账号')}>{t('真实平台账号接入尚未开放。')}</StatusView>}
   {page==='earnings'&&<StatusView kind="unavailable" title={t('收益')}>{t('真实收益尚未接通。')}</StatusView>}
   {page==='diagnostics'&&<section className="settings-list"><div><strong>{t('原生管理进程')}</strong><span>{native.state}</span></div><div><strong>{t('版本')}</strong><span>{native.metadata?.bee_version}</span></div><div><strong>{t('真实贡献')}</strong><span>{t('尚未开始贡献')}</span></div><div><strong>{t('设备核对')}</strong><span>{error||view?.state||t('未知')}</span></div></section>}
   {page==='settings'&&<div className="settings-page"><section className="settings-form">
    <label>{t('语言')}<select aria-label={t('语言')} value={language} onChange={e=>setLanguage(e.target.value as Preferences['language'])}><option value="system">{t('跟随系统')}</option><option value="zh">{t('中文')}</option><option value="en">English</option></select></label>
    <label>{t('外观')}<select aria-label={t('外观')} value={theme} onChange={e=>setTheme(e.target.value as Preferences['theme'])}><option value="system">{t('跟随系统')}</option><option value="light">{t('浅色')}</option><option value="dark">{t('深色')}</option></select></label>
    <p className="feature-note">{t('外观和语言仅用于本次运行。设备绑定保存在独立的受保护配置中。')}</p>
    <p>{t('Hive 地址')}: {view?.hive||t('尚未设置')}</p>
    <p className="feature-note">{t('已保存设备配置时禁止直接切换 Hive；原配置将保留。')}</p>
   </section></div>}
  </>}
 </AppShell>;
}
