export type Platform = 'openai' | 'claude';
export type Page =
  | 'overview'
  | 'accounts'
  | 'earnings'
  | 'diagnostics'
  | 'settings';
export type TaskState = { kind: 'known'; count: number } | { kind: 'unknown' };
export interface ClientError {
  code: string;
  message: string;
}
export type ReadState<T> =
  | { status: 'loading'; updatedAt: string | null; value?: T }
  | { status: 'ready'; updatedAt: string; value: T }
  | {
      status: 'error';
      updatedAt: string | null;
      error: ClientError;
      value?: T;
    };
export interface Binding {
  state: 'unbound' | 'bound';
  label?: string;
  loggedIn?: boolean;
  userId?: string;
  onboardingComplete?: boolean;
  replaceDevice?: string;
  source?: 'new' | 'existing';
}
export interface Process {
  state: 'paused' | 'contributing' | 'stopped';
  owner?: 'app' | 'external';
}
export interface Connection {
  state: 'connected' | 'disconnected';
  endpointLabel: string;
  persistentOffline?: boolean;
}
export interface Account {
  id: string;
  platform: Platform;
  label: string;
  plan: string;
  state: 'available' | 'unavailable';
  paused?: boolean;
  identifier?: string;
  authorization?: 'valid' | 'expired';
  source?: 'existing-login' | 'official';
  updatedAt?: string;
  models?: { name: string; supported: boolean; marketOpen: boolean }[];
  pendingChange?: { identifier: string };
  removal?: 'pending' | 'unknown';
  quota?: { remaining: number; window: string; resetsAt: string };
  feedback?: string;
}
/** All amounts stay decimal strings; never coerce them to Number. */
export type DecimalAmount = string;
export interface Earnings {
  balance: DecimalAmount;
  today: DecimalAmount;
  total: DecimalAmount;
}
export interface FinanceIdentity {
  hive: string;
  user: string;
}
export interface TransferInput extends FinanceIdentity {
  requestId: string;
  amount: DecimalAmount;
}
export interface TransferRecord extends TransferInput {
  id: string;
  date: string;
  status: 'pending' | 'unknown' | 'confirmed';
}
export interface Quote {
  mode: 'default' | 'custom';
  factor: string;
  version: number;
}
export interface Settlement {
  id: string;
  date: string;
  platform: Platform;
  amount: string;
  daysAgo: number;
}
export interface Finance {
  identity: FinanceIdentity;
  buyerBalance: DecimalAmount;
  quote: Quote;
  acceptedQuote: Quote;
  settlements: Settlement[];
  transfers: TransferRecord[];
  pendingTransfer?: TransferRecord;
  quoteUnknown?: boolean;
}
export interface Preferences {
  language: 'system' | 'zh' | 'en';
  theme: 'system' | 'light' | 'dark';
  autoStart?: boolean;
  notifications?: boolean;
  hiveAddress?: string;
  proxyAddress?: string;
}
export interface DesktopSnapshot {
  mode: 'demo' | 'unavailable';
  binding: ReadState<Binding>;
  process: ReadState<Process>;
  connection: ReadState<Connection>;
  accounts: ReadState<Account[]>;
  earnings: ReadState<Earnings>;
  finance: ReadState<Finance>;
  tasks: ReadState<TaskState>;
  preferences: ReadState<Preferences>;
  lifecycle?: { dispatchStopped: boolean; requestId?: string; purpose?: 'exit' | 'update'; finished?: boolean };
  diagnostics?: ReadState<import('../features/diagnostics/report').SanitizedDiagnostics>;
}
// Later feature tasks extend this union alongside their implementation.
export type DesktopCommand =
  | { type: 'lifecycle.wait' | 'lifecycle.check' | 'lifecycle.finish' | 'lifecycle.cancel'; requestId: string; purpose: 'exit' | 'update'; immediate?: boolean }
  | { type: 'runDiagnostics' | 'exportDiagnostics' }
  | { type: 'changeHive'; address: string }
  | { type: 'saveProxy'; address: string }
  | { type: 'setPreference'; preferences: Partial<Preferences> }
  | {
      type: 'saveQuote';
      mode: Quote['mode'];
      factor: string;
      originalVersion: number;
    }
  | ({ type: 'transferEarnings' | 'checkTransfer' } & TransferInput)
  | { type: 'contribution.start' }
  | { type: 'contribution.pause' }
  | { type: 'snapshot.refresh' | 'refresh' }
  | { type: 'loginHive' }
  | { type: 'bindDevice'; replaceConfirmed?: boolean }
  | {
      type:
        | 'detectAccount'
        | 'connectAccount'
        | 'authorizeAccount'
        | 'confirmAccountChange'
        | 'removeAccount';
      platform: Platform;
    }
  | { type: 'startContribution'; platforms: Platform[] }
  | { type: 'setPlatformPaused'; platform: Platform; paused: boolean }
  | { type: 'setAllPaused'; paused: boolean }
  | { type: 'savePreferences'; preferences: Preferences };
export type OperationResult =
  | { kind: 'confirmed'; message: string; demo: boolean }
  | { kind: 'pending'; message: string; operationId: string }
  | { kind: 'unknown'; message: string; operationId: string }
  | { kind: 'failed'; error: ClientError }
  | { kind: 'unsupported'; message: string };
export interface BeeClient {
  snapshot(): Promise<DesktopSnapshot>;
  dispatch(command: DesktopCommand): Promise<OperationResult>;
  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void;
}
