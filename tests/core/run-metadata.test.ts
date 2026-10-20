import { describe, expect, it, vi } from 'vitest';
import { DingtalkRunMetadataStore, getDingtalkRunUsage, registerDingtalkRunMetadata } from '../../src/run-metadata.ts';

const scope = { accountId: 'Bot-A', sessionKey: 'agent:main:group-a', runId: 'run-a' };
const context = { ...scope, channel: 'dingtalk-connector' };

describe('宿主用量元数据', () => {
  it.each(['default', ' Default ', '__default__'])('默认账号别名 %s 与规范账号共享真实用量', (accountId) => {
    const store = new DingtalkRunMetadataStore();
    store.record({ runId: scope.runId, usage: { output: 3 } }, { ...context, accountId });
    expect(store.get({ ...scope, accountId: '__default__' })).toEqual({ output: 3 });
    expect(store.get({ ...scope, accountId: 'default' })).toEqual({ output: 3 });
    expect(store.get({ ...scope, accountId: 'Bot-A' })).toBeUndefined();
  });

  it('累加同一次运行的实际模型尝试用量，未知计数不伪造零', () => {
    const store = new DingtalkRunMetadataStore();
    store.record({ runId: scope.runId, usage: { input: 10, output: 3, cacheRead: 5, total: 18 } }, context);
    store.record({ runId: scope.runId, usage: { input: 20, output: 4, total: 24 } }, context);
    expect(store.get(scope)).toEqual({ input: 30, output: 7, cacheRead: 5, total: 42 });
    expect(store.get(scope)?.cacheWrite).toBeUndefined();
  });

  it('隔离账号、会话、真实运行ID，保持账号大小写', () => {
    const store = new DingtalkRunMetadataStore();
    store.record({ runId: scope.runId, usage: { output: 3 } }, context);
    expect(store.get({ ...scope, accountId: 'bot-a' })).toBeUndefined();
    expect(store.get({ ...scope, sessionKey: 'other' })).toBeUndefined();
    expect(store.get({ ...scope, runId: 'other' })).toBeUndefined();
  });

  it.each([
    { ...context, channel: 'slack' }, { ...context, channel: undefined },
    { ...context, accountId: undefined }, { ...context, sessionKey: undefined }, { ...context, runId: 'mismatch' },
  ])('缺失可信绑定或非钉钉事件不会进入存储：%j', (hookContext) => {
    const store = new DingtalkRunMetadataStore();
    store.record({ runId: scope.runId, usage: { input: 123 } }, hookContext);
    expect(store.get(scope)).toBeUndefined();
  });

  it('丢弃负数、非整数、Infinity、NaN，忽略所有正文和未知字段', () => {
    const store = new DingtalkRunMetadataStore();
    store.record({ runId: scope.runId, usage: { input: -1, output: Infinity, cacheRead: NaN, cacheWrite: 1.5 } }, context);
    expect(store.get(scope)).toBeUndefined();
    store.record({ runId: scope.runId, usage: { input: 0, output: 9, prompt: 'secret', assistantTexts: ['secret'] } } as any, context);
    expect(store.get(scope)).toEqual({ input: 0, output: 9 });
    const read = store.get(scope)!;
    read.input = 100;
    expect(store.get(scope)?.input).toBe(0);
  });

  it('TTL 到期清理，容量限制淘汰较旧运行', () => {
    let now = 1000;
    const store = new DingtalkRunMetadataStore({ now: () => now, ttlMs: 100, maxRecords: 2 });
    store.record({ runId: 'run-a', usage: { output: 1 } }, context);
    store.record({ runId: 'run-b', usage: { output: 2 } }, { ...context, runId: 'run-b' });
    store.record({ runId: 'run-c', usage: { output: 3 } }, { ...context, runId: 'run-c' });
    expect(store.get(scope)).toBeUndefined();
    expect(store.get({ ...scope, runId: 'run-b' })).toEqual({ output: 2 });
    now += 101;
    expect(store.get({ ...scope, runId: 'run-b' })).toBeUndefined();
    expect(store.get({ ...scope, runId: 'run-c' })).toBeUndefined();
  });

  it('通过公开 llm_output hook 接入，同一个 API 注册对象不重复订阅', () => {
    const on = vi.fn();
    const api = { on } as any;
    registerDingtalkRunMetadata(api);
    registerDingtalkRunMetadata(api);
    expect(on).toHaveBeenCalledOnce();
    expect(on.mock.calls[0][0]).toBe('llm_output');
    on.mock.calls[0][1]({ runId: scope.runId, usage: { input: 12, output: 8 } }, context);
    expect(getDingtalkRunUsage(scope)).toEqual({ input: 12, output: 8 });
  });
});
