import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOperationQuery,type QueryClock,type QueryState} from '../src/system/operationQuery.ts';
function fakeClock(){
 let now=0,sequence=0;const jobs=new Map<number,{at:number;fn:()=>void}>();
 const clock:QueryClock={now:()=>now,set:(fn,ms)=>{const id=++sequence;jobs.set(id,{at:now+ms,fn});return id;},clear:id=>{jobs.delete(id as number);}};
 return {clock,async advance(ms:number){const end=now+ms;while(true){const next=[...jobs].sort((a,b)=>a[1].at-b[1].at).find(([,v])=>v.at<=end);if(!next)break;now=next[1].at;jobs.delete(next[0]);next[1].fn();for(let i=0;i<8;i++)await Promise.resolve();}now=end;}};
}
test('temporary query failures wait 1/2/4 seconds then stop; manual query keeps the original ID',async()=>{
 const time=fakeClock(),calls:{id:string;at:number}[]=[];
 const query=createOperationQuery({id:'original',read:async id=>{calls.push({id,at:time.clock.now()});throw Error('temporary');},settled:()=>false,retryable:()=>true,publish:()=>{},clock:time.clock});
 await query.start();await time.advance(7000);
 assert.deepEqual(calls.map(c=>c.at),[0,1000,3000,7000]);
 assert.equal(query.getSnapshot().reason,'retry_exhausted');
 await time.advance(600000);assert.equal(calls.length,4);
 await query.start();assert.equal(calls.length,5);assert.ok(calls.every(c=>c.id==='original'));query.dispose();
});
test('one round stops at 60 seconds even with a pending read; repeated manual clicks join it',async()=>{
 const time=fakeClock();let calls=0,resolve!:(value:boolean)=>void;
 const states:QueryState<boolean>[]=[];
 const query=createOperationQuery({id:'original',read:()=>{calls++;return new Promise<boolean>(r=>{resolve=r;});},settled:v=>v,retryable:()=>true,publish:s=>states.push(s),clock:time.clock});
 const first=query.start();await time.advance(60000);
 assert.equal(query.getSnapshot().reason,'time_limit');
 assert.equal(query.start(),first);assert.equal(query.start(),first);assert.equal(calls,1);
 resolve(true);await first;assert.equal(query.getSnapshot().phase,'settled');query.dispose();
});
test('permission/schema failure stops immediately; disposing ignores late evidence',async()=>{
 const time=fakeClock();let calls=0;
 const query=createOperationQuery({id:'original',read:async()=>{calls++;throw Error('permission denied');},settled:()=>false,retryable:()=>false,publish:()=>{},clock:time.clock});
 await query.start();await time.advance(70000);assert.equal(calls,1);assert.equal(query.getSnapshot().reason,'rejected');query.dispose();
 let resolve!:(value:boolean)=>void,published=0;
 const old=createOperationQuery({id:'old',read:()=>new Promise<boolean>(r=>{resolve=r;}),settled:v=>v,retryable:()=>false,publish:()=>published++,clock:time.clock});
 const pending=old.start();old.dispose();resolve(true);await pending;assert.equal(published,1);
});
