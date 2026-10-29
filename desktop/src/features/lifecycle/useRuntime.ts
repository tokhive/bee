import {useCallback,useEffect,useRef,useState} from 'react';
import type {RuntimeClient,RuntimeOperation,RuntimeSnapshot} from '../../system/runtime';
import type {AccountPlatform} from '../../system/accounts';
import {failure} from '../supply/useSupply';

export interface CoordinatedRuntime {view?:RuntimeSnapshot;error:string;busy:boolean;refresh:()=>Promise<void>;pause?:()=>void;generation?:()=>number}
export function useRuntime(client:RuntimeClient|undefined,enabled:boolean,coordinated?:CoordinatedRuntime){
 const [localView,setView]=useState<RuntimeSnapshot>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const active=useRef(true),working=useRef(false);
 const external=!!coordinated,refreshCentral=coordinated?.refresh,view=external?coordinated?.view:localView;
 const currentView=useRef(view);currentView.current=view;
 const resolution=useRef<{previous:RuntimeSnapshot|undefined}|undefined>(undefined);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 useEffect(()=>{
  if(!external||busy||!resolution.current)return;
  if(coordinated?.error){resolution.current=undefined;return;}
  if(view&&view!==resolution.current.previous){resolution.current=undefined;setError('');setUncertain(false);}
 },[external,view,busy,coordinated?.error]);
 const read=useCallback(async()=>{
  if(!client||working.current)return;
  working.current=true;setBusy(true);
  try{if(refreshCentral){resolution.current={previous:currentView.current};await refreshCentral();}else{const next=await client.snapshot();if(active.current){setView(next);setError('');setUncertain(false);}}}
  catch(cause){resolution.current=undefined;if(active.current)setError(failure(cause));}
  finally{working.current=false;if(active.current)setBusy(false);}
 },[client,refreshCentral]);
 useEffect(()=>{if(!enabled||external)return;void read();},[enabled,read,external]);
 useEffect(()=>{
  if(!enabled||external||busy)return;
  const timer=setTimeout(()=>void read(),!error&&!uncertain&&(view?.local==='starting'||view?.local==='stopping')?300:2000);
  return()=>clearTimeout(timer);
 },[enabled,busy,error,uncertain,view,read,external]);
 const write=async(action:()=>Promise<RuntimeOperation>)=>{
  if(!client||working.current||uncertain||coordinated?.busy||coordinated?.error)return;
  working.current=true;setBusy(true);setError('');const started=coordinated?.generation?.();
  try{await action();if(!active.current||coordinated?.generation?.()!==started)return;if(refreshCentral){resolution.current={previous:currentView.current};setUncertain(true);await refreshCentral();}else{const next=await client.snapshot();if(active.current)setView(next);}}
  catch(cause){if(active.current&&coordinated?.generation?.()===started){resolution.current={previous:currentView.current};coordinated?.pause?.();setError(failure(cause));setUncertain(true);}}
  finally{working.current=false;if(active.current)setBusy(false);}
 };
 return {view,error,stalled:!!coordinated?.error,busy:busy||!!coordinated?.busy,uncertain,refresh:read,
  start:(resume:AccountPlatform[])=>view&&client?write(()=>client.start({expected_revision:view.revision,resume_platforms:resume})):Promise.resolve(),
  stop:()=>view&&client?write(()=>client.stop(view.revision)):Promise.resolve()};
}
export type RuntimeModel=ReturnType<typeof useRuntime>;
