import {useCallback,useEffect,useRef,useState} from 'react';
import type {RuntimeClient,RuntimeSnapshot} from '../../system/runtime';
import type {AccountPlatform} from '../../system/accounts';
import {failure} from '../supply/useSupply';

export function useRuntime(client:RuntimeClient|undefined,enabled:boolean){
 const [view,setView]=useState<RuntimeSnapshot>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false),[uncertain,setUncertain]=useState(false);
 // Fast repeated failures can batch refreshing=true/false into one render.
 const [settled,setSettled]=useState(0);
 const active=useRef(true),writing=useRef(false),reading=useRef<Promise<boolean>|undefined>(undefined),latest=useRef<RuntimeSnapshot|undefined>(undefined),verified=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const read=useCallback(()=>{
  if(!client||writing.current)return Promise.resolve(false);
  if(reading.current)return reading.current;
  setRefreshing(true);
  const request=(async()=>{
   try{const next=await client.snapshot();if(active.current){latest.current=next;verified.current=true;setView(next);setError('');setUncertain(false);return true;}return false;}
   catch(cause){if(active.current){verified.current=false;setError(failure(cause));}return false;}
  })().finally(()=>{if(reading.current===request)reading.current=undefined;if(active.current){setRefreshing(false);setSettled(v=>v+1);}});
  reading.current=request;return request;
 },[client]);
 useEffect(()=>{if(!enabled)return;void read();},[enabled,read]);
 useEffect(()=>{
  if(!enabled||busy||refreshing)return;
  const timer=setTimeout(()=>void read(),!error&&!uncertain&&(view?.local==='starting'||view?.local==='stopping')?300:2000);
  return()=>clearTimeout(timer);
 },[enabled,busy,refreshing,error,uncertain,view,settled,read]);
 const write=async(kind:'start'|'stop',resume:AccountPlatform[]=[])=>{
  if(!client||writing.current||uncertain||!verified.current||!latest.current)return;
  const intent=latest.current;
  writing.current=true;setBusy(true);
  try{
   if(reading.current&&!await reading.current)return;
   const current=latest.current;
   const selected=(s:RuntimeSnapshot)=>JSON.stringify(Object.values(s.platforms).map(p=>[p.account.selection.state,p.account.selection.fingerprint,p.selection_revision]));
   if(!active.current||!verified.current||!current||current.local!==intent.local||current.run_id!==intent.run_id||selected(current)!==selected(intent))return;
   if(kind==='start')await client.start({expected_revision:current.revision,resume_platforms:resume});
   else await client.stop(current.revision);
   const next=await client.snapshot();if(active.current){latest.current=next;verified.current=true;setView(next);setError('');}
  }
  catch(cause){if(active.current){verified.current=false;setError(failure(cause));setUncertain(true);}}
  finally{writing.current=false;if(active.current)setBusy(false);}
 };
 return {view,error,busy,refreshing,uncertain,refresh:read,
  start:(resume:AccountPlatform[])=>write('start',resume),stop:()=>write('stop')};
}
export type RuntimeModel=ReturnType<typeof useRuntime>;
