import type {AccountError,AccountSnapshot} from '../../src/system/accounts';
import type {CodexLoginOperation,CodexLoginProgress,CodexLoginProgressResult,CodexLoginOpenResult,CodexLoginRestartRequest,CodexLoginRestartReceipt,CodexLoginRestartProgress,CodexLoginRestartProgressResult} from '../../src/system/codexLogin.contract';

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
  recheck_in_flight:false,actions:{open:false,cancel:true,retry:false,recheck:false,restart:false},blocker:null,
 }}},
 waitingWithoutLink:{instance,result:{progress:{
  operation:{...operation,state:'running',revision:2},sequence:2,phase:'waiting_authorization',stop_reason:null,
  recheck_in_flight:false,actions:{open:false,cancel:true,retry:false,recheck:false,restart:false},blocker:null,
 }}},
 // Only the availability flag is exposed; the validated link stays native.
 waitingWithLink:{instance,result:{progress:{
  operation:{...operation,state:'running',revision:2},sequence:3,phase:'waiting_authorization',stop_reason:null,
  recheck_in_flight:false,actions:{open:true,cancel:true,retry:false,recheck:false,restart:false},blocker:null,
 }}},
 // Cancellation has been accepted, but process cleanup is still in progress.
 cancelling:{instance,result:{progress:{
  operation:{...operation,state:'running',revision:2},sequence:4,phase:'cleaning_up',stop_reason:'cancelled',
  recheck_in_flight:false,actions:{open:false,cancel:false,retry:false,recheck:false,restart:false},blocker:null,
 }}},
 cleanupBlocked:{instance,result:{progress:{
  operation:{...operation,state:'failed',revision:3,error:processFailed},sequence:5,phase:'cleaning_up',stop_reason:'failed',
  recheck_in_flight:false,actions:{open:false,cancel:false,retry:false,recheck:false,restart:false},blocker:cleanupBlocker,
 }}},
 failed:{instance,result:{progress:{
  operation:{...operation,state:'failed',revision:3,error:processFailed},sequence:6,phase:'finished',stop_reason:'failed',
  recheck_in_flight:false,actions:{open:false,cancel:false,retry:true,recheck:false,restart:true},blocker:null,
 }}},
 // The deadline is known, but the result is not terminal before process cleanup.
 timedOutCleaning:{instance,result:{progress:{
  operation:{...operation,state:'running',revision:2},sequence:4,phase:'cleaning_up',stop_reason:'timed_out',
  recheck_in_flight:false,actions:{open:false,cancel:false,retry:false,recheck:false,restart:true},blocker:null,
 }}},
 timedOut:{instance,result:{progress:{
  operation:{...operation,state:'failed',revision:3,error:timeout},sequence:5,phase:'finished',stop_reason:'timed_out',
  recheck_in_flight:false,actions:{open:false,cancel:false,retry:true,recheck:false,restart:true},blocker:null,
 }}},
 verifying:{instance,result:{progress:{
  operation:{...operation,state:'running',revision:2},sequence:4,phase:'verifying',stop_reason:null,
  recheck_in_flight:false,actions:{open:false,cancel:true,retry:false,recheck:false,restart:false},blocker:null,
 }}},
 succeeded:{instance,result:{progress:{
  operation:{...operation,state:'succeeded',revision:3},sequence:5,phase:'finished',stop_reason:null,
  recheck_in_flight:false,actions:{open:false,cancel:false,retry:false,recheck:false,restart:false},blocker:null,
 }}},
 // Process completion does not clear a separate account-maintenance barrier.
 retryBlocked:{instance,result:{progress:{
  operation:{...operation,state:'failed',revision:3,error:processFailed},sequence:6,phase:'finished',stop_reason:'failed',
  recheck_in_flight:false,actions:{open:false,cancel:false,retry:false,recheck:true,restart:true},blocker:maintenanceBlocker,
 }}},
 cancelled:{instance,result:{progress:{
  operation:{...operation,state:'cancelled',revision:3,error:cancelled},sequence:5,phase:'finished',stop_reason:'cancelled',
  recheck_in_flight:false,actions:{open:false,cancel:false,retry:true,recheck:false,restart:true},blocker:null,
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

// Synthetic recovery snapshots only. /mock/codex is an invented source directory;
// the request below is descriptive data and never invokes the bridge or a worker.
// All scenarios retain the original operation ID and the same selected identity.
const recoveryObserved='2026-11-05T00:00:00Z';
const recoverySource={directory:'/mock/codex',store:'file'};
const recoveryFingerprint='c'.repeat(64);
const recoveryTimeoutOperation={...operation,state:'failed',revision:3,error:timeout} satisfies CodexLoginOperation;
const recoveryGuardBlocker={platform:'openai',code:'login_maintenance_unconfirmed',check:'login_maintenance_recovery',message:'Simulated recovery blocked: original process guard is still held; process exit is unconfirmed; required=acquire the original guard before restoring maintenance',evidence:{cause:'simulated saved journal present; original guard held; process exit unconfirmed',confirmed:'false'}} satisfies AccountError;
const recoverySourceBlocker={platform:'openai',code:'source_missing',check:'read_file',message:'Simulated original source read failed: file absent; required=readable original source before restoring maintenance',evidence:{not_found:'true',permission_denied:'false',os_error:'simulated file does not exist'}} satisfies AccountError;
const recoveryCachedBlocker={platform:'openai',code:'login_maintenance_unconfirmed',check:'login_maintenance_recovery',message:'Simulated original process cleanup failure retained: stop proof is unavailable; current same-instance recheck reuses the cached failure',evidence:{cause:'simulated cached process cleanup failure; no renewed stop proof',confirmed:'false'}} satisfies AccountError;
const recoveryUnknownCapability={status:'unknown',observed_at:null,metadata_observed_at:null,valid_until:null,retry_at:null,plan:null,windows:[],models:[],error:null};
const recoveryAccountBase={
 platform:'openai',revision:10,operation:codexLoginExamples.timedOutCleaning.result.progress.operation,
 // The saved maintenance operation can lag the live running operation.
 login_maintenance:{operation,phase:'authorizing',source:recoverySource,started_at:recoveryObserved,can_recheck:false,error:null},
 candidate:{state:'not_checked',reference:null,source:null,fingerprint:null,plan:null,expires_at:null,identity_verified:false,observed_at:null,error:null},
 selection:{state:'selected',fingerprint:recoveryFingerprint,observed_at:recoveryObserved,error:null},
 hive:{state:'unconfirmed',fingerprint:recoveryFingerprint,pending_fingerprint:null,generation:null,observed_at:recoveryObserved,error:null},
 authorization:{state:'not_checked',fingerprint:null,observed_at:null,error:null},
 capabilities:[{origin:'official',...recoveryUnknownCapability},{origin:'hive',...recoveryUnknownCapability}],
 features:{
  detect:{available:true,reason:null},check:{available:true,reason:null},
  select:{available:true,reason:null},
  confirm_change:{available:true,reason:null},
  clear_selection:{available:true,reason:null},
  authorize:{available:true,reason:null},
  remove:{available:false,reason:'runtime_drain_and_detach_required'},
  system_notifications:{available:false,reason:'system_notification_service_required'},
 },
 issues:[],checked_at:recoveryObserved,
} satisfies AccountSnapshot;
// Capabilities above describe a desktop with runtime and authorizer installed;
// they do not grant admission while maintenance blocks the original operation.
// These guard-recheck examples have no cached same-instance processCleanupErr.
// Guard acquisition and source verification may fail; can_recheck is not repair.
const recoveryBlockedAccount={
 ...recoveryAccountBase,revision:11,operation:recoveryTimeoutOperation,
 login_maintenance:{...recoveryAccountBase.login_maintenance,operation:recoveryTimeoutOperation,phase:'blocked',can_recheck:true,error:recoveryGuardBlocker},
} satisfies AccountSnapshot;
const recoveryBlockedProgress={
 operation:recoveryTimeoutOperation,sequence:5,phase:'cleaning_up',stop_reason:'timed_out',
 recheck_in_flight:false,actions:{open:false,cancel:false,retry:false,recheck:true,restart:true},blocker:recoveryGuardBlocker,
} satisfies CodexLoginProgress;
const recoveryRecheckingProgress={
 ...recoveryBlockedProgress,sequence:6,recheck_in_flight:true,
 actions:{open:false,cancel:false,retry:false,recheck:false,restart:false},blocker:null,
} satisfies CodexLoginProgress;
const recoveryRecheckingAccount={
 ...recoveryBlockedAccount,revision:12,
 login_maintenance:{...recoveryBlockedAccount.login_maintenance,phase:'reconciling',can_recheck:false,error:null},
} satisfies AccountSnapshot;
const recoveryReadyProgress={
 ...recoveryBlockedProgress,sequence:7,phase:'finished',
 actions:{open:false,cancel:false,retry:true,recheck:false,restart:true},blocker:null,
} satisfies CodexLoginProgress;
const recoveryReadyAccount={
 ...recoveryBlockedAccount,revision:13,
 login_maintenance:{...recoveryBlockedAccount.login_maintenance,phase:'restored',can_recheck:false,error:null},
 candidate:{state:'available',reference:'b'.repeat(48),source:recoverySource,fingerprint:recoveryFingerprint,plan:'plus',expires_at:'2026-11-07T00:00:00Z',identity_verified:false,observed_at:recoveryObserved,error:null},
 authorization:{state:'local_structure_only',fingerprint:recoveryFingerprint,observed_at:recoveryObserved,error:null},
} satisfies AccountSnapshot;
const recoveryStillBlockedProgress={
 ...recoveryBlockedProgress,sequence:7,phase:'finished',blocker:recoverySourceBlocker,
} satisfies CodexLoginProgress;
const recoveryStillBlockedAccount={
 ...recoveryBlockedAccount,revision:13,
 login_maintenance:{...recoveryBlockedAccount.login_maintenance,error:recoverySourceBlocker},
} satisfies AccountSnapshot;

type CodexLoginRecoveryExample={
 progressReply:{instance:typeof instance;result:CodexLoginProgressResult};
 accountReply:{instance:typeof instance;result:{account:AccountSnapshot}};
 request?:{command:'account_snapshot';args:{platform:'openai';refresh:true}};
};

export const codexLoginRecoveryExamples={
 timedOutEnding:{
  progressReply:codexLoginExamples.timedOutCleaning,
  accountReply:{instance,result:{account:recoveryAccountBase}},
 },
 endingBlocked:{
  progressReply:{instance,result:{progress:recoveryBlockedProgress}},
  accountReply:{instance,result:{account:recoveryBlockedAccount}},
 },
 // Current native refresh cannot discharge a cached process cleanup error.
 // The proposed progress must not advertise a repair that does not exist yet.
 cachedCleanupFailure:{
  progressReply:{instance,result:{progress:{
   ...recoveryBlockedProgress,
   actions:{open:false,cancel:false,retry:false,recheck:false,restart:false},blocker:recoveryCachedBlocker,
  }}},
  accountReply:{instance,result:{account:{
   ...recoveryBlockedAccount,
   login_maintenance:{...recoveryBlockedAccount.login_maintenance,error:recoveryCachedBlocker},
  }}},
 },
 // The immediate existing-command response can still be the old blocked
 // snapshot. Sending this request is not acknowledgement of a recovery worker.
 recheckRequested:{
  request:{command:'account_snapshot',args:{platform:'openai',refresh:true}},
  progressReply:{instance,result:{progress:recoveryBlockedProgress}},
  accountReply:{instance,result:{account:recoveryBlockedAccount}},
 },
 // Only the proposed progress observation identifies an in-flight worker;
 // the existing maintenance vocabulary remains reconciling, not rechecking.
 rechecking:{
  progressReply:{instance,result:{progress:recoveryRecheckingProgress}},
  accountReply:{instance,result:{account:recoveryRecheckingAccount}},
 },
 // Restoring maintenance neither changes the selection nor rewrites the old
 // timeout as a successful login. This proposed progress assumes every dynamic
 // admission check also passed; neither restored nor features alone grants retry.
 // A future retry must create a new operation.
 readyToLogin:{
  progressReply:{instance,result:{progress:recoveryReadyProgress}},
  accountReply:{instance,result:{account:recoveryReadyAccount}},
 },
 stillBlocked:{
  progressReply:{instance,result:{progress:recoveryStillBlockedProgress}},
  accountReply:{instance,result:{account:recoveryStillBlockedAccount}},
 },
} satisfies Record<string,CodexLoginRecoveryExample>;

// Proposed restart contract examples only; authorize_restart and every restart_*
// error/check below are definitions, not implemented commands or observed runs.
// Scope is the same synthetic instance/source throughout. Each entry is an
// alternative snapshot of one accepted request, not a sequence to execute.
const restartRequest={request_id:'d'.repeat(48),platform:'openai',previous_operation_id:operation.id,source:recoverySource,expected_revision:13} satisfies CodexLoginRestartRequest;
const restartReceipt={id:restartRequest.request_id,platform:'openai',previous_operation_id:operation.id,accepted:true} satisfies CodexLoginRestartReceipt;
const restartRequestDescription={command:'authorize_restart',args:{request:restartRequest}} as const;
// This receipt is immutable even when the workflow later fails or is cancelled.
const restartReceiptReply={instance,result:{restart:restartReceipt}} satisfies {instance:typeof instance;result:{restart:CodexLoginRestartReceipt}};
const restartNewOperation={...operation,id:'e'.repeat(48),state:'pending',revision:14} satisfies CodexLoginOperation;
const restartPreviousUnknown={...recoveryTimeoutOperation,state:'unknown',error:{platform:'openai',code:'authorization_result_unknown',check:'original_login_process',message:'Simulated previous login result is unknown: no confirmed authorization result was recorded; process stop verification does not establish that result',evidence:{confirmed:'false'}}} satisfies CodexLoginOperation;
const restartUnknownChild={...restartNewOperation,state:'unknown',error:{platform:'openai',code:'authorization_result_unknown',check:'original_login_process',message:'Simulated child result is unknown: the child ID was persisted but no authoritative launch result was recorded; required=observe the same child without a new spawn',evidence:{cause:'simulated persisted child ID with unconfirmed launch result',confirmed:'false'}}} satisfies CodexLoginOperation;
const restartStoppingProgress={
 id:restartRequest.request_id,platform:'openai',previous_operation_id:operation.id,sequence:1,state:'running',stage:'stop_previous',
 previous_operation:{...operation,state:'running',revision:2},previous_stop:'unknown',new_operation:null,
 cancel_requested:false,actions:{cancel:true,restart:false},failure:null,
} satisfies CodexLoginRestartProgress;
const restartChildProgress={
 operation:restartNewOperation,sequence:1,phase:'starting',stop_reason:null,recheck_in_flight:false,
 actions:{open:false,cancel:true,retry:false,recheck:false,restart:false},blocker:null,
} satisfies CodexLoginProgress;

type CodexLoginRestartExample={
 request:{command:'authorize_restart';args:{request:CodexLoginRestartRequest}};
 receiptReply:{instance:typeof instance;result:{restart:CodexLoginRestartReceipt}};
 progressReply:{instance:typeof instance;result:CodexLoginRestartProgressResult};
 loginProgressReply?:{instance:typeof instance;result:CodexLoginProgressResult};
};

export const codexLoginRestartExamples={
 stoppingPrevious:{
  request:restartRequestDescription,receiptReply:restartReceiptReply,
  progressReply:{instance,result:{restart:restartStoppingProgress}},
 },
 // Requesting termination or sending a signal is not proof of process exit.
 confirmingStopped:{
  request:restartRequestDescription,receiptReply:restartReceiptReply,
  progressReply:{instance,result:{restart:{
   ...restartStoppingProgress,sequence:2,stage:'confirm_stopped',
  }}},
 },
 // No new child is committed yet, so cancellation can still prevent its start.
 startingAfterStop:{
  request:restartRequestDescription,receiptReply:restartReceiptReply,
  progressReply:{instance,result:{restart:{
   ...restartStoppingProgress,sequence:3,stage:'start_new',
   previous_operation:recoveryTimeoutOperation,previous_stop:'confirmed',
  }}},
 },
 // Workflow success only records acceptance of a distinct pending login child.
 newLoginStarted:{
  request:restartRequestDescription,receiptReply:restartReceiptReply,
  progressReply:{instance,result:{restart:{
   ...restartStoppingProgress,sequence:4,state:'succeeded',stage:'finished',
   previous_operation:recoveryTimeoutOperation,previous_stop:'confirmed',new_operation:restartNewOperation,
   actions:{cancel:false,restart:false},
  }}},
  loginProgressReply:{instance,result:{progress:restartChildProgress}},
 },
 stopBlocked:{
  request:restartRequestDescription,receiptReply:restartReceiptReply,
  progressReply:{instance,result:{restart:{
   ...restartStoppingProgress,sequence:3,state:'failed',stage:'confirm_stopped',
   previous_operation:recoveryTimeoutOperation,actions:{cancel:false,restart:false},
   failure:{stage:'confirm_stopped',error:{platform:'openai',code:'restart_stop_unconfirmed',check:'restart_process_observation',message:'Simulated original process-group observation failed: OS permission denied; liveness is unknown; required=positive stop proof before creating a child',evidence:{os_error:'simulated permission denied during original group observation',permission_denied:'true',confirmed:'false'}}},
  }}},
 },
 // Missing journal evidence is an identification failure, not a failed kill.
 unidentifiedPrevious:{
  request:restartRequestDescription,receiptReply:restartReceiptReply,
  progressReply:{instance,result:{restart:{
   ...restartStoppingProgress,sequence:1,state:'failed',stage:'identify_previous',previous_operation:null,
   actions:{cancel:false,restart:false},
   failure:{stage:'identify_previous',error:{platform:'openai',code:'restart_previous_unidentified',check:'restart_identify_previous',message:'Simulated previous operation identification failed: saved original journal is missing; process ownership and stop state are unknown; required=original operation evidence',evidence:{cause:'simulated saved original journal missing',confirmed:'false'}}},
  }}},
 },
 unknownHistoryStopped:{
  request:restartRequestDescription,receiptReply:restartReceiptReply,
  progressReply:{instance,result:{restart:{
   ...restartStoppingProgress,sequence:4,state:'succeeded',stage:'finished',
   previous_operation:restartPreviousUnknown,previous_stop:'confirmed',new_operation:restartNewOperation,
   actions:{cancel:false,restart:false},
  }}},
  loginProgressReply:{instance,result:{progress:restartChildProgress}},
 },
 // A future explicit restart needs a NEW request_id. Replaying this request
 // returns its original receipt/progress and must never create another child.
 startRejectedSafeRetry:{
  request:restartRequestDescription,receiptReply:restartReceiptReply,
  progressReply:{instance,result:{restart:{
   ...restartStoppingProgress,sequence:4,state:'failed',stage:'start_new',
   previous_operation:recoveryTimeoutOperation,previous_stop:'confirmed',
   actions:{cancel:false,restart:true},
   failure:{stage:'start_new',error:{platform:'openai',code:'client_missing',check:'official_executable',message:'Simulated Codex executable resolution failed: program not found and no child record or spawn was created; install or restore the supported official CLI before a fresh restart',evidence:{not_found:'true',cause:'simulated official executable absent before child commitment'}}},
  }}},
 },
 // The child ID was persisted before launch. Unknown launch outcome permits
 // observation of that same ID only; neither replay nor cancel starts a child.
 launchOutcomeUnknown:{
  request:restartRequestDescription,receiptReply:restartReceiptReply,
  progressReply:{instance,result:{restart:{
   ...restartStoppingProgress,sequence:4,state:'unknown',stage:'start_new',
   previous_operation:recoveryTimeoutOperation,previous_stop:'confirmed',new_operation:restartUnknownChild,
   actions:{cancel:false,restart:false},
   failure:{stage:'start_new',error:{platform:'openai',code:'restart_start_unconfirmed',check:'restart_start_new',message:'Simulated new login launch result is unknown: child ID is durably recorded but spawn acceptance is unconfirmed; required=observe the original recorded child without replaying launch',evidence:{cause:'simulated launch receipt unavailable after child ID persistence',confirmed:'false'}}},
  }}},
 },
 // Cancellation prevents a new child after the original stop is proven. It
 // makes no promise to revert credentials the official client already saved.
 cancelledBeforeNew:{
  request:restartRequestDescription,receiptReply:restartReceiptReply,
  progressReply:{instance,result:{restart:{
   ...restartStoppingProgress,sequence:4,state:'cancelled',stage:'finished',
   previous_operation:recoveryTimeoutOperation,previous_stop:'confirmed',cancel_requested:true,
   actions:{cancel:false,restart:true},
  }}},
 },
} satisfies Record<string,CodexLoginRestartExample>;
