import {useEffect,useRef,useState} from 'react';
import type {SystemBridge} from '../../system/bridge';
import {normalizeFailure,type UiFailure} from '../../system/failures';
import {switchPending,type HiveSwitchClient,type HiveSwitchSnapshot} from '../../system/hiveSwitch';
import type {DeviceView,DeviceRecoveryView} from '../../system/device';
export function useHiveSwitch(client:HiveSwitchClient|undefined,bridge?:SystemBridge){
 const [chooserOpen,setChooserOpen]=useState(false),[hive,setHive]=useState(''),[name,setName]=useState('Bee Desktop');
 const [snapshot,setSnapshot]=useState<HiveSwitchSnapshot>(),[error,setError]=useState<UiFailure|null>(null),[busy,setBusy]=useState(false),[exitOperation,setExitOperation]=useState<string|null>(null);
 const [target,setTarget]=useState<{view?:DeviceView;recovery?:DeviceRecoveryView;error:UiFailure|null;recoveryError:UiFailure|null}>({error:null,recoveryError:null});
 const latest=useRef(snapshot);latest.current=snapshot;
 const scopeDirty=useRef(false);
 const active=useRef(false),working=useRef(false),sequence=useRef(0),targetSequence=useRef(0);
 const accept=(next:HiveSwitchSnapshot)=>{
  const previous=latest.current;if(previous&&next.profiles.revision<previous.profiles.revision)return;
  if(previous?.operation?.id===next.operation?.id&&previous?.operation&&!switchPending(previous)&&switchPending(next))return;
  if(previous?.operation?.id!==next.operation?.id){targetSequence.current++;setTarget({error:null,recoveryError:null});}
  latest.current=next;setSnapshot(next);
  if(!switchPending(next))setExitOperation(null);
 };
 const readTarget=async()=>{
  if(!client||!latest.current?.actions.target_pairing)return;
  const operation=latest.current.operation?.id,request=++targetSequence.current;
  const current=()=>active.current&&request===targetSequence.current&&latest.current?.operation?.id===operation&&latest.current?.actions.target_pairing;
  const next:{view?:DeviceView;recovery?:DeviceRecoveryView;error:UiFailure|null;recoveryError:UiFailure|null}={error:null,recoveryError:null};
  try{next.view=await client.target.status();}catch(cause){next.error=normalizeFailure(cause,'hive_switch_target_status');}
  if(!current())return;
  try{next.recovery=await client.target.recoveryStatus();}catch(cause){const failure=normalizeFailure(cause,'hive_switch_target_recovery_status');if(failure.code!=='DEVICE_RECOVERY_NONE')next.recoveryError=failure;}
  if(current())setTarget(next);
 };
 const run=async(action:()=>Promise<HiveSwitchSnapshot>,options:{preserveError?:boolean;reconcileFailure?:boolean}={})=>{
  if(!client||working.current)return false;working.current=true;setBusy(true);if(!options.preserveError)setError(null);const request=++sequence.current;
  try{const next=await action();if(active.current&&request===sequence.current){accept(next);await readTarget();}return true;}
  catch(cause){if(active.current&&request===sequence.current){const failure=normalizeFailure(cause,'hive_switch');if(options.reconcileFailure){try{const next=await client.snapshot();if(active.current&&request===sequence.current)accept(next);}catch{/* Keep the failed action's evidence; the next read will reconcile the durable record. */}}if(active.current&&request===sequence.current)setError(failure);}return false;}
  finally{if(request===sequence.current){working.current=false;if(active.current){setBusy(false);if(scopeDirty.current){scopeDirty.current=false;void run(()=>client!.snapshot(),{preserveError:true});}}}}
 };
 const refresh=()=>run(()=>client!.snapshot());
 useEffect(()=>{
  active.current=true;working.current=false;let alive=true,off:(()=>void)|undefined,offStatus:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>;
  const poll=async()=>{await run(()=>latest.current?.actions.can_observe?client!.observe():client!.snapshot(),{preserveError:true});if(alive)timer=setTimeout(()=>void poll(),2000);};
  if(client&&bridge)void bridge.onStatus(()=>{if(!alive)return;scopeDirty.current=true;if(!working.current){scopeDirty.current=false;void run(()=>client.snapshot(),{preserveError:true});}}).then(fn=>{if(alive)offStatus=fn;else fn();},cause=>{if(alive)setError(normalizeFailure(cause,'hive_switch_scope_listener'));});
  if(client){void poll();void client.onExitRequest?.(operation=>{if(alive&&latest.current?.operation?.id===operation&&switchPending(latest.current))setExitOperation(operation);}).then(fn=>{if(alive)off=fn;else fn();},cause=>{if(alive)setError(normalizeFailure(cause,'hive_switch_exit_listener'));});}
  return()=>{alive=false;active.current=false;working.current=false;sequence.current++;targetSequence.current++;clearTimeout(timer);off?.();offStatus?.();scopeDirty.current=false;};
 },[client,bridge]);
 const targetAction=async(action:()=>Promise<unknown>)=>{
  if(!client||working.current)return false;working.current=true;setBusy(true);setError(null);const operation=latest.current?.operation?.id,request=++sequence.current;
  try{await action();if(active.current&&operation===latest.current?.operation?.id){await readTarget();accept(await client.snapshot());}return true;}
  catch(cause){if(active.current&&operation===latest.current?.operation?.id)setError(normalizeFailure(cause,'hive_switch_target'));return false;}
  finally{if(request===sequence.current){working.current=false;if(active.current)setBusy(false);}}
 };
 return {snapshot,target,error,busy,exitOperation,chooserOpen,setChooserOpen,hive,setHive,name,setName,refresh,start:(origin:string,name:string)=>run(()=>client!.start(origin,name),{reconcileFailure:true}),observe:()=>run(()=>client!.observe()),continueWaiting:()=>run(()=>client!.continue()),cancel:()=>run(()=>client!.cancel()),quit:async(decision:'continue_waiting'|'cancel_and_quit')=>{const ok=await run(()=>client!.quit(decision));if(ok&&decision==='continue_waiting')setExitOperation(null);return ok;},
  targetRefresh:readTarget,targetBegin:(_hive:string,name:string)=>targetAction(()=>client!.target.begin('',name)),targetOpen:()=>targetAction(()=>target.recovery?client!.target.recoveryOpen():client!.target.open()),
  targetRecover:async(decision:'begin_pairing'|'adopt_owner'|'renew_expired',transaction?:DeviceRecoveryView)=>targetAction(async()=>{const original=transaction??await client!.target.recoveryPrepare();await client!.target.recoveryConfirm(original.operation_id,original.revision,decision);})};
}
export type HiveSwitchModel=ReturnType<typeof useHiveSwitch>;
