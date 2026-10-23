import { useState } from 'react';
import type {
  FinanceIdentity,
  OperationResult,
  TransferInput,
} from '../../client/types';
import { debugToolsEnabled } from '../../client/scenes';
import { validAmount } from './money';

type IntentState = { intent?: TransferInput; error?: string };
const sameOperation = (a: TransferInput, b: TransferInput) =>
  a.hive === b.hive &&
  a.user === b.user &&
  a.requestId === b.requestId &&
  a.amount === b.amount;
/** P1 browser demo guard only; never a real wallet or cross-process recovery guarantee. */
export function createTransferIntentStore(
  identity: FinanceIdentity,
  storage: Storage,
  scene: string,
) {
  const key = `bee.demo.transfer-intent.v1.${encodeURIComponent(scene)}.${encodeURIComponent(identity.hive)}.${encodeURIComponent(identity.user)}`;
  function validate(value: TransferInput): TransferInput {
    if (value.hive !== identity.hive)
      throw new Error('划转意图 Hive 检查失败：matches=false；保留原记录');
    if (value.user !== identity.user)
      throw new Error('划转意图用户检查失败：matches=false；保留原记录');
    if (typeof value.requestId !== 'string' || !value.requestId)
      throw new Error(
        `划转意图标识检查失败：requestIdType=${typeof value.requestId}，present=${!!value.requestId}`,
      );
    if (typeof value.amount !== 'string' || !validAmount(value.amount))
      throw new Error(
        `划转意图金额检查失败：actual=${value.amount}；要求15/9位正金额`,
      );
    return {
      hive: value.hive,
      user: value.user,
      requestId: value.requestId,
      amount: value.amount,
    };
  }
  return {
    read(): TransferInput | undefined {
      const raw = storage.getItem(key);
      return raw === null ? undefined : validate(JSON.parse(raw));
    },
    begin(operation: TransferInput) {
      const op = validate(operation);
      const prior = this.read();
      if (prior && !sameOperation(prior, op))
        throw new Error(
          `划转意图已有未确认操作：原requestId=${prior.requestId}，实际requestId=${op.requestId}；禁止新操作`,
        );
      storage.setItem(key, JSON.stringify(op));
      return op;
    },
    settle(
      operation: TransferInput,
      result: OperationResult,
      phase: 'submit' | 'check',
    ) {
      const prior = this.read();
      if (!prior || !sameOperation(prior, operation))
        throw new Error(
          `划转意图核对失败：requestId=${operation.requestId}，originalMatches=false；不得清除原守门`,
        );
      // Only these synchronous demoFinance failures prove no financial state was committed.
      // A check failure, not-found, unknown, generic failed, or rejected Promise never clears intent.
      const definitelyUnaccepted =
        phase === 'submit' &&
        result.kind === 'failed' &&
        [
          'DEMO_TRANSFER_INPUT',
          'DEMO_TRANSFER_BALANCE',
          'DEMO_TRANSFER_TARGET_LIMIT',
          'DEMO_FINANCE_SESSION_WRITE',
        ].includes(result.error.code);
      if (
        (result.kind === 'confirmed' && result.demo) ||
        definitelyUnaccepted
      ) {
        storage.removeItem(key);
        return undefined;
      }
      return prior;
    },
  };
}
export function useTransferIntent(identity: FinanceIdentity) {
  const [store] = useState(() => {
    try {
      const scene = debugToolsEnabled
        ? new URLSearchParams(location.search).get('scene') || 'ready'
        : 'ready';
      return {
        value: createTransferIntentStore(identity, sessionStorage, scene),
      };
    } catch (cause) {
      return { error: `演示划转意图存储不可用：${String(cause)}；禁止新划转` };
    }
  });
  const [state, setState] = useState<IntentState>(() => {
    if (!store.value) return { error: store.error };
    try {
      return { intent: store.value.read() };
    } catch (cause) {
      return {
        error: `演示划转意图读取失败：${String(cause)}；原操作未解除，禁止新划转`,
      };
    }
  });
  function begin(operation: TransferInput) {
    if (!store.value || state.error) return false;
    try {
      setState({ intent: store.value.begin(operation) });
      return true;
    } catch (cause) {
      setState((previous) => ({
        ...previous,
        error: `演示划转意图保存失败：${String(cause)}；未发送新操作`,
      }));
      return false;
    }
  }
  function settle(
    operation: TransferInput,
    result: OperationResult,
    phase: 'submit' | 'check',
  ) {
    if (!store.value) return;
    try {
      setState({ intent: store.value.settle(operation, result, phase) });
    } catch (cause) {
      setState((previous) => ({
        ...previous,
        error: `演示划转意图确认失败：${String(cause)}；原守门保留`,
      }));
    }
  }
  return { ...state, begin, settle };
}
