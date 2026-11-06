import type {AccountError} from '../../src/system/accounts';
import type {CodexLoginOperation,CodexLoginProgressResult,CodexLoginOpenResult} from '../../src/system/codexLogin.contract';

// Simulated contract examples only. No native commands, launcher, login process,
// credentials or account files are accessed. These are alternative snapshots,
// not a replayable state machine or a declaration of production capabilities.
const instance='codex-login-contract-mock';
const operation={id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',kind:'authorize',platform:'openai',state:'pending',revision:1,error:null} satisfies CodexLoginOperation;
const processFailed={platform:'openai',code:'authorization_process_failed',check:'official_process',message:'Simulated official login failed: exit_code=1; required=successful current process exit',evidence:{cause:'simulated official process exit_code=1',confirmed:'false'}} satisfies AccountError;
const timeout={platform:'openai',code:'authorization_timeout',check:'official_process_deadline',message:'Simulated official login deadline reached: completion_confirmed=false; required=completion before deadline',evidence:{confirmed:'false'}} satisfies AccountError;
const cancelled={platform:'openai',code:'authorization_cancelled',check:'official_process',message:'Simulated official login cancelled: completion_confirmed=false; owned process cleanup confirmed',evidence:{confirmed:'false'}} satisfies AccountError;
const cleanupBlocker={platform:'openai',code:'login_maintenance_unconfirmed',check:'login_maintenance_recovery',message:'Simulated cleanup blocked: child_process_still_observed=true; required=no owned child process before retry',evidence:{cause:'simulated child process still observed',confirmed:'false'}} satisfies AccountError;
const maintenanceBlocker={platform:'openai',code:'login_maintenance_unconfirmed',check:'login_maintenance_recovery',message:'Simulated retry admission blocked: maintenance_restored=false; required=restored account maintenance before a fresh start',evidence:{cause:'simulated account maintenance not restored',confirmed:'false'}} satisfies AccountError;

export const codexLoginExamples={
 starting:{instance,result:{progress:{
  operation,sequence:1,phase:'starting',stop_reason:null,
  actions:{open:false,cancel:true,retry:false},blocker:null,
 }}},
 waitingWithoutLink:{instance,result:{progress:{
  operation:{...operation,state:'running',revision:2},sequence:2,phase:'waiting_authorization',stop_reason:null,
  actions:{open:false,cancel:true,retry:false},blocker:null,
 }}},
 // Only the availability flag is exposed; the validated link stays native.
 waitingWithLink:{instance,result:{progress:{
  operation:{...operation,state:'running',revision:2},sequence:3,phase:'waiting_authorization',stop_reason:null,
  actions:{open:true,cancel:true,retry:false},blocker:null,
 }}},
 // Cancellation has been accepted, but process cleanup is still in progress.
 cancelling:{instance,result:{progress:{
  operation:{...operation,state:'running',revision:2},sequence:4,phase:'cleaning_up',stop_reason:'cancelled',
  actions:{open:false,cancel:false,retry:false},blocker:null,
 }}},
 cleanupBlocked:{instance,result:{progress:{
  operation:{...operation,state:'failed',revision:3,error:processFailed},sequence:5,phase:'cleaning_up',stop_reason:'failed',
  actions:{open:false,cancel:false,retry:false},blocker:cleanupBlocker,
 }}},
 failed:{instance,result:{progress:{
  operation:{...operation,state:'failed',revision:3,error:processFailed},sequence:6,phase:'finished',stop_reason:'failed',
  actions:{open:false,cancel:false,retry:true},blocker:null,
 }}},
 // The deadline is known, but the result is not terminal before process cleanup.
 timedOutCleaning:{instance,result:{progress:{
  operation:{...operation,state:'running',revision:2},sequence:4,phase:'cleaning_up',stop_reason:'timed_out',
  actions:{open:false,cancel:false,retry:false},blocker:null,
 }}},
 timedOut:{instance,result:{progress:{
  operation:{...operation,state:'failed',revision:3,error:timeout},sequence:5,phase:'finished',stop_reason:'timed_out',
  actions:{open:false,cancel:false,retry:true},blocker:null,
 }}},
 verifying:{instance,result:{progress:{
  operation:{...operation,state:'running',revision:2},sequence:4,phase:'verifying',stop_reason:null,
  actions:{open:false,cancel:true,retry:false},blocker:null,
 }}},
 succeeded:{instance,result:{progress:{
  operation:{...operation,state:'succeeded',revision:3},sequence:5,phase:'finished',stop_reason:null,
  actions:{open:false,cancel:false,retry:false},blocker:null,
 }}},
 // Process completion does not clear a separate account-maintenance barrier.
 retryBlocked:{instance,result:{progress:{
  operation:{...operation,state:'failed',revision:3,error:processFailed},sequence:6,phase:'finished',stop_reason:'failed',
  actions:{open:false,cancel:false,retry:false},blocker:maintenanceBlocker,
 }}},
 cancelled:{instance,result:{progress:{
  operation:{...operation,state:'cancelled',revision:3,error:cancelled},sequence:5,phase:'finished',stop_reason:'cancelled',
  actions:{open:false,cancel:false,retry:true},blocker:null,
 }}},
} satisfies Record<string,{instance:typeof instance;result:CodexLoginProgressResult}>;

export const codexLoginOpenExamples={
 opened:{instance,result:{open:{
  opened:true,error:null,progress:codexLoginExamples.waitingWithLink.result.progress,
 }}},
 // A launcher failure leaves the validated live-operation link available.
 launcherFailed:{instance,result:{open:{
  opened:false,
  error:{platform:'openai',code:'authorization_browser_open_failed',check:'browser_opener',message:'Simulated launcher rejected the request: opened=false; required=successful launcher exit',evidence:{cause:'simulated launcher rejection',confirmed:'false'}},
  progress:codexLoginExamples.waitingWithLink.result.progress,
 }}},
 linkUnavailable:{instance,result:{open:{
  opened:false,
  error:{platform:'openai',code:'authorization_link_unavailable',check:'authorization_link',message:'Simulated open refused: phase=cleaning_up; required=waiting_authorization with a validated live-operation link',evidence:{cause:'simulated operation cleanup in progress',confirmed:'false'}},
  progress:codexLoginExamples.cancelling.result.progress,
 }}},
} satisfies Record<string,{instance:typeof instance;result:CodexLoginOpenResult}>;
