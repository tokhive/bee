import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopState} from '../src/system/desktopState.ts';

const tick=()=>new Promise<void>(resolve=>setImmediate(resolve));
const absent={code:'DEVICE_RECOVERY_NONE',message:'credential recovery record absent'};
const unconfigured=(revision:number)=>({binding_revision:revision,failure:{code:'DEVICE_CONTEXT_UNCONFIGURED',message:'configuration absent',check:'device_context',observedAt:null,evidence:{}}});
test('credential recovery absence becomes trusted only after its current scope read',async t=>{
 let revision=1,release!:(v:unknown)=>void,hold=true;
 const model=createDesktopState({
  bridge:{status:async()=>({state:'ready',metadata:{instance:'a'}}),onStatus:async()=>()=>{}} as any,
  device:{context:async()=>unconfigured(revision),status:async()=>({state:'unbound'}),recoveryStatus:async()=>{if(hold)await new Promise(r=>release=r);throw absent;}} as any,
  runtime:()=>({snapshot:async()=>({revision:1,network_revision:0,local:'stopped',platforms:{},run_id:null})}) as any,intervalMs:100000,
 });
 t.after(()=>model.dispose());model.subscribe(()=>{});await tick();
 assert.equal(model.getSnapshot().recoveryObservation,undefined);
 hold=false;release(null);await model.refresh();
 assert.equal(model.getSnapshot().recoveryObservation,'absent');
 revision=2;hold=true;const next=model.refresh();await tick();
 assert.equal(model.getSnapshot().bindingRevision,2);
 assert.equal(model.getSnapshot().recoveryObservation,undefined);
 hold=false;release(null);await next;
 assert.equal(model.getSnapshot().recoveryObservation,'absent');
});
test('status saving a new binding invalidates the earlier recovery absence even when its receipt is lost',async t=>{
 let revision=1,saved=false;
 const model=createDesktopState({
  bridge:{status:async()=>({state:'ready',metadata:{instance:'a'}}),onStatus:async()=>()=>{}} as any,
  device:{context:async()=>unconfigured(revision),recoveryStatus:async()=>{throw absent;},status:async()=>{if(!saved){saved=true;revision=2;throw {code:'RESPONSE_TIMEOUT',message:'status response lost after save'};}return {state:'unbound'};}} as any,
  runtime:()=>({snapshot:async()=>({revision:1,network_revision:0,local:'stopped',platforms:{},run_id:null})}) as any,intervalMs:100000,
 });
 t.after(()=>model.dispose());model.subscribe(()=>{});await tick();
 assert.equal(model.getSnapshot().bindingRevision,2);
 assert.equal(model.getSnapshot().recoveryObservation,undefined);
 assert.equal(model.getSnapshot().deviceError?.code,'RESPONSE_TIMEOUT');
 await model.refresh();assert.equal(model.getSnapshot().recoveryObservation,'absent');
});
