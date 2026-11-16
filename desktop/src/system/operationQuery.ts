/** A query round owns one immutable operation ID. It never submits business work. */
export interface QueryClock {now():number;set(fn:()=>void,ms:number):unknown;clear(timer:unknown):void}
const clock:QueryClock={now:Date.now,set:(fn,ms)=>setTimeout(fn,ms),clear:timer=>clearTimeout(timer as ReturnType<typeof setTimeout>)};
export type QueryState<T>={id:string;phase:'reading'|'waiting'|'settled'|'stopped';value?:T;error?:unknown;reason?:'retry_exhausted'|'rejected'|'time_limit';nextAt?:number};
export function createOperationQuery<T>(options:{id:string;read:(id:string)=>Promise<T>;settled:(v:T)=>boolean;retryable:(error:unknown)=>boolean;publish:(s:QueryState<T>)=>void;clock?:QueryClock;limitMs?:number;intervalMs?:number}){
 const time=options.clock??clock;
 let disposed=false,pending:Promise<void>|undefined,timer:unknown,expiry:unknown,deadline=0,failures=0;
 let state:QueryState<T>={id:options.id,phase:'stopped'};
 const emit=(next:QueryState<T>)=>{state=next;options.publish(next);};
 function stop(reason:QueryState<T>['reason']){time.clear(timer);time.clear(expiry);emit({...state,phase:'stopped',reason,nextAt:undefined});}
 function schedule(ms:number){
  const remaining=deadline-time.now();
  if(remaining<=0){stop('time_limit');return;}
  emit({...state,phase:'waiting',nextAt:time.now()+Math.min(ms,remaining)});
  timer=time.set(()=>{if(time.now()>=deadline)stop('time_limit');else void query();},Math.min(ms,remaining));
 }
 function query():Promise<void>{
  if(disposed)return Promise.resolve();
  if(pending)return pending;
  if(time.now()>=deadline){stop('time_limit');return Promise.resolve();}
  emit({...state,phase:'reading',reason:undefined,nextAt:undefined});
  const request=(async()=>{
   try{
    const value=await options.read(options.id);if(disposed)return;
    failures=0;emit({id:options.id,phase:options.settled(value)?'settled':'reading',value});
    if(state.phase==='settled')time.clear(expiry);
    else schedule(options.intervalMs??1000);
   }catch(error){if(disposed)return;
    emit({...state,error});
    if(time.now()>=deadline){stop('time_limit');return;}
    if(!options.retryable(error)){stop('rejected');return;}
    if(failures===3){stop('retry_exhausted');return;}
    schedule([1000,2000,4000][failures++]);
   }
  })();
  pending=request.finally(()=>{pending=undefined;});return pending;
 }
 return {
  start(){if(disposed)return Promise.resolve();if(pending)return pending;time.clear(timer);time.clear(expiry);failures=0;deadline=time.now()+(options.limitMs??60000);expiry=time.set(()=>stop('time_limit'),options.limitMs??60000);return query();},
  getSnapshot:()=>state,
  dispose(){disposed=true;time.clear(timer);time.clear(expiry);},
 };
}
