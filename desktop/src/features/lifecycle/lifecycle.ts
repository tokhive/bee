import type { OperationResult, ReadState, TaskState } from '../../client/types';
export type LifecyclePurpose = 'exit' | 'update';
export type LifecycleAction = 'wait' | 'check' | 'finish' | 'cancel';
export interface LifecycleState {
  status: 'idle' | 'checking' | 'waiting' | 'unknown' | 'failed' | 'finished';
  id: number;
  purpose: LifecyclePurpose;
  tasks: TaskState;
  pending: boolean;
  stopped: boolean;
  message: string;
}
export const initialLifecycle: LifecycleState = { status: 'idle', id: 0, purpose: 'exit', tasks: { kind: 'unknown' }, pending: false, stopped: false, message: '' };
export function currentTasks(read: ReadState<TaskState>): TaskState {
  return read.status === 'ready' && read.value.kind === 'known' && Number.isSafeInteger(read.value.count) && read.value.count >= 0 ? read.value : { kind: 'unknown' };
}
export type LifecycleEvent =
  | { type: 'start'; id: number; purpose: LifecyclePurpose; tasks: ReadState<TaskState> }
  | { type: 'pending'; id: number }
  | { type: 'result'; id: number; action: LifecycleAction; immediate?: boolean; result: OperationResult; tasks: ReadState<TaskState> };
/** Pure presentation state; only an explicitly confirmed demo receipt can finish. */
export function reduceLifecycle(state: LifecycleState, event: LifecycleEvent): LifecycleState {
  if (event.type === 'start') {
    const tasks = currentTasks(event.tasks);
    return { ...initialLifecycle, id: event.id, purpose: event.purpose, tasks, status: tasks.kind === 'unknown' ? 'unknown' : 'checking' };
  }
  if (event.id !== state.id) return state;
  if (event.type === 'pending') return { ...state, pending: true };
  const { result, action } = event;
  if (result.kind !== 'confirmed' || !result.demo) {
    return { ...state, pending: false, status: result.kind === 'failed' || result.kind === 'unsupported' ? 'failed' : 'unknown', message: result.kind === 'failed' ? `${result.error.code}: ${result.error.message}` : result.message };
  }
  if (action === 'cancel') return { ...initialLifecycle, id: state.id, purpose: state.purpose };
  if (action === 'finish') {
    const tasks = currentTasks(event.tasks);
    if (tasks.kind === 'unknown' || (!event.immediate && tasks.count !== 0) || (event.immediate && tasks.count <= 0))
      return { ...state, tasks, status: 'unknown', pending: false, message: '任务状态尚未确认' };
    return { ...state, tasks, status: 'finished', pending: false, stopped: true, message: result.message };
  }
  const tasks = currentTasks(event.tasks);
  return { ...state, tasks, stopped: state.stopped || action === 'wait', pending: false, message: '', status: tasks.kind === 'unknown' ? 'unknown' : action === 'wait' || state.stopped ? 'waiting' : 'checking' };
}
