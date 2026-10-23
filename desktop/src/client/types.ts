export type Platform = 'openai' | 'claude';
export type Page = 'overview' | 'accounts' | 'earnings' | 'diagnostics' | 'settings';
export type TaskState = { kind: 'known'; count: number } | { kind: 'unknown' };
export interface ClientError {
  code: string;
  message: string;
}
export type ReadState<T> =
  | { status: 'loading'; updatedAt: string | null; value?: T }
  | { status: 'ready'; updatedAt: string; value: T }
  | { status: 'error'; updatedAt: string | null; error: ClientError; value?: T };
export interface Binding {
  state: 'unbound' | 'bound';
  label?: string;
}
export interface Process {
  state: 'paused' | 'contributing' | 'stopped';
}
export interface Connection {
  state: 'connected' | 'disconnected';
  endpointLabel: string;
}
export interface Account {
  id: string;
  platform: Platform;
  label: string;
  plan: string;
  state: 'available' | 'unavailable';
}
/** All amounts stay decimal strings; never coerce them to Number. */
export type DecimalAmount = string;
export interface Earnings {
  balance: DecimalAmount;
  today: DecimalAmount;
  total: DecimalAmount;
}
export interface Preferences {
  language: 'system' | 'zh' | 'en';
  theme: 'system' | 'light' | 'dark';
}
export interface DesktopSnapshot {
  mode: 'demo' | 'unavailable';
  binding: ReadState<Binding>;
  process: ReadState<Process>;
  connection: ReadState<Connection>;
  accounts: ReadState<Account[]>;
  earnings: ReadState<Earnings>;
  tasks: ReadState<TaskState>;
  preferences: ReadState<Preferences>;
}
// Later feature tasks extend this union alongside their implementation.
export type DesktopCommand =
  | { type: 'contribution.start' }
  | { type: 'contribution.pause' }
  | { type: 'snapshot.refresh' };
export type OperationResult =
  | { kind: 'confirmed'; message: string; demo: boolean }
  | { kind: 'pending'; message: string; operationId: string }
  | { kind: 'failed'; error: ClientError }
  | { kind: 'unsupported'; message: string };
export interface BeeClient {
  snapshot(): Promise<DesktopSnapshot>;
  dispatch(command: DesktopCommand): Promise<OperationResult>;
  subscribe(listener: (snapshot: DesktopSnapshot) => void): () => void;
}
