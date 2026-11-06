/**
 * Contract for review and mocks only. The native progress/open commands and a
 * production client do not exist yet. Do not advertise these as capabilities.
 * See docs/desktop/codex-login-contract.md for lifecycle and failure semantics.
 */
import type {AccountError, AccountOperation} from './accounts';

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
