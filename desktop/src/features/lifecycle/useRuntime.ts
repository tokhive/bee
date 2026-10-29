import {useCallback,useEffect,useRef,useState} from 'react';
import type {RuntimeClient,RuntimeOperation,RuntimeSnapshot} from '../../system/runtime';
import type {AccountPlatform} from '../../system/accounts';
import {failure} from '../supply/useSupply';

export function useRuntime(client:RuntimeClient|undefined,enabled:boolean){
 const [view,setView]=useState<RuntimeSnapshot>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false);
 const active=useRef(true),working=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const read=useCallback(async()=>{
  if(!client||working.current)return;
  working.current=true;setBusy(true);
  try{const next=await client.snapshot();if(active.current){setView(next);setError('');setUncertain(false);}}
  catch(cause){if(active.current)setError(failure(cause));}
  finally{working.current=false;if(active.current)setBusy(false);}
 },[client]);
 useEffect(()=>{if(!enabled)return;void read();},[enabled,read]);
 useEffect(()=>{
  if(!enabled||busy)return;
  const timer=setTimeout(()=>void read(),!error&&!uncertain&&(view?.local==='starting'||view?.local==='stopping')?300:2000);
  return()=>clearTimeout(timer);
 },[enabled,busy,error,uncertain,view,read]);
 const write=async(action:()=>Promise<RuntimeOperation>)=>{
  if(!client||working.current||uncertain)return;
  working.current=true;setBusy(true);setError('');
  try{await action();const next=await client.snapshot();if(active.current)setView(next);}
  catch(cause){if(active.current){setError(failure(cause));setUncertain(true);}}
  finally{working.current=false;if(active.current)setBusy(false);}
 };
 return {view,error,busy,uncertain,refresh:read,
  start:(resume:AccountPlatform[])=>view&&client?write(()=>client.start({expected_revision:view.revision,resume_platforms:resume})):Promise.resolve(),
  stop:()=>view&&client?write(()=>client.stop(view.revision)):Promise.resolve()};
}
export type RuntimeModel=ReturnType<typeof useRuntime>;
