import type {RefreshStatus} from '../../system/desktopState';
import type {UiFailure} from '../../system/failures';
import {useCallback,useEffect,useRef,useState} from 'react';
import type {RuntimeClient,RuntimeSnapshot} from '../../system/runtime';
import type {AccountPlatform} from '../../system/accounts';
import {failure} from '../supply/useSupply';

export interface CoordinatedRuntime {view?:RuntimeSnapshot;error:UiFailure|null;busy:boolean;refreshStatus?:RefreshStatus;refresh:()=>Promise<void>;pause?:()=>void;generation?:()=>number;recordReceipt?:(revision:number)=>void;snapshot?:()=>{view?:RuntimeSnapshot;error:UiFailure|null;busy:boolean;refreshStatus?:RefreshStatus}}
export function useRuntime(client:RuntimeClient|undefined,enabled:boolean,coordinated?:CoordinatedRuntime){
 const [localView,setView]=useState<RuntimeSnapshot>(),[error,setError]=useState<UiFailure|null>(null),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false),[uncertain,setUncertain]=useState(false);
 const [settled,setSettled]=useState(0);
 const active=useRef(true),writing=useRef(false),reading=useRef<Promise<boolean>|undefined>(undefined),latest=useRef<RuntimeSnapshot|undefined>(undefined),verified=useRef(false);
 const external=!!coordinated,refreshCentral=coordinated?.refresh,view=external?coordinated?.view:localView;
 const central=useRef(coordinated);central.current=coordinated;
 const resolution=useRef<{previous:RuntimeSnapshot|undefined}|undefined>(undefined);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const observe=useCallback(()=>{
  const next=central.current?.snapshot?.()??central.current;
  if(!next?.view||next.error){verified.current=false;return false;}
  latest.current=next.view;verified.current=true;
  if(!resolution.current||next.view!==resolution.current.previous){resolution.current=undefined;setError(null);setUncertain(false);}
  return true;
 },[]);
 useEffect(()=>{if(external&&!busy)observe();},[external,view,busy,coordinated?.error,observe]);
 const read=useCallback(()=>{
  if(!client||writing.current)return Promise.resolve(false);
  if(reading.current)return reading.current;
  setRefreshing(true);const started=central.current?.generation?.();
  const request=(async()=>{
   try{
    if(refreshCentral){await refreshCentral();return active.current&&central.current?.generation?.()===started?observe():false;}
    const next=await client.snapshot();if(active.current){latest.current=next;verified.current=true;setView(next);setError(null);setUncertain(false);return true;}return false;
   }catch(cause){if(active.current&&central.current?.generation?.()===started){verified.current=false;setError(failure(cause,'runtime_operation'));}return false;}
  })().finally(()=>{if(reading.current===request)reading.current=undefined;if(active.current){setRefreshing(false);setSettled(v=>v+1);}});
  reading.current=request;return request;
 },[client,refreshCentral,observe]);
 useEffect(()=>{if(!enabled||external)return;void read();},[enabled,read,external]);
 useEffect(()=>{
  if(!enabled||external||busy||refreshing)return;
  const timer=setTimeout(()=>void read(),!error&&!uncertain&&(view?.local==='starting'||view?.local==='stopping')?300:2000);
  return()=>clearTimeout(timer);
 },[enabled,busy,refreshing,error,uncertain,view,settled,read,external]);
 const write=async(kind:'start'|'stop',resume:AccountPlatform[]=[])=>{
  if(!client||writing.current||uncertain||central.current?.error||!verified.current||!latest.current)return;
  const intent=latest.current,started=central.current?.generation?.();
  const current=()=>active.current&&central.current?.generation?.()===started;
  writing.current=true;setBusy(true);
  try{
   if(reading.current&&!await reading.current)return;
   if(central.current?.snapshot?.().busy&&refreshCentral){await refreshCentral();if(!current()||!observe())return;}
   const next=latest.current;
   const selected=(s:RuntimeSnapshot)=>JSON.stringify(Object.values(s.platforms).map(p=>[p.account.selection.state,p.account.selection.fingerprint,p.selection_revision]));
   if(!current()||!verified.current||!next||next.local!==intent.local||next.run_id!==intent.run_id||selected(next)!==selected(intent))return;
   const receipt=kind==='start'?await client.start({expected_revision:next.revision,resume_platforms:resume}):await client.stop(next.revision);
   if(!current())return;
   central.current?.recordReceipt?.(receipt.revision);
   if(refreshCentral){
    resolution.current={previous:next};setUncertain(true);
    if(central.current?.snapshot?.().busy)await refreshCentral();
    if(!current())return;await refreshCentral();if(current())observe();
   }else{const observed=await client.snapshot();if(current()){latest.current=observed;verified.current=true;setView(observed);setError(null);}}
  }catch(cause){if(current()){verified.current=false;resolution.current={previous:latest.current};central.current?.pause?.();setError(failure(cause,'runtime_operation'));setUncertain(true);}}
  finally{writing.current=false;if(active.current)setBusy(false);}
 };
 return {view,error,refreshStatus:coordinated?.refreshStatus,stalled:!!coordinated?.error,busy,refreshing:refreshing||!!coordinated?.busy,uncertain,refresh:read,
  start:(resume:AccountPlatform[])=>write('start',resume),stop:()=>write('stop')};
}
export type RuntimeModel=ReturnType<typeof useRuntime>;
