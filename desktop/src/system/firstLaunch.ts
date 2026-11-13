import type {DesktopSnapshot} from './desktopState';
import type {DeviceView} from './device';
import {normalizeFailure,type UiFailure} from './failures';
import {currentLocale} from '../i18n';

interface InitialAttempt {operationId?:string;hive:string;name:string;revision:number;view?:DeviceView}
export interface FirstLaunchSession {instance?:string;attempt?:InitialAttempt;dismissed?:string;knownBinding?:boolean}
const transaction=(view?:DeviceView)=>view?.recovery?.old_identity===null?view.recovery:undefined;
const sameIdentity=(a:NonNullable<DeviceView['identity']>,b:NonNullable<DeviceView['identity']>)=>a.id===b.id&&a.name===b.name&&a.owner_id===b.owner_id&&a.owner_email===b.owner_email;
// Bound view names follow the Hive identity; context.name is the local requested name.
function savedIdentity(snapshot:DesktopSnapshot){
 const {device:view,deviceContext:context}=snapshot,identity=view?.identity;
 return !!view&&view.state==='bound'&&!!identity&&!!context&&context.binding_revision===snapshot.bindingRevision&&context.hive===view.hive&&view.name===identity.name&&context.device_id===identity.id&&context.owner_id===identity.owner_id;
}
/** Session state belongs above the binding-revision workspace. It contains no persistent flag. */
export function observeFirstLaunch(previous:FirstLaunchSession,snapshot:DesktopSnapshot):FirstLaunchSession {
 const instance=snapshot.native.metadata?.instance;
 let session=previous.instance===instance?previous:{instance};
 const view=snapshot.device,record=transaction(view),attempt=session.attempt;
 if(record&&!snapshot.deviceError&&record.phase!=='completed'){
  if(!attempt?.operationId||attempt.operationId!==record.operation_id||record.revision>=attempt.revision){
   session={...session,attempt:{operationId:record.operation_id,revision:record.revision,hive:view!.hive!,name:view!.name!,view},dismissed:undefined};
  }
 }else if(record&&attempt&&record.operation_id===attempt.operationId&&record.revision>=attempt.revision&&!snapshot.deviceError){
  session={...session,attempt:{...attempt,revision:record.revision,view}};
 }
 if(!session.attempt&&savedIdentity(snapshot)&&!snapshot.deviceError&&!snapshot.recoveryError)session={...session,knownBinding:true};
 return session;
}
export function firstLaunchIntent(session:FirstLaunchSession,snapshot:DesktopSnapshot,hive:string,name:string):FirstLaunchSession {
 return {...session,instance:snapshot.native.metadata?.instance,attempt:{hive,name,revision:0},dismissed:undefined};
}
export function firstLaunchReceipt(session:FirstLaunchSession,snapshot:DesktopSnapshot,view:DeviceView):FirstLaunchSession {
 const record=transaction(view),attempt=session.attempt,current=transaction(snapshot.device),context=snapshot.deviceContext;
 if(!record||!attempt||session.instance!==snapshot.native.metadata?.instance||view.hive!==attempt.hive||(view.state==='bound'?view.name!==view.identity?.name:view.name!==attempt.name)||attempt.operationId&&attempt.operationId!==record.operation_id||record.revision<attempt.revision)return session;
 if(current&&current.operation_id!==record.operation_id||context&&(context.hive!==view.hive||context.name!==attempt.name)||context?.device_id&&record.phase!=='completed')return session;
 return {...session,attempt:{...attempt,operationId:record.operation_id,revision:record.revision,view}};
}
export function firstLaunchAdmission(session:FirstLaunchSession,snapshot:DesktopSnapshot):{workspace:boolean;completed:boolean;view?:DeviceView;failure?:UiFailure}{
 const record=transaction(snapshot.device),attempt=session.instance===snapshot.native.metadata?.instance?session.attempt:undefined;
 const participating=!!attempt&&(!attempt.operationId||session.dismissed!==attempt.operationId);
 const relevantError=snapshot.deviceError??snapshot.recoveryError??snapshot.deviceContextFailure??snapshot.error;
 const associated=!!attempt?.operationId&&record?.operation_id===attempt.operationId&&record.revision>=attempt.revision&&snapshot.device?.hive===attempt.hive&&(snapshot.device.state==='bound'?snapshot.deviceContext?.name===attempt.name:snapshot.device.name===attempt.name);
 const completed=participating&&associated&&record?.phase==='completed'&&!record.failure&&!!record.new_identity&&!!snapshot.device?.identity&&sameIdentity(record.new_identity,snapshot.device.identity)&&savedIdentity(snapshot)&&!relevantError&&snapshot.recoveryObservation==='absent';
 let failure:UiFailure|undefined;
 if(participating&&!snapshot.deviceError&&record&&record.operation_id===attempt?.operationId&&record.revision<attempt.revision){
  failure=normalizeFailure({code:'FIRST_LAUNCH_STALE_RESULT',message:`${currentLocale()==='en'?'Initial pairing receipt revision regressed':'首次绑定事务回执倒退'}: operation=${record.operation_id}; actual=${record.revision}; required>=${attempt.revision}`,details:{check:'first_launch_revision',observed_at:new Date().toISOString(),evidence:{actual:String(record.revision),required:`revision>=${attempt.revision}`}}},'first_launch_revision');
 }else if(participating&&!snapshot.deviceError&&snapshot.device?.state==='bound'&&!completed&&snapshot.recoveryObservation==='absent'&&!snapshot.recoveryError){
  const actual=JSON.stringify({operation:record?.operation_id,revision:record?.revision,hive:snapshot.device.hive,name:snapshot.device.name,identity:snapshot.device.identity,new_identity:record?.new_identity,context:snapshot.deviceContext,binding_revision:snapshot.bindingRevision});
  const required=JSON.stringify({operation:attempt?.operationId,minimum_revision:attempt?.revision,hive:attempt?.hive,name:attempt?.name,identity:'bound view name = Hive identity name; local context name = requested name; bound identity = transaction new identity = saved device/owner; context revision = current binding revision'});
  failure=normalizeFailure({code:'FIRST_LAUNCH_ASSOCIATION_INVALID',message:`${currentLocale()==='en'?'Initial pairing completion evidence does not match':'首次绑定完成证据不匹配'}: actual=${actual}; required=${required}`,details:{check:'first_launch_completion',observed_at:new Date().toISOString(),evidence:{actual,required}}},'first_launch_completion');
 }
 const initialPending=!!record&&record.phase!=='completed';
 const savedBound=!!snapshot.deviceContext?.device_id&&!!snapshot.deviceContext.owner_id;
 const established=savedIdentity(snapshot)&&snapshot.recoveryObservation!==undefined||savedBound&&!!(snapshot.deviceError||snapshot.recoveryError||snapshot.startup?.state==='blocked')||session.instance===snapshot.native.metadata?.instance&&session.knownBinding&&!!(snapshot.deviceError||snapshot.recoveryError||snapshot.deviceContextFailure&&snapshot.deviceContextFailure.code!=='DEVICE_CONTEXT_UNCONFIGURED'||snapshot.native.state!=='ready'||snapshot.startup?.state==='blocked');
 const workspace=!!snapshot.recovery||!participating&&!initialPending&&!!established;
 return {workspace,completed:!!completed,view:participating?attempt?.view??snapshot.device:snapshot.device,failure};
}
