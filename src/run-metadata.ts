import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';

const COUNTERS = ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const;
export type DingtalkRunUsage = Partial<Record<typeof COUNTERS[number], number>>;
export type DingtalkRunUsageKey = { accountId: string; sessionKey: string; runId: string };
type UsageEvent = { runId: string; usage?: DingtalkRunUsage };
type UsageContext = { channel?: string; accountId?: string; sessionKey?: string; runId?: string };

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 2048;
}

function key(scope: DingtalkRunUsageKey): string | undefined {
  return validId(scope.accountId) && validId(scope.sessionKey) && validId(scope.runId)
    ? JSON.stringify([scope.accountId, scope.sessionKey, scope.runId]) : undefined;
}

/** 只记录公开 llm_output 的用量计数，不保存 prompt、assistantTexts 或凭据。 */
export class DingtalkRunMetadataStore {
  private readonly records = new Map<string, { usage: DingtalkRunUsage; expiresAt: number }>();
  constructor(private readonly options: { now?: () => number; ttlMs?: number; maxRecords?: number } = {}) {}

  private prune(): void {
    const now = this.options.now?.() ?? Date.now();
    for (const [id, record] of this.records) if (record.expiresAt <= now) this.records.delete(id);
  }

  record(event: UsageEvent, context: UsageContext): void {
    if (context.channel !== 'dingtalk-connector' || !context.accountId || !context.sessionKey
      || (context.runId && context.runId !== event.runId) || !event.usage) return;
    const id = key({ accountId: context.accountId, sessionKey: context.sessionKey, runId: event.runId });
    if (!id) return;
    const accepted: DingtalkRunUsage = {};
    for (const name of COUNTERS) {
      const value = event.usage[name];
      if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) accepted[name] = value;
    }
    if (!Object.keys(accepted).length) return;
    this.prune();
    const existing = this.records.get(id);
    const usage = { ...existing?.usage };
    // 每个 llm_output 是一次模型尝试的用量；工具循环/重试共用 runId 时按真实事件累加。
    for (const name of COUNTERS) {
      if (accepted[name] === undefined) continue;
      const sum = (usage[name] ?? 0) + accepted[name];
      if (Number.isSafeInteger(sum)) usage[name] = sum;
    }
    const maximum = Math.max(1, Math.min(1000, this.options.maxRecords ?? 1000));
    this.records.delete(id);
    while (this.records.size >= maximum) this.records.delete(this.records.keys().next().value!);
    this.records.set(id, {
      usage,
      expiresAt: (this.options.now?.() ?? Date.now()) + Math.max(1, Math.min(30 * 60_000, this.options.ttlMs ?? 10 * 60_000)),
    });
  }

  get(scope: DingtalkRunUsageKey): DingtalkRunUsage | undefined {
    this.prune();
    const id = key(scope);
    const record = id ? this.records.get(id) : undefined;
    return record ? { ...record.usage } : undefined;
  }
}

const store = new DingtalkRunMetadataStore();
const registered = new WeakSet<object>();

export function registerDingtalkRunMetadata(api: OpenClawPluginApi): void {
  if (registered.has(api) || typeof api.on !== 'function') return;
  registered.add(api);
  api.on('llm_output', (event, context) => { store.record(event, context); });
}

export function getDingtalkRunUsage(scope: DingtalkRunUsageKey): DingtalkRunUsage | undefined {
  return store.get(scope);
}
