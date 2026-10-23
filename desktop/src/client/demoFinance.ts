import type {
  DesktopCommand,
  DesktopSnapshot,
  Finance,
  FinanceIdentity,
  OperationResult,
  TransferRecord,
} from './types';
import {
  amountUnits,
  decimalUnits,
  validAmount,
  validFactor,
} from '../features/earnings/money';

export function initialFinance(
  hive = 'Hive 演示连接',
  user = 'demo-user',
  empty = false,
): Finance {
  return {
    identity: { hive, user },
    buyerBalance: '24.6',
    quote: { mode: 'default', factor: '0.1', version: 1 },
    acceptedQuote: { mode: 'default', factor: '0.1', version: 1 },
    transfers: [],
    settlements: empty
      ? []
      : [
          {
            id: 'ST-1022-01',
            date: '10-22 14:32',
            platform: 'openai',
            amount: '12.4',
            daysAgo: 0,
          },
          {
            id: 'ST-1021-02',
            date: '10-21 21:18',
            platform: 'claude',
            amount: '14.39',
            daysAgo: 1,
          },
          {
            id: 'ST-1020-03',
            date: '10-20 18:06',
            platform: 'openai',
            amount: '27.6',
            daysAgo: 2,
          },
          {
            id: 'ST-1019-04',
            date: '10-19 16:25',
            platform: 'claude',
            amount: '8.43',
            daysAgo: 3,
          },
          {
            id: 'ST-1008-05',
            date: '10-08 11:20',
            platform: 'openai',
            amount: '200',
            daysAgo: 14,
          },
          {
            id: 'ST-1001-06',
            date: '10-01 09:00',
            platform: 'claude',
            amount: '119.32',
            daysAgo: 21,
          },
        ],
  };
}
/** Session-only demo namespace. This is deliberately not a real wallet/persistence adapter. */
export function demoFinance(scene: string, storage?: Storage) {
  const key = (id: FinanceIdentity) =>
    `bee.demo.finance.v1.${encodeURIComponent(scene)}.${encodeURIComponent(id.hive)}.${encodeURIComponent(id.user)}`;
  const ready = <T>(value: T) => ({
    status: 'ready' as const,
    value,
    updatedAt: new Date().toISOString(),
  });
  const fail = (code: string, message: string): OperationResult => ({
    kind: 'failed',
    error: { code, message },
  });
  let conflictInjected = false;
  const outcome = (record: TransferRecord): OperationResult =>
    record.status === 'confirmed'
      ? {
          kind: 'confirmed',
          demo: true,
          message: `仅演示：演示划转已完成，${record.amount} 已转入同账号买家余额；流水 ${record.id}。`,
        }
      : {
          kind: record.status,
          operationId: record.requestId,
          message: `仅演示：划转${record.status === 'pending' ? '处理中' : '结果未确认'}，原 requestId=${record.requestId}；只能核对原操作。`,
        };
  return {
    restore(state: DesktopSnapshot) {
      if (!storage || state.finance.status !== 'ready') return;
      try {
        const raw = storage.getItem(key(state.finance.value.identity));
        if (!raw) return;
        const saved = JSON.parse(raw) as { finance: Finance; balance: string };
        const f = saved.finance,
          id = state.finance.value.identity;
        // Reject foreign/corrupted session records instead of inferring a zero or a success.
        if (f.identity.hive !== id.hive)
          throw new Error('identity.hive 匹配失败：matches=false');
        if (f.identity.user !== id.user)
          throw new Error('identity.user 匹配失败：matches=false');
        for (const name of ['quote', 'acceptedQuote'] as const) {
          const q = f[name];
          if (!q) throw new Error(`${name} 字段缺失：actual=missing`);
          if (!['default', 'custom'].includes(q.mode))
            throw new Error(`${name}.mode 无效：actual=${q.mode}`);
          if (!validFactor(q.factor))
            throw new Error(
              `${name}.factor 无效：actual=${q.factor}；要求0<factor<10且最多9位小数`,
            );
          if (!Number.isSafeInteger(q.version) || q.version < 1)
            throw new Error(
              `${name}.version 无效：actual=${q.version}；要求正安全整数`,
            );
        }
        if (!Array.isArray(f.transfers))
          throw new Error(
            `transfers 类型无效：actual=${typeof f.transfers}；要求array`,
          );
        if (!Array.isArray(f.settlements))
          throw new Error(
            `settlements 类型无效：actual=${typeof f.settlements}；要求array`,
          );
        if (f.quoteUnknown !== undefined && typeof f.quoteUnknown !== 'boolean')
          throw new Error(
            `quoteUnknown 类型无效：actual=${typeof f.quoteUnknown}；要求boolean`,
          );
        for (const row of f.settlements) {
          if (!['openai', 'claude'].includes(row.platform))
            throw new Error(`settlement.platform 无效：actual=${row.platform}`);
          if (typeof row.id !== 'string')
            throw new Error(`settlement.id 类型无效：actual=${typeof row.id}`);
          if (typeof row.date !== 'string')
            throw new Error(
              `settlement.date 类型无效：actual=${typeof row.date}`,
            );
          if (!Number.isSafeInteger(row.daysAgo) || row.daysAgo < 0)
            throw new Error(
              `settlement.daysAgo 无效：actual=${row.daysAgo}；要求非负安全整数`,
            );
          if (!validAmount(row.amount))
            throw new Error(
              `settlement.amount 无效：actual=${row.amount}；要求15/9位正金额`,
            );
        }
        const uniqueIds = new Set(f.transfers.map((r) => r.requestId)).size;
        if (uniqueIds !== f.transfers.length)
          throw new Error(
            `requestId 重复：unique=${uniqueIds}，records=${f.transfers.length}`,
          );
        amountUnits(saved.balance);
        amountUnits(f.buyerBalance);
        for (const r of f.transfers) {
          if (r.hive !== id.hive)
            throw new Error(
              `transfer.hive 匹配失败：requestId=${r.requestId}，matches=false`,
            );
          if (r.user !== id.user)
            throw new Error(
              `transfer.user 匹配失败：requestId=${r.requestId}，matches=false`,
            );
          if (typeof r.requestId !== 'string' || !r.requestId)
            throw new Error(
              `transfer.requestId 无效：type=${typeof r.requestId}，present=${!!r.requestId}`,
            );
          if (!validAmount(r.amount))
            throw new Error(
              `transfer.amount 无效：actual=${r.amount}；要求15/9位正金额`,
            );
          if (!['pending', 'unknown', 'confirmed'].includes(r.status))
            throw new Error(`transfer.status 无效：actual=${r.status}`);
          if (typeof r.id !== 'string' || typeof r.date !== 'string')
            throw new Error(
              `transfer 显示字段无效：idType=${typeof r.id}，dateType=${typeof r.date}；要求string`,
            );
        }
        const unresolved = f.transfers.filter((r) => r.status !== 'confirmed');
        if (unresolved.length > 1)
          throw new Error(
            `未确认划转数量无效：actual=${unresolved.length}；最多1条`,
          );
        if (!!f.pendingTransfer !== (unresolved.length === 1))
          throw new Error(
            `pendingTransfer 缺失状态冲突：present=${!!f.pendingTransfer}，unresolved=${unresolved.length}`,
          );
        if (
          f.pendingTransfer &&
          JSON.stringify(f.pendingTransfer) !== JSON.stringify(unresolved[0])
        )
          throw new Error(
            'pendingTransfer 原操作匹配失败：matches=false；必须保留原身份、标识、金额与状态',
          );
        state.finance = ready(f);
        state.earnings = ready({
          ...state.earnings.value!,
          balance: saved.balance,
        });
      } catch (cause) {
        state.finance = {
          status: 'error',
          updatedAt: null,
          error: {
            code: 'DEMO_FINANCE_SESSION_INVALID',
            message: `演示资金会话读取失败：${String(cause)}；资金操作已阻止，请检查演示会话。`,
          },
        };
      }
    },
    handle(
      state: DesktopSnapshot,
      command: DesktopCommand,
    ): OperationResult | undefined {
      if (
        !['saveQuote', 'transferEarnings', 'checkTransfer'].includes(
          command.type,
        )
      )
        return undefined;
      if (state.finance.status !== 'ready' || state.earnings.status !== 'ready')
        return fail(
          'DEMO_FINANCE_UNAVAILABLE',
          `资金读取检查失败：finance=${state.finance.status}，earnings=${state.earnings.status}；只允许当前已确认数据。`,
        );
      if (
        state.binding.status !== 'ready' ||
        state.binding.value.state !== 'bound' ||
        !state.binding.value.loggedIn ||
        !state.binding.value.userId ||
        state.binding.value.userId !== state.finance.value.identity.user
      )
        return fail(
          'DEMO_FINANCE_IDENTITY_REQUIRED',
          `资金身份检查失败：binding=${state.binding.value?.state ?? 'unknown'}，loggedIn=${state.binding.value?.loggedIn ?? false}，userIdPresent=${!!state.binding.value?.userId}，userMatches=${state.binding.value?.userId === state.finance.value.identity.user}。`,
        );
      const f = structuredClone(state.finance.value);
      let balance = state.earnings.value.balance;
      let result: OperationResult;
      if (command.type === 'saveQuote') {
        if (f.quoteUnknown)
          return fail(
            'DEMO_QUOTE_UNKNOWN',
            '报价结果未确认：原保存操作尚未核实；不允许覆盖保存。',
          );
        if (command.originalVersion !== f.quote.version)
          return fail(
            'DEMO_QUOTE_CONFLICT',
            `报价版本冲突：原版本=${command.originalVersion}，当前版本=${f.quote.version}；草稿未生效，请重新读取。`,
          );
        if (scene === 'quote-conflict' && !conflictInjected) {
          conflictInjected = true;
          state.finance = ready({
            ...f,
            quote: { ...f.quote, version: f.quote.version + 1 },
          });
          return fail(
            'DEMO_QUOTE_CONFLICT',
            `报价版本冲突：原版本=${command.originalVersion}，当前版本=${f.quote.version + 1}；演示另一端已更新，草稿未生效，请重新读取。`,
          );
        }
        if (command.mode !== 'default' && command.mode !== 'custom')
          return fail(
            'DEMO_QUOTE_MODE',
            `报价模式检查失败：mode=${command.mode}。`,
          );
        if (command.mode === 'custom' && !validFactor(command.factor))
          return fail(
            'DEMO_QUOTE_FACTOR',
            `报价系数“${command.factor}”无效；要求大于0、小于10、最多9位小数。`,
          );
        if (scene === 'quote-unknown') {
          f.quoteUnknown = true;
          result = {
            kind: 'unknown',
            operationId: `demo-quote-${f.quote.version}`,
            message:
              '仅演示：报价结果未确认，草稿未标记为已生效；请核实原保存结果。',
          };
        } else {
          f.quote = {
            mode: command.mode,
            factor: command.mode === 'default' ? '0.1' : command.factor,
            version: f.quote.version + 1,
          };
          result = {
            kind: 'confirmed',
            demo: true,
            message: '仅演示：报价已保存，仅对后续接收任务生效。',
          };
        }
      } else if (
        command.type === 'transferEarnings' ||
        command.type === 'checkTransfer'
      ) {
        if (
          command.hive !== f.identity.hive ||
          command.user !== f.identity.user
        )
          return fail(
            'DEMO_TRANSFER_IDENTITY',
            `划转身份检查失败：Hive匹配=${command.hive === f.identity.hive}，用户匹配=${command.user === f.identity.user}；禁止跨身份重放。`,
          );
        if (!command.requestId || !validAmount(command.amount))
          return fail(
            'DEMO_TRANSFER_INPUT',
            `划转输入检查失败：requestId=${command.requestId || 'missing'}，amount=${command.amount}；金额必须为正且满足15/9位规则。`,
          );
        const prior = f.transfers.find(
          (t) => t.requestId === command.requestId,
        );
        if (prior) {
          if (prior.amount !== command.amount)
            return fail(
              'DEMO_TRANSFER_CONFLICT',
              `划转参数冲突：requestId=${command.requestId}，原金额=${prior.amount}，实际金额=${command.amount}；原记录保留。`,
            );
          return outcome(prior);
        }
        if (command.type === 'checkTransfer')
          return fail(
            'DEMO_TRANSFER_NOT_FOUND',
            `原划转核对失败：requestId=${command.requestId}，record=missing；未创建新操作。`,
          );
        if (f.pendingTransfer)
          return fail(
            'DEMO_TRANSFER_UNRESOLVED',
            `划转尚未确认：原requestId=${f.pendingTransfer.requestId}，status=${f.pendingTransfer.status}；禁止新操作。`,
          );
        if (amountUnits(command.amount) > amountUnits(balance))
          return fail(
            'DEMO_TRANSFER_BALANCE',
            `划转金额 ${command.amount} 超过可用收益 ${balance}；未扣款。`,
          );
        const record: TransferRecord = {
          hive: command.hive,
          user: command.user,
          requestId: command.requestId,
          amount: command.amount,
          id: `DEMO-TR-${f.transfers.length + 1}`,
          date: new Date().toISOString(),
          status:
            scene === 'transfer-pending'
              ? 'pending'
              : scene === 'transfer-unknown'
                ? 'unknown'
                : 'confirmed',
        };
        f.transfers.unshift(record);
        if (record.status === 'confirmed') {
          balance = decimalUnits(
            amountUnits(balance) - amountUnits(record.amount),
          );
          f.buyerBalance = decimalUnits(
            amountUnits(f.buyerBalance) + amountUnits(record.amount),
          );
        } else f.pendingTransfer = record;
        result = outcome(record);
      } else return undefined;
      try {
        storage?.setItem(
          key(f.identity),
          JSON.stringify({ finance: f, balance }),
        );
      } catch (cause) {
        return fail(
          'DEMO_FINANCE_SESSION_WRITE',
          `演示资金会话保存失败：${String(cause)}；未更新余额或操作状态。`,
        );
      }
      state.finance = ready(f);
      if (balance !== state.earnings.value.balance)
        state.earnings = ready({ ...state.earnings.value, balance });
      return result;
    },
  };
}
