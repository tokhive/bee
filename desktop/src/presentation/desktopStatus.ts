import type {DesktopSnapshot} from '../system/desktopState';
import {normalizeFailure,type UiFailure} from '../system/failures.ts';
import type {NavigationTarget} from '../app/navigation';
import type {AccountPlatform} from '../system/accounts';
export interface DesktopPresentation {
 kind:'loading'|'unconfirmed'|'failed'|'rejected'|'occupied'|'unbound'|'pairing'|'starting'|'stopping'|'no_accounts'|'stopped'|'connecting'|'disconnected'|'paused'|'ready'|'blocked';
 severity:'neutral'|'info'|'warning'|'error'|'success';
 readyPlatforms:AccountPlatform[];blockedPlatforms:AccountPlatform[];problem:UiFailure|null;primaryTarget:NavigationTarget|null;
 preparationStep:'bind'|'confirm_device'|'connect_account'|null;
}
const platforms=['openai','claude'] as const;
const severities:Record<DesktopPresentation['kind'],DesktopPresentation['severity']>={loading:'info',unconfirmed:'warning',failed:'error',rejected:'error',occupied:'error',unbound:'info',pairing:'info',starting:'info',stopping:'info',no_accounts:'info',stopped:'neutral',connecting:'info',disconnected:'warning',paused:'neutral',ready:'success',blocked:'warning'};
/** Read-only presentation of confirmed facts. It never schedules work or authorizes a write. */
export function deriveDesktopStatus(snapshot:DesktopSnapshot,now:number):DesktopPresentation {
 const s=snapshot,r=s.runtime;
 const startup=s.startup&&(!s.startup.instance||s.startup.instance===s.native.metadata?.instance)&&(s.startup.binding_revision===null||s.startup.binding_revision===s.bindingRevision)&&(s.startup.network_revision===null||s.startup.network_revision===r?.network_revision)?s.startup:undefined;
 const selected=platforms.filter(p=>s.accounts[p]?.selection.state==='selected');
 const accountKnown=(p:AccountPlatform)=>!!s.accounts[p]&&!s.accountErrors[p]&&!!s.accountRefresh[p]?.lastConfirmedAt;
 const readyPlatforms=selected.filter(p=>{
  const v=s.supplies[p];return !s.error&&!s.deviceError&&!s.diagnosticFailure&&startup?.state!=='blocked'&&startup?.state!=='checking'&&r?.local==='running'&&r.connection==='connected'&&accountKnown(p)&&!s.supplyErrors[p]&&!!v&&now-Date.parse(v.checked_at)<=30000&&v.ready&&!v.paused&&v.reasons.length===0&&s.device?.state==='bound'&&v.device_id===s.device.identity?.id&&v.hive===s.device.hive;
 });
 const blockedPlatforms=platforms.filter(p=>!readyPlatforms.includes(p)&&(!!s.accountErrors[p]||!!s.supplyErrors[p]||selected.includes(p)));
 const result=(kind:DesktopPresentation['kind'],problem:UiFailure|null=null,primaryTarget:NavigationTarget|null=null,preparationStep:DesktopPresentation['preparationStep']=null):DesktopPresentation=>({kind,severity:severities[kind],readyPlatforms:kind==='ready'?readyPlatforms:[],blockedPlatforms,problem,primaryTarget,preparationStep});
 if(s.native.state==='starting')return result('loading');
 if(s.native.state==='failed'||s.native.state==='stopped')return result('failed',s.native.error?normalizeFailure(s.native.error,'bridge_startup'):null,{page:'diagnostics'});
 if(s.error)return result('unconfirmed',s.error,{page:'diagnostics'});
 const problem=s.deviceError??s.diagnosticFailure??startup?.failure??null;
 const rejected=problem&&(['device_replaced','invalid_device_credential','identity_mismatch'].includes(problem.code)||problem.check==='device_identity'&&problem.evidence.http_status==='401');
 if(rejected)return result('rejected',problem,{page:'overview',section:'device'});
 if(r?.local==='failed')return result('failed',r.operation?.error?normalizeFailure(r.operation.error,'runtime_operation'):problem,{page:'diagnostics',section:'runtime'});
 if(r?.connection==='occupied')return result('occupied',problem,{page:'overview',section:'connection'});
 if(r?.connection==='rejected')return result('rejected',r.connection_detail?.failure?normalizeFailure({...r.connection_detail.failure,observedAt:r.connection_detail.failure.occurred_at,check:r.connection_detail.failure.stage},'connection'):problem,{page:'overview',section:'connection'});
 if(problem||startup?.state==='blocked')return result('unconfirmed',problem,{page:'diagnostics'});
 if(!s.device||!r)return result(s.refresh.lastConfirmedAt?'unconfirmed':'loading');
 if(s.device.state==='unbound')return result('unbound',null,{page:'overview',section:'device'},'bind');
 if(s.device.state!=='bound')return result('pairing',s.device.recovery?.failure?normalizeFailure(s.device.recovery.failure,'pairing_status'):null,{page:'overview',section:'device'},'confirm_device');
 if(r.local==='starting'||r.local==='stopping')return result(r.local,null,{page:'overview',section:'runtime'});
 if(!selected.length){
  if(platforms.every(accountKnown))return result('no_accounts',null,{page:'accounts',section:'account'},'connect_account');
  return result('unconfirmed',s.accountErrors.openai??s.accountErrors.claude??null,{page:'accounts'});
 }
 if(r.local==='stopped')return result('stopped',null,{page:'overview',section:'runtime'});
 if(startup?.state==='checking')return result('unconfirmed',null,{page:'overview',section:'device'});
 if(r.connection==='connecting'||r.connection==='reconnecting')return result('connecting',null,{page:'overview',section:'connection'});
 if(r.connection!=='connected')return result('disconnected',null,{page:'overview',section:'connection'});
 if(readyPlatforms.length)return result('ready',null,blockedPlatforms.length?{page:'accounts',section:'account',platform:blockedPlatforms[0]}:null);
 const current=(p:AccountPlatform)=>{const v=s.supplies[p];return accountKnown(p)&&!s.supplyErrors[p]&&v&&now-Date.parse(v.checked_at)<=30000;};
 if(selected.every(p=>current(p)&&s.supplies[p]?.paused))return result('paused',null,{page:'accounts',section:'account',platform:selected[0]});
 return result('blocked',s.accountErrors[selected[0]]??s.supplyErrors[selected[0]]??null,{page:'accounts',section:'account',platform:blockedPlatforms[0]??selected[0]});
}
