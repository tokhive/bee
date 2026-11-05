import {retryEvidence} from './failures.ts';
import {decodeBridgeError,throwBridgeError,normalizeFailure,requestNotSent,type UiFailure} from './failures.ts';
import { supplyReasons } from './supply.ts';
import type {DeviceInvoke} from './device';

export type DiagnosticPlatform='openai'|'claude';
export type DiagnosticPage='overview'|'accounts'|'diagnostics'|'settings';
export interface DiagnosticCheck {id:'device'|'runtime'|'hive'|'proxy'|'source'|'authorization'|'quota'|'capabilities'|'account'|'supply';platform:DiagnosticPlatform|null;status:'pass'|'warning'|'fail'|'skipped';observed_at:string;code:string;evidence:Record<string,string>;next_action:DiagnosticPage}
export interface DiagnosticReport {id:string;instance:string;run_id:string|null;network_revision:number;binding_revision:number;started_at:string;finished_at:string|null;state:'running'|'completed'|'cancelled';checks:DiagnosticCheck[]}
export type DiagnosticModule='diagnostics'|'runtime'|'network'|'accounts'|'device'|'bridge'|'lifecycle'|'export';
export type DiagnosticLevel='info'|'warning'|'error';
export interface DiagnosticEvent {time:string;level:DiagnosticLevel;module:DiagnosticModule;platform:DiagnosticPlatform|null;code:string;evidence:Record<string,string>}
export interface LogQuery {cursor:string|null;limit:number;module:DiagnosticModule|null;platform:DiagnosticPlatform|null;level:DiagnosticLevel|null}
export interface LogPage {entries:DiagnosticEvent[];next_cursor:string|null;truncated:boolean}
export interface DiagnosticExport {product:'Bee';app_version:string;bee_version:string;os:string;arch:string;report:DiagnosticReport;logs:DiagnosticEvent[];truncated:boolean;truncated_sections:('logs'|'checks')[]}
export const DIAGNOSTIC_EXPORT_BYTES=5*1024*1024;
const modules=['diagnostics','runtime','network','accounts','device','bridge','lifecycle','export'];
const levels=['info','warning','error'];
const codes=new Set('request_timed_out request_settled request_http_started request_http_finished request_http_failed dns_temporary connection_closed connection_refused pending not_checked cancelled timeout unknown unknown_failure dns_failed tls_failed connection_failed invalid_origin http_rejected rate_limited device_replaced invalid_response response_too_large local_read_failed device_not_paired identity_unconfirmed identity_mismatch device_binding_valid runtime_stopped runtime_waiting runtime_unknown runtime_failed connection_disconnected runtime_ownership_conflict owned_runtime_connected network_policy_observed hive_identity_verified selection_read_failed source_not_selected selection_unconfirmed source_changed selected_source_read authorization_expired network_changed expired unconfirmed official_result_unconfirmed quota_unconfirmed official_authorization_observed quota_available quota_exhausted account_result_unconfirmed account_binding_unconfirmed account_changed account_binding_verified capabilities_unconfirmed capabilities_synchronized supply_result_unconfirmed supply_blocked taking_new_work hive_check_failed source_missing source_unavailable permission_denied unsupported_store invalid_directory invalid_credentials deadline bridge_started bridge_stopped bridge_failed export_prepared export_completed export_cancelled export_failed'.split(' '));
const passCodes:Record<string,string>={device:'device_binding_valid',runtime:'owned_runtime_connected',hive:'hive_identity_verified',proxy:'network_policy_observed',source:'selected_source_read',authorization:'official_authorization_observed',quota:'quota_available',capabilities:'capabilities_synchronized',account:'account_binding_verified',supply:'taking_new_work'};
function invalid(check:string):never {throw new Error(`DIAGNOSTICS_REPLY_INVALID: ${check}`);}
function object(value:unknown,fields:string[],at:string):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))invalid(`${at} requires object`);
 const o=value as Record<string,unknown>;
 if(Object.keys(o).some(k=>!fields.includes(k))||fields.some(k=>!Object.hasOwn(o,k)))invalid(`${at} has missing or unknown fields`);
 return o;
}
function enumValue(value:unknown,allowed:unknown[],at:string){if(!allowed.includes(value))invalid(`${at} outside fixed enum`);}
function integer(value:unknown,at:string){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)invalid(`${at} requires nonnegative safe integer`);}
function digest(value:unknown,length:number,at:string){if(typeof value!=='string'||!new RegExp(`^[a-f0-9]{${length}}$`).test(value))invalid(`${at} requires ${length} lowercase hex`);}
function timestamp(value:unknown,at:string){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(Date.parse(value)).toISOString().slice(0,19)!==value.slice(0,19)||Date.parse(value)>Date.now()+5000)invalid(`${at} requires valid observed UTC timestamp`);}
function safeNumber(value:string,max:number){return /^(0|[1-9]\d{0,15})$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)<=max;}
const boolKeys=new Set('identity_valid identity_present credential_valid selected pending_operation source_revision_match valid_beyond_safety_window identity_match generation_match binding_stable ready paused platform_match not_found permission_denied parsed'.split(' '));
const evidenceEnums:Record<string,string[]>={
 method:['GET'],response_limit:['65536'],safety_seconds:['30'],
 path:['/api/bee/pairings','/api/bee/pairings/redeem','/api/bee/identity','/api/bee/platforms/openai/account','/api/bee/platforms/claude/account','/api/bee/platforms/openai/capabilities','/api/bee/platforms/claude/capabilities','/api/bee/platforms/openai','/api/bee/platforms/claude','/backend-api/codex/models','/backend-api/wham/usage','/api/oauth/profile','/api/oauth/usage','/v1/models'],
 reason:supplyReasons,
 source_type:['desktop_device','file','keyring','keychain','auto'],stage:['session','device_configuration','selected_source','persisted_selection','account_readback'],local:['stopped','waiting','starting','running','stopping','failed','unknown'],connection:['connected','disconnected','connecting','reconnecting','occupied','rejected','unknown'],status:['ready','not_configured','confirmation_required','authorization_rejected','expired','unknown'],
 server_code:'pending draining approved redeemed device_exists device_draining replacement_pending pairing_expired pairing_redeemed invalid_device_credential device_replaced rate_limited invalid_pairing invalid_pairing_token unavailable device_changed pairing_pending unrecognized_code device_connected forbidden invalid_content_type invalid_json invalid_platform invalid_pause invalid_confirmation account_changed invalid_lease stale_connection invalid_maintenance tee_unavailable stale_maintenance invalid_authorization invalid_codex_authorization invalid_claude_authorization invalid_envelope codex_account_changed codex_authorization_rejected claude_confirmation_required claude_authorization_rejected invalid_capabilities stale_account capability_metadata_required stale_observation invalid_events'.split(' '),
};
const paths=['direct','local_connect','local_proxy','environment_proxy','environment_with_no_proxy','process_environment','unknown'];
for(const key of ['bee_upstream_path','official_query_path','openai_query_path','claude_query_path','hive_path'])evidenceEnums[key]=paths;
function evidence(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))invalid('evidence requires structured public fields');
 for(const [key,v]of Object.entries(value)){
  if(typeof v!=='string')invalid('evidence requires string values');
  const max:Record<string,number>={network_revision:Number.MAX_SAFE_INTEGER,checked_revision:Number.MAX_SAFE_INTEGER,current_revision:Number.MAX_SAFE_INTEGER,http_status:599,windows:5,max_used_percent:10000,reasons_count:64};
  const retry=retryEvidence(key,v);
  const safe=retry!==undefined?retry:boolKeys.has(key)?v==='true'||v==='false':Object.hasOwn(max,key)?safeNumber(v,max[key])&&(key!=='http_status'||Number(v)>=100):Object.hasOwn(evidenceEnums,key)&&evidenceEnums[key].includes(v);
  if(!safe)invalid('evidence contains a field or value outside public contract');
 }
}
function report(value:unknown,instance:string):DiagnosticReport{
 const r=object(value,['id','instance','run_id','network_revision','binding_revision','started_at','finished_at','state','checks'],'report');
 digest(r.id,48,'report.id');digest(r.instance,32,'report.instance');if(r.instance!==instance)invalid('report instance differs from current child');if(r.run_id!==null)digest(r.run_id,32,'report.run_id');integer(r.network_revision,'report.network_revision');integer(r.binding_revision,'report.binding_revision');
 enumValue(r.state,['running','completed','cancelled'],'report.state');timestamp(r.started_at,'report.started_at');if(r.finished_at!==null)timestamp(r.finished_at,'report.finished_at');if((r.state==='running')!==(r.finished_at===null))invalid('report state/finished_at mismatch');
 if(!Array.isArray(r.checks)||r.checks.length>16)invalid('report checks exceeds fixed count');
 const seen=new Set<string>();
 for(const value of r.checks){
  const c=object(value,['id','platform','status','observed_at','code','evidence','next_action'],'check');
  const general=['device','runtime','hive','proxy'].includes(String(c.id))&&c.platform===null;
  const platform=['source','authorization','quota','capabilities','account','supply'].includes(String(c.id))&&['openai','claude'].includes(String(c.platform));
  if(!(general||platform))invalid('check id/platform requires fixed combination');
  const key=`${c.id}:${c.platform}`;if(seen.has(key))invalid('duplicate check id/platform');seen.add(key);
  enumValue(c.status,['pass','warning','fail','skipped'],'check.status');enumValue(c.next_action,['overview','accounts','diagnostics','settings'],'check.next_action');timestamp(c.observed_at,'check.observed_at');
  if(typeof c.code!=='string'||!codes.has(c.code)||(c.status==='pass'&&c.code!==passCodes[String(c.id)]))invalid('check code/status outside public contract');evidence(c.evidence);
 }
 return structuredClone(r) as unknown as DiagnosticReport;
}
export function decodeDiagnosticReport(reply:unknown,instance:string):DiagnosticReport{
 if(!reply||typeof reply!=='object'||(reply as {instance?:unknown}).instance!==instance)invalid('reply instance differs from current child');
 const result=(reply as {result?:unknown}).result;
 if(result&&typeof result==='object'&&'error'in result){
  const e=decodeBridgeError(object(result,['error'],'result').error,'DIAGNOSTICS_REPLY_INVALID');
  if(e.code!=='DIAGNOSTICS_OPERATION_FAILED'||typeof e.message!=='string'||e.message.length>1024)invalid('operation error envelope rejected');
  throwBridgeError(e,'DIAGNOSTICS_REPLY_INVALID');
 }
 return report(object(result,['report'],'result').report,instance);
}
function event(value:unknown):DiagnosticEvent{
 const e=object(value,['time','level','module','platform','code','evidence'],'event');timestamp(e.time,'event.time');enumValue(e.level,levels,'event.level');enumValue(e.module,modules,'event.module');enumValue(e.platform,[null,'openai','claude'],'event.platform');if(typeof e.code!=='string'||!codes.has(e.code))invalid('event.code outside public contract');evidence(e.evidence);return e as unknown as DiagnosticEvent;
}
function cursor(value:unknown){if(value!==null&&(typeof value!=='string'||value.length>120||!/^v1:[a-f0-9]{1,32}:\d{1,16}:\d{1,16}:[a-f0-9]{8,16}$/.test(value)))invalid('log cursor requires bounded native cursor');}
export function decodeLogPage(value:unknown):LogPage{
 const p=object(value,['entries','next_cursor','truncated'],'log page');if(!Array.isArray(p.entries)||p.entries.length>200)invalid('log page entries exceeds 200');p.entries.forEach(event);cursor(p.next_cursor);if(typeof p.truncated!=='boolean')invalid('log page truncated requires boolean');return structuredClone(p) as unknown as LogPage;
}
function version(value:unknown){return typeof value==='string'&&(value==='dev'||value==='unknown'||/^dev\+[a-f0-9]{12}(?:-dirty)?$/.test(value)||(/^v?(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:[-+][A-Za-z0-9.+-]*)?$/.test(value)&&value.replace(/^v/,'').length<=64));}
export function decodeDiagnosticExport(value:unknown,instance:string):DiagnosticExport{
 const e=object(value,['product','app_version','bee_version','os','arch','report','logs','truncated','truncated_sections'],'export');
 if(e.product!=='Bee'||!version(e.app_version)||!version(e.bee_version))invalid('export product/version rejected');enumValue(e.os,['darwin','macos','windows','linux'],'export.os');enumValue(e.arch,['arm64','aarch64','amd64','x86_64','x86','arm'],'export.arch');report(e.report,instance);
 if(!Array.isArray(e.logs)||e.logs.length>100000)invalid('export logs requires bounded array');e.logs.forEach(event);
 if(typeof e.truncated!=='boolean'||!Array.isArray(e.truncated_sections)||e.truncated_sections.some(s=>s!=='logs'&&s!=='checks')||new Set(e.truncated_sections).size!==e.truncated_sections.length||e.truncated!==(e.truncated_sections.length>0))invalid('export truncation explanation rejected');
 if(new TextEncoder().encode(JSON.stringify(e)).byteLength>DIAGNOSTIC_EXPORT_BYTES)invalid('export exceeds byte limit=5242880');return structuredClone(e) as unknown as DiagnosticExport;
}
export type DiagnosticDownloadState='idle'|'generating'|'waiting'|'completed'|'initiated'|'unconfirmed'|'failed';
export interface DiagnosticSession {start:'idle'|'pending'|'unknown';cancel:'idle'|'pending'|'unknown';read:'idle'|'reading'|'paused';failure:UiFailure|null;readFailure:UiFailure|null;download:DiagnosticDownloadState;downloadFailure:UiFailure|null}
const emptySession=():DiagnosticSession=>({start:'idle',cancel:'idle',read:'idle',failure:null,readFailure:null,download:'idle',downloadFailure:null});
export interface DiagnosticsClient {start():Promise<DiagnosticReport>;snapshot(id:string):Promise<DiagnosticReport>;cancel(id:string):Promise<DiagnosticReport>;logs(query:LogQuery):Promise<LogPage>;export(reportId:string,includeLogs:boolean):Promise<DiagnosticExport>;download(reportId:string,includeLogs:boolean,deliver:(payload:DiagnosticExport)=>Promise<'completed'|'initiated'|'unconfirmed'>):Promise<void>;setContext(networkRevision:number,runId?:string|null,bindingRevision?:number):void;getSnapshot():DiagnosticReport|null;getSession():DiagnosticSession;subscribe(listener:()=>void):()=>void}
export function createDiagnosticsClient(invoke:DeviceInvoke,instance:string|undefined,initialNetworkRevision=0,initialRunId?:string|null,initialBindingRevision=0):DiagnosticsClient{
 if(instance!==undefined)digest(instance,32,'instance');integer(initialNetworkRevision,'network revision');if(initialRunId!==undefined&&initialRunId!==null)digest(initialRunId,32,'run id');
 integer(initialBindingRevision,'binding revision');
 let bindingRevision=initialBindingRevision,networkRevision=initialNetworkRevision,runId=initialRunId,epoch=0,reportGeneration=0,cached:DiagnosticReport|null=null,session=emptySession();
 let reading:Promise<DiagnosticReport>|null=null;
 const listeners=new Set<()=>void>(),emit=()=>listeners.forEach(fn=>fn());
 const update=(patch:Partial<DiagnosticSession>)=>{session={...session,...patch};emit();};
 const current=(generation:number)=>{if(generation!==epoch)invalid('result context changed while request was pending');};
 const currentReport=(generation:number,reportSequence:number)=>{current(generation);if(reportSequence!==reportGeneration)invalid('report superseded while request was pending');};
 const ownsReport=(generation:number,reportSequence:number)=>generation===epoch&&reportSequence===reportGeneration;
 const owned=()=>{if(instance===undefined)invalid('management instance is missing; report actions require a verified current child');};
 const gate=(r:DiagnosticReport)=>{if(r.binding_revision!==bindingRevision)invalid('report binding revision differs from current context');if(r.network_revision!==networkRevision)invalid('report network revision differs from current context');if(runId!==undefined&&r.run_id!==runId)invalid('report run differs from current context');};
 async function request(command:string,args:Record<string,unknown>,id?:string){
  owned();if(id!==undefined)digest(id,48,'report id');const generation=epoch,reportSequence=reportGeneration;
  const r=decodeDiagnosticReport(await invoke(command,args),instance!);currentReport(generation,reportSequence);gate(r);
  if(id!==undefined&&r.id!==id)invalid('report id differs from requested id');
  if(cached?.id===r.id){if(cached.run_id!==r.run_id)invalid('report run changed');if(cached.state!=='running'&&r.state==='running')invalid('terminal report cannot regress to running');}
  cached=r;emit();return structuredClone(r);
 }
 async function exportPayload(reportId:string,includeLogs:boolean){
  owned();digest(reportId,48,'report id');if(typeof includeLogs!=='boolean')invalid('includeLogs requires boolean');if(!cached||cached.id!==reportId)invalid('export report id requires current cached report');gate(cached);const generation=epoch,reportSequence=reportGeneration;
  const e=decodeDiagnosticExport(await invoke('diagnostics_export',{reportId,includeLogs}),instance!);currentReport(generation,reportSequence);gate(e.report);if(e.report.id!==reportId)invalid('export report id differs from requested id');if(!includeLogs&&e.logs.length)invalid('report-only export unexpectedly contains logs');return e;
 }
 return {
  async start(){
   owned();if(session.start!=='idle'||cached?.state==='running')invalid(`diagnostic start blocked: start=${session.start} report=${cached?.state??'none'}`);
   const generation=epoch,reportSequence=++reportGeneration;cached=null;reading=null;update({...emptySession(),start:'pending'});
   try{const r=await request('diagnostics_start',{});update({start:'idle'});return r;}
   catch(cause){if(ownsReport(generation,reportSequence)){const failure=normalizeFailure(cause,'diagnostics_start');update({start:requestNotSent(failure)?'idle':'unknown',failure});}throw cause;}
  },
  async snapshot(id){
   owned();digest(id,48,'report id');if(!cached||cached.id!==id)invalid('snapshot requires the original cached report ID');
   if(reading)return reading;
   const generation=epoch,reportSequence=reportGeneration;update({read:'reading'});
   const task=(async()=>{try{const r=await request('diagnostics_snapshot',{id},id);update({read:'idle',readFailure:null,...(r.state!=='running'?{cancel:'idle',failure:null}:session.cancel==='unknown'?{}:{failure:null})});return r;}
    catch(cause){if(ownsReport(generation,reportSequence))update({read:'paused',readFailure:normalizeFailure(cause,'diagnostics_snapshot')});throw cause;}
    finally{if(ownsReport(generation,reportSequence))reading=null;}})();reading=task;return task;
  },
  async cancel(id){
   owned();digest(id,48,'report id');if(!cached||cached.id!==id||cached.state!=='running'||session.cancel!=='idle')invalid(`diagnostic cancel blocked: cancel=${session.cancel} report=${cached?.state??'none'}`);
   const generation=epoch,reportSequence=reportGeneration;update({cancel:'pending',failure:null});
   try{const r=await request('diagnostics_cancel',{id},id);update({cancel:r.state==='running'?'unknown':'idle',read:r.state==='running'?'paused':'idle',failure:null});return r;}
   catch(cause){if(ownsReport(generation,reportSequence)){const failure=normalizeFailure(cause,'diagnostics_cancel');if(cached?.state!=='running')update({cancel:'idle'});else update({cancel:requestNotSent(failure)?'idle':'unknown',read:'paused',failure});}throw cause;}
  },
  async logs(query){object(query,['cursor','limit','module','platform','level'],'log query');cursor(query.cursor);if(!Number.isInteger(query.limit)||query.limit<1||query.limit>200)invalid('log query limit requires 1..200');enumValue(query.module,[null,...modules],'log query module');enumValue(query.platform,[null,'openai','claude'],'log query platform');enumValue(query.level,[null,...levels],'log query level');const generation=epoch;const page=decodeLogPage(await invoke('diagnostic_logs',{query}));current(generation);return page;},
  export:exportPayload,
  async download(reportId,includeLogs,deliver){
   if(['generating','waiting'].includes(session.download))invalid(`report download already pending: state=${session.download}`);
   const generation=epoch,reportSequence=reportGeneration;update({download:'generating',downloadFailure:null});
   try{const payload=await exportPayload(reportId,includeLogs);currentReport(generation,reportSequence);update({download:'waiting'});const result=await deliver(payload);currentReport(generation,reportSequence);update({download:result});}
   catch(cause){if(ownsReport(generation,reportSequence))update({download:'failed',downloadFailure:normalizeFailure(cause,'diagnostics_download')});throw cause;}
  },
  setContext(nextRevision,nextRunId,nextBindingRevision=bindingRevision){integer(nextBindingRevision,'binding revision');integer(nextRevision,'network revision');if(nextRunId!==undefined&&nextRunId!==null)digest(nextRunId,32,'run id');if(nextRevision!==networkRevision||nextRunId!==runId||nextBindingRevision!==bindingRevision){bindingRevision=nextBindingRevision;networkRevision=nextRevision;runId=nextRunId;epoch++;cached=null;reading=null;session=emptySession();emit();}},
  getSnapshot(){return cached?structuredClone(cached):null;},getSession(){return structuredClone(session);},subscribe(listener){listeners.add(listener);return()=>{listeners.delete(listener);};},
 };
}
