import { afterEach, describe, expect, it, vi } from 'vitest';
import { dispatchReplyWithBufferedBlockDispatcher, type MsgContext } from 'openclaw/plugin-sdk/reply-runtime';
import { initializeGlobalHookRunner, resetGlobalHookRunner } from 'openclaw/plugin-sdk/hook-runtime';
import { dispatchDingtalkBtw, type DingtalkBtwDispatchParams } from '../../src/core/btw-dispatch.ts';

const cfg = { plugins: { enabled: false } };
const ctx = (): MsgContext => ({
  Body: '/btw 本地问题', BodyForAgent: '/btw 本地问题', CommandBody: '/btw 本地问题',
  From: 'local-user', To: 'local-group', SenderId: 'local-user',
  SessionKey: 'agent:main:dingtalk-connector:group:btw-test', AccountId: 'local-bot',
  Provider: 'dingtalk-connector', Surface: 'dingtalk-connector', ChatType: 'group',
  OriginatingChannel: 'dingtalk-connector', OriginatingTo: 'local-group', CommandAuthorized: true,
});
const result = { queuedFinal: true, counts: { tool: 0, block: 0, final: 1 } };
const dispatchFinal: DingtalkBtwDispatchParams['dispatchReplyFromConfig'] = async ({ dispatcher }) => {
  dispatcher.sendFinalReply({ text: '旁路回答', btw: { question: '本地问题' } });
  return result;
};

afterEach(() => resetGlobalHookRunner());

describe('/btw 真实 SDK 独立交付', () => {
  it('主 buffered 前台租约未释放时旁路已经交付；主 signal 不被取消', async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => { release = done; });
    let entered!: () => void;
    const ready = new Promise<void>((done) => { entered = done; });
    const mainDeliver = vi.fn();
    const sideDeliver = vi.fn();
    const controller = new AbortController();
    let mainDone = false;
    const main = dispatchReplyWithBufferedBlockDispatcher({
      ctx: { ...ctx(), Body: '主任务', CommandBody: '主任务' }, cfg,
      dispatcherOptions: { deliver: mainDeliver }, replyOptions: { abortSignal: controller.signal },
      dispatchReplyFromConfig: async ({ dispatcher }) => {
        entered();
        await gate;
        dispatcher.sendFinalReply({ text: '主任务完成' });
        return result;
      },
    }).then(() => { mainDone = true; });
    try {
      await ready;
      const lowLevel = vi.fn(dispatchFinal);
      const side = dispatchDingtalkBtw({ ctx: ctx(), cfg, dispatcherOptions: { deliver: sideDeliver }, dispatchReplyFromConfig: lowLevel });
      // 这条断言在使用 buffered 入口的旧实现上超时：旁路已排入队列却等待主租约。
      await vi.waitFor(() => expect(sideDeliver).toHaveBeenCalledTimes(1), { timeout: 1000 });
      await side;
      expect(mainDone).toBe(false);
      expect(controller.signal.aborted).toBe(false);
      expect(mainDeliver).not.toHaveBeenCalled();
      expect(lowLevel).toHaveBeenCalledTimes(1);
      expect(lowLevel.mock.calls[0][0].ctx.SessionKey).toBe(ctx().SessionKey);
    } finally { release(); await main; }
  });

  it.each(['cancel', 'rewrite'] as const)('按 payload→legacy 顺序保留宿主发送策略：%s', async (mode) => {
    const order: string[] = [];
    const legacy = vi.fn((event) => {
      order.push(`legacy:${event.content}`);
      return mode === 'cancel' ? { cancel: true } : { content: '策略改写后的回答' };
    });
    initializeGlobalHookRunner({
      hooks: [], plugins: [{ id: 'local-probe', status: 'loaded' }],
      typedHooks: [
        { pluginId: 'local-probe', source: 'local-test', hookName: 'reply_payload_sending', handler: (event: any) => {
          order.push('payload');
          return { payload: { ...event.payload, text: 'payload 修改' } };
        } },
        { pluginId: 'local-probe', source: 'local-test', hookName: 'message_sending', handler: legacy },
      ],
    });
    const deliver = vi.fn();
    const outcome = await dispatchDingtalkBtw({ ctx: ctx(), cfg, dispatcherOptions: { deliver }, dispatchReplyFromConfig: dispatchFinal });
    expect(order).toEqual(['payload', 'legacy:payload 修改']);
    expect(legacy.mock.calls[0][1]).toMatchObject({ channelId: 'dingtalk-connector', accountId: 'local-bot' });
    if (mode === 'cancel') {
      expect(deliver).not.toHaveBeenCalled();
      expect(outcome.settledReceipt?.anyVisibleDelivered).toBe(false);
    } else {
      expect(deliver.mock.calls[0][0]).toMatchObject({ text: '策略改写后的回答', btw: { question: '本地问题' } });
      expect(outcome.settledReceipt?.anyVisibleDelivered).toBe(true);
    }
  });

  it('低层抛错仍完成交付清理，并允许同会话下一次旁路正常回复', async () => {
    const deliver = vi.fn();
    await expect(dispatchDingtalkBtw({ ctx: ctx(), cfg, dispatcherOptions: { deliver },
      dispatchReplyFromConfig: async () => { throw new Error('local failure'); },
    })).rejects.toThrow('local failure');
    await dispatchDingtalkBtw({ ctx: ctx(), cfg, dispatcherOptions: { deliver }, dispatchReplyFromConfig: dispatchFinal });
    expect(deliver).toHaveBeenCalledTimes(1);
  });
});
