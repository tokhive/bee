/**
 * Contract for review and mocks only. The native progress/open/restart commands and a
 * production client do not exist yet. Do not advertise these as capabilities.
 * See docs/desktop/codex-login-contract.md for lifecycle and failure semantics.
 */
import type {AccountError, AccountOperation, AccountSource} from './accounts';

export type CodexLoginOperation = AccountOperation & {
  kind: 'authorize';
  platform: 'openai';
};

export type CodexLoginPhase =
  | 'starting'
  | 'waiting_authorization'
  | 'verifying'
  | 'cleaning_up'
  | 'finished';

export interface CodexLoginProgress {
  operation: CodexLoginOperation;
  /** Per-operation safe integer; advances on any observable progress change. */
  sequence: number;
  phase: CodexLoginPhase;
  /** A stop was triggered; this alone never confirms process cleanup/result. */
  stop_reason: 'cancelled' | 'timed_out' | 'failed' | null;
  /** Proposed observation of the accepted maintenance worker, not request loading. */
  recheck_in_flight: boolean;
  actions: {
    /** A validated link belongs to this live operation; opening starts no login. */
    open: boolean;
    /** Cancellation can still be requested; acceptance does not mean cleanup. */
    cancel: boolean;
    /** Cleanup and admission barriers permit a fresh start with a new revision. */
    retry: boolean;
    /** Submit existing account_snapshot(openai, true); never kills/restarts login. */
    recheck: boolean;
    /** Admit the proposed stop/prove/handoff/start workflow, never a direct start. */
    restart: boolean;
  };
  /** Cleanup/maintenance blocker, distinct from the original operation error. */
  blocker: AccountError | null;
}

export type CodexLoginOpenReceipt = {
  /** OS launcher exited successfully; this does not confirm browser/page state. */
  opened: true;
  error: null;
  progress: CodexLoginProgress;
} | {
  opened: false;
  error: AccountError;
  progress: CodexLoginProgress;
};

/** Optional additions to AuthorizeClient; existing start/status/cancel stay intact. */
export interface CodexLoginExtension {
  progress(operationId: string): Promise<CodexLoginProgress>;
  open(operationId: string): Promise<CodexLoginOpenReceipt>;
}

/** Proposed bridge result shapes. The existing bridge instance envelope applies. */
export interface CodexLoginProgressResult {progress: CodexLoginProgress}
export interface CodexLoginOpenResult {open: CodexLoginOpenReceipt}

/** A separate, proposed async workflow; this is not an AccountOperation kind. */
export interface CodexLoginRestartRequest {
  /** Caller-generated 48 lowercase hex; persist before first submission/replay. */
  request_id: string;
  platform: 'openai';
  previous_operation_id: string;
  source: AccountSource;
  expected_revision: number;
}

/** Immutable acceptance receipt. A duplicate request returns this same receipt. */
export interface CodexLoginRestartReceipt {
  id: string;
  platform: 'openai';
  previous_operation_id: string;
  accepted: true;
}

export type CodexLoginRestartStage =
  | 'identify_previous'
  | 'stop_previous'
  | 'confirm_stopped'
  | 'prepare_new'
  | 'start_new';

export interface CodexLoginRestartProgress {
  /** Equals request_id within the verified Hive/user/device/platform scope. */
  id: string;
  platform: 'openai';
  previous_operation_id: string;
  sequence: number;
  /** succeeded means one new login was accepted, not that authorization passed. */
  state: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  stage: CodexLoginRestartStage | 'finished';
  /** Missing evidence remains null; an unknown old result remains unknown. */
  previous_operation: CodexLoginOperation | null;
  /** Proof about the original owned tree only, independent of its login result. */
  previous_stop: 'unknown' | 'confirmed';
  /** A distinct new ID; persisted before spawn and never regenerated on replay. */
  new_operation: CodexLoginOperation | null;
  cancel_requested: boolean;
  actions: {
    /** Before durable child-start commitment; cancellation still drains the old tree. */
    cancel: boolean;
    /** A new explicit composite attempt is safe; never permission to bypass stopping. */
    restart: boolean;
  };
  failure: {stage: CodexLoginRestartStage; error: AccountError} | null;
}

/** Proposed commands only. Existing AuthorizeClient and account_snapshot are unchanged. */
export interface CodexLoginRestartClient {
  restart(request: CodexLoginRestartRequest): Promise<CodexLoginRestartReceipt>;
  restartStatus(restartId: string): Promise<CodexLoginRestartProgress>;
  restartCancel(restartId: string): Promise<CodexLoginRestartProgress>;
}

export interface CodexLoginRestartResult {restart: CodexLoginRestartReceipt}
export interface CodexLoginRestartProgressResult {restart: CodexLoginRestartProgress}
