import {decodeBridgeError,normalizeFailure,requestNotSent,type UiFailure} from './failures.ts';
import type {BridgeError} from './bridge';
import type {DeviceInvoke} from './device';

export type UpdateState = 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'verified' | 'stopping' | 'installing' | 'failed';
export interface UpdateSnapshot {
  operation_id: string | null;
  revision: number;
  state: UpdateState;
  current_version: string;
  target_version: string | null;
  checked_at: string | null;
  downloaded_bytes: number;
  total_bytes: number | null;
  release_notes: string | null;
  error: BridgeError | null;
}
export interface UpdateInstallRequest {operation_id: string; expected_revision: number; confirmed: true}
export interface UpdateSession {snapshot:UpdateSnapshot|undefined;error:UiFailure|null;busy:boolean;uncertain:'check'|'download'|'install'|null;attemptedInstall:string|null}
export interface UpdateClient {
  getSession():UpdateSession;
  subscribe(listener:()=>void):()=>void;
  snapshot(): Promise<UpdateSnapshot>;
  check(): Promise<UpdateSnapshot>;
  download(): Promise<UpdateSnapshot>;
  install(request: UpdateInstallRequest): Promise<UpdateSnapshot>;
}
export class UpdateResultSupersededError extends Error {
  readonly code = 'UPDATE_RESULT_SUPERSEDED';
  constructor(command:string,epoch:number,generation:number) {
    super(`UPDATE_RESULT_SUPERSEDED: ${command} generation actual=${epoch}; required=current generation=${generation}`);
  }
}
const states: readonly UpdateState[] = ['idle','checking','current','available','downloading','verified','stopping','installing','failed'];
const activeStates: readonly UpdateState[] = ['checking','downloading','stopping','installing'];
function invalid(check: string): never {throw new Error(`UPDATE_REPLY_INVALID: ${check}`);}
function actual(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  if (typeof value === 'string') return `string(bytes=${new TextEncoder().encode(value).length})`;
  return Array.isArray(value) ? 'array' : typeof value;
}
function object(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(`${at} actual_type=${actual(value)}; required=object`);
  return value as Record<string, unknown>;
}
function exact(value: unknown, fields: readonly string[], at: string): Record<string, unknown> {
  const record = object(value, at);
  const unknown = Object.keys(record).filter(key => !fields.includes(key));
  if (unknown.length) invalid(`${at} unknown fields actual=${unknown.join(',')}; required=${fields.join(',')}`);
  for (const field of fields) if (!Object.hasOwn(record, field)) invalid(`${at}.${field} actual=missing; required=present`);
  return record;
}
function text(value: unknown, at: string, max = 128, empty = false): asserts value is string {
  if (typeof value !== 'string' || (!empty && !value.length) || new TextEncoder().encode(value).length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid(`${at} actual=${actual(value)}; required=${empty ? '0' : '1'}..${max} UTF-8 bytes of public text`);
}
function integer(value: unknown, at: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(`${at} actual=${actual(value)}; required=nonnegative safe integer`);
}
function nullableText(value: unknown, at: string, max?: number, empty = false): asserts value is string | null {
  if (value !== null) text(value, at, max, empty);
}
function publicError(value: unknown, at: string): BridgeError {
  return decodeBridgeError(value,'UPDATE_REPLY_INVALID');
}

/** The native command returns this exact public value, without a sidecar envelope. */
export function decodeUpdateSnapshot(value: unknown): UpdateSnapshot {
  const o = exact(value, ['operation_id','revision','state','current_version','target_version','checked_at','downloaded_bytes','total_bytes','release_notes','error'], 'update');
  nullableText(o.operation_id, 'update.operation_id'); integer(o.revision, 'update.revision');
  if (!states.includes(o.state as UpdateState)) invalid(`update.state actual=${actual(o.state)}; required=${states.join('|')}`);
  text(o.current_version, 'update.current_version'); nullableText(o.target_version, 'update.target_version');
  nullableText(o.checked_at, 'update.checked_at', 40);
  if (o.checked_at !== null) {
    const date = Date.parse(o.checked_at);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(o.checked_at) || !Number.isFinite(date) || new Date(date).toISOString().slice(0,19) !== o.checked_at.slice(0,19)) invalid(`update.checked_at actual=${o.checked_at}; required=valid UTC RFC3339 calendar timestamp`);
  }
  integer(o.downloaded_bytes, 'update.downloaded_bytes');
  if (o.total_bytes !== null) {
    integer(o.total_bytes, 'update.total_bytes');
    if (o.downloaded_bytes > o.total_bytes) invalid(`update.downloaded_bytes actual=${o.downloaded_bytes}; required=at most total_bytes=${o.total_bytes}`);
  }
  nullableText(o.release_notes, 'update.release_notes', 262144, true);
  const error = o.error === null ? null : publicError(o.error, 'update.error');
  return Object.freeze({operation_id:o.operation_id, revision:o.revision, state:o.state as UpdateState, current_version:o.current_version, target_version:o.target_version, checked_at:o.checked_at, downloaded_bytes:o.downloaded_bytes, total_bytes:o.total_bytes, release_notes:o.release_notes, error:error && Object.freeze(error)});
}

export function createUpdateClient(invoke: DeviceInvoke): UpdateClient {
  let latest: UpdateSnapshot | undefined;
  let generation = 0;
  let mutation = false;
  let uncertainBase:UpdateSnapshot|undefined;
  const nativeRejections=new WeakSet<object>();
  const versions = new Map<string, string>();
  const installations = new Set<string>();
  let session:UpdateSession={snapshot:undefined,error:null,busy:false,uncertain:null,attemptedInstall:null};
  const listeners=new Set<()=>void>();
  const publish=(patch:Partial<UpdateSession>)=>{session={...session,...patch,snapshot:latest};listeners.forEach(fn=>fn());};
  function observe(next: UpdateSnapshot, expected?: UpdateSnapshot): UpdateSnapshot {
    if (latest) {
      if (next.revision < latest.revision) invalid(`update.revision actual=${next.revision}; required=at least accepted revision=${latest.revision}`);
      if (next.revision === latest.revision && JSON.stringify(next) !== JSON.stringify(latest)) invalid(`update.revision actual=${next.revision} with different content; required=same content at accepted revision=${latest.revision}`);
      if (next.current_version !== latest.current_version) invalid(`update.current_version actual=${next.current_version}; required=accepted version=${latest.current_version}`);
    }
    if (expected && next.operation_id !== expected.operation_id) invalid(`update.operation_id actual=${next.operation_id}; required=request operation_id=${expected.operation_id}`);
    if (expected && next.target_version !== expected.target_version) invalid(`update.target_version actual=${next.target_version}; required=request version=${expected.target_version}`);
    if (next.operation_id && next.target_version) {
      const version = versions.get(next.operation_id);
      if (version && version !== next.target_version) invalid(`update.target_version actual=${next.target_version}; required=operation version=${version}`);
      versions.set(next.operation_id, next.target_version);
    }
    latest = next;
    return next;
  }
  async function request(command: string, args: Record<string, unknown> | undefined, epoch: number, expected?: UpdateSnapshot) {
    let reply: unknown;
    try {reply = await invoke(command, args);}
    catch (cause) {
      if (epoch !== generation) throw new UpdateResultSupersededError(command,epoch,generation);
      if (cause instanceof Error) throw cause;
      const error = publicError(cause, `${command}.error`);
      const rejection=Object.assign(new Error(`${error.code}: ${error.message}`, {cause}),{code:error.code,...(error.details?{details:error.details}:{})});
      nativeRejections.add(rejection);throw rejection;
    }
    if (epoch !== generation) throw new UpdateResultSupersededError(command,epoch,generation);
    return observe(decodeUpdateSnapshot(reply), expected);
  }
  async function mutate(command: string, args?: Record<string, unknown>, expected?: UpdateSnapshot) {
    if(session.uncertain)invalid(`${command} actual=unconfirmed ${session.uncertain}; required=read original update state without resubmitting`);
    if (mutation) invalid(`${command} actual=another mutation pending; required=no pending mutation`);
    mutation = true;
    publish({busy:true,error:null});
    const baseline=latest;
    const epoch = ++generation;
    try {const next=await request(command, args, epoch, expected);publish({error:null,uncertain:null});return next;}
    catch(cause){
      const failure=normalizeFailure(cause,command),unsent=requestNotSent(failure);
      const definite=unsent||typeof cause==='object'&&cause!==null&&nativeRejections.has(cause)&&failure.code.startsWith('UPDATE_');
      uncertainBase=definite?undefined:baseline;
      if(unsent&&command==='update_install'){const key=session.attemptedInstall;if(key)installations.delete(key);publish({attemptedInstall:null});}
      publish({error:failure,uncertain:definite?null:command.slice(7) as 'check'|'download'|'install'});throw cause;
    }
    finally {mutation = false;publish({busy:false});}
  }
  return {
    getSession:()=>session,
    subscribe(listener){listeners.add(listener);return()=>{listeners.delete(listener);};},
    async snapshot(){
      try{
        const next=await request('update_snapshot',undefined,generation);
        const newer=next.revision>(uncertainBase?.revision??-1);
        const sameOperation=next.operation_id===uncertainBase?.operation_id&&next.target_version===uncertainBase?.target_version;
        const resolved=session.uncertain==='check'?newer&&next.operation_id!==null&&next.operation_id!==uncertainBase?.operation_id:session.uncertain==='download'?newer&&sameOperation&&['downloading','verified','failed'].includes(next.state):newer&&sameOperation&&['stopping','installing','failed'].includes(next.state);
        const unresolved=session.uncertain&&!resolved;
        publish(unresolved?{}:{error:null,uncertain:null});return next;
      }catch(cause){if(!(cause instanceof UpdateResultSupersededError)&&!session.uncertain)publish({error:normalizeFailure(cause,'update_snapshot')});throw cause;}
    },
    async check() {
      if (latest && activeStates.includes(latest.state)) invalid(`update_check actual_state=${latest.state}; required=idle|current|available|verified|failed`);
      return mutate('update_check');
    },
    async download() {
      if (!latest || latest.state !== 'available' || !latest.operation_id || !latest.target_version) invalid(`update_download actual_state=${latest?.state ?? 'unobserved'}; required=available with operation_id and target_version`);
      return mutate('update_download', undefined, latest);
    },
    async install(input) {
      if(session.uncertain||mutation)invalid('update_install requires no unconfirmed or pending update request');
      const o = exact(input, ['operation_id','expected_revision','confirmed'], 'update_install.request');
      text(o.operation_id, 'update_install.request.operation_id'); integer(o.expected_revision, 'update_install.request.expected_revision');
      if (o.confirmed !== true) invalid(`update_install.confirmed actual=${actual(o.confirmed)}; required=true from explicit user confirmation`);
      if (!latest || latest.state !== 'verified') invalid(`update_install actual_state=${latest?.state ?? 'unobserved'}; required=verified`);
      if (o.operation_id !== latest.operation_id) invalid(`update_install.operation_id actual=${o.operation_id}; required=verified operation_id=${latest.operation_id}`);
      if (o.expected_revision !== latest.revision) invalid(`update_install.expected_revision actual=${o.expected_revision}; required=verified revision=${latest.revision}`);
      const key = `${o.operation_id}:${o.expected_revision}`;
      if (installations.has(key)) invalid(`update_install actual=already attempted operation_id=${o.operation_id} revision=${o.expected_revision}; required=fresh verified receipt`);
      installations.add(key);
      publish({attemptedInstall:key});
      return mutate('update_install', {request:{operation_id:o.operation_id, expected_revision:o.expected_revision, confirmed:true}}, latest);
    },
  };
}
