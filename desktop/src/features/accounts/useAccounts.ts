import {useCallback,useEffect,useRef,useState} from 'react';
import type {AccountClient,AccountDefaults,AccountPlatform,AccountSnapshot,AccountSource} from '../../system/accounts';
import {failure,platforms} from '../supply/useSupply';
export function useAccounts(client:AccountClient|undefined,enabled:boolean){
 const [defaults,setDefaults]=useState<AccountDefaults>(),[defaultsError,setDefaultsError]=useState('');
 const [views,setViews]=useState<Partial<Record<AccountPlatform,AccountSnapshot>>>({}),[errors,setErrors]=useState<Partial<Record<AccountPlatform,string>>>({}),[busy,setBusy]=useState<Partial<Record<AccountPlatform,boolean>>>({}),[sources,setSources]=useState<Partial<Record<AccountPlatform,AccountSource>>>({}),[dirty,setDirty]=useState<Partial<Record<AccountPlatform,boolean>>>({});
 const epochs=useRef({openai:0,claude:0}),active=useRef(true),running=useRef({openai:false,claude:false});
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 const run=useCallback(async(platform:AccountPlatform,operation:()=>Promise<AccountSnapshot>,detected=false)=>{
  if(running.current[platform])return;running.current[platform]=true;const epoch=++epochs.current[platform];setBusy(v=>({...v,[platform]:true}));setErrors(v=>({...v,[platform]:''}));
  try{const view=await operation();if(active.current&&epoch===epochs.current[platform]){setViews(v=>({...v,[platform]:view}));if(detected)setDirty(v=>({...v,[platform]:false}));}}
  catch(cause){if(active.current&&epoch===epochs.current[platform])setErrors(v=>({...v,[platform]:failure(cause)}));}
  finally{if(active.current&&epoch===epochs.current[platform]){running.current[platform]=false;setBusy(v=>({...v,[platform]:false}));}}
 },[]);
 useEffect(()=>{if(!enabled||!client)return;let current=true;void client.defaults().then(v=>{if(current){setDefaults(v);setDefaultsError('');}},e=>{if(current)setDefaultsError(failure(e));});for(const p of platforms)void run(p,()=>client.snapshot(p,true));return()=>{current=false;};},[enabled,client,run]);
 return {defaults,defaultsError,views,errors,busy,sources,dirty,
  edit(platform:AccountPlatform,source:AccountSource){client?.invalidate(platform);epochs.current[platform]++;running.current[platform]=false;setBusy(v=>({...v,[platform]:false}));setSources(v=>({...v,[platform]:source}));setDirty(v=>({...v,[platform]:true}));setErrors(v=>({...v,[platform]:''}));},
  detect(platform:AccountPlatform,mode:'local'|'official'){const d=defaults?.platforms.find(d=>d.platform===platform);if(client&&d)void run(platform,()=>client.detect({platform,...(sources[platform]??{directory:null,store:d.default_store}),mode}),true);},
  refresh(platform:AccountPlatform){if(client)void run(platform,()=>client.snapshot(platform,true));}};
}
export type AccountsModel=ReturnType<typeof useAccounts>;
