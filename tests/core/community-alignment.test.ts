import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  dispatch: vi.fn(), lowLevelDispatch: vi.fn(), createDispatcher: vi.fn(), stopDispatcher: vi.fn(),
  workspace: vi.fn((_cfg: unknown, agentId: string) => `/workspaces/${agentId}`),
  send: vi.fn(), recall: vi.fn(), accessToken: vi.fn(), oapiToken: vi.fn(), httpPost: vi.fn(), invalidate: vi.fn(),
  withQuestion: vi.fn(), questionContexts: [] as any[],
  store: undefined as any,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/utils/utils-legacy.ts', async () => ({
  ...(await import('../../src/utils/session.ts')),
  getAccessToken: state.accessToken, getOapiAccessToken: state.oapiToken,
  DINGTALK_API: 'https://api.dingtalk.com', DINGTALK_OAPI: 'https://oapi.dingtalk.com',
  addEmotionReply: vi.fn(async () => undefined), recallEmotionReply: state.recall,
}));
vi.mock('../../src/utils/index.ts', () => ({ createLoggerFromConfig: () => state.log }));
vi.mock('../../src/utils/http-client.ts', () => ({ dingtalkHttp: { post: state.httpPost } }));
vi.mock('../../src/services/media/index.ts', () => ({}));
vi.mock('../../src/services/messaging/index.ts', () => ({ sendProactive: state.send }));
vi.mock('../../src/game-xiyou/index.ts', () => ({ isGamificationCommand: () => false }));
vi.mock('../../src/reply-dispatcher.ts', () => ({
  createDingtalkReplyDispatcher: state.createDispatcher, stopDingtalkReplyDispatchers: state.stopDispatcher,
}));
vi.mock('../../src/message-context.ts', () => ({ getMessageContextStore: () => state.store }));
vi.mock('../../src/questions/index.ts', () => ({
  invalidatePendingQuestionsForScope: state.invalidate,
  withDingtalkQuestionContext: state.withQuestion,
}));
vi.mock('../../src/runtime.ts', async () => {
  const routing = await import('openclaw/plugin-sdk/routing');
  return { getDingtalkRuntime: () => ({
    agent: { resolveAgentWorkspaceDir: state.workspace },
    channel: {
      routing,
      reply: {
        resolveEnvelopeFormatOptions: () => ({}),
        formatAgentEnvelope: ({ body }: { body: string }) => body,
        finalizeInboundContext: (context: unknown) => context,
        dispatchReplyWithBufferedBlockDispatcher: state.dispatch,
        dispatchReplyFromConfig: state.lowLevelDispatch,
      },
    },
  }) };
});

import { handleDingTalkMessage } from '../../src/core/message-handler.ts';
import { MessageContextStore } from '../../src/messages/index.ts';

type Params = Parameters<typeof handleDingTalkMessage>[0];
const dispatchResult = { queuedFinal: false, counts: { final: 0 } };
const scope = { accountId: 'TeamBot', conversationId: 'group-1' };

function message(text = '处理主任务', overrides: Partial<Params> = {}): Params {
  return {
    accountId: scope.accountId,
    config: { groupReplyMode: 'card' },
    data: {
      msgId: `message:${text}`, msgtype: 'text', text: { content: text }, conversationType: '2',
      conversationId: scope.conversationId, senderStaffId: 'user-1', senderNick: 'User',
      sessionWebhook: 'https://example.invalid/hook',
    },
    sessionWebhook: 'https://example.invalid/hook', runtime: {}, log: state.log,
    cfg: { agents: { entries: { support: {} } } },
    ...overrides,
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.store = new MessageContextStore();
  state.questionContexts.length = 0;
  state.withQuestion.mockImplementation((context: unknown, callback: () => unknown) => {
    state.questionContexts.push(context);
    return callback();
  });
  state.workspace.mockImplementation((_cfg: unknown, agentId: string) => `/workspaces/${agentId}`);
  state.dispatch.mockResolvedValue(dispatchResult);
  state.send.mockResolvedValue(undefined);
  state.recall.mockResolvedValue(undefined);
  state.oapiToken.mockResolvedValue(null);
  state.accessToken.mockResolvedValue('test-token');
  state.stopDispatcher.mockResolvedValue(undefined);
  state.invalidate.mockResolvedValue(undefined);
  state.createDispatcher.mockImplementation(() => ({
    dispatcherOptions: {}, replyOptions: {}, getAsyncModeResponse: () => '',
  }));
});

describe('真实入站控制命令边界', () => {
  it('/btw 在主派发尚未完成时立即进入宿主并直接用 Markdown 回复，不创建第二个卡片 dispatcher', async () => {
    const gate = deferred();
    let mainFinished = false;
    state.dispatch.mockImplementation(async ({ ctx, dispatcherOptions }) => {
      if (ctx.CommandBody.startsWith('/btw')) {
        await dispatcherOptions.deliver({ text: '独立快答' });
      } else {
        await gate.promise;
        mainFinished = true;
      }
      return dispatchResult;
    });
    const main = handleDingTalkMessage(message());
    try {
      await vi.waitFor(() => expect(state.dispatch).toHaveBeenCalledTimes(1));
      const side = handleDingTalkMessage(message('/btw 顺便问个问题'));
      await vi.waitFor(() => expect(state.dispatch).toHaveBeenCalledTimes(2));
      await side;
      expect(mainFinished).toBe(false);
      expect(state.createDispatcher).toHaveBeenCalledTimes(1);
      expect(state.dispatch.mock.calls[1][0]).toMatchObject({
        ctx: { CommandBody: '/btw 顺便问个问题', SessionKey: state.dispatch.mock.calls[0][0].ctx.SessionKey },
        dispatchReplyFromConfig: state.lowLevelDispatch,
      });
      expect(state.send).toHaveBeenCalledWith(expect.anything(), { openConversationId: 'group-1' }, '独立快答',
        expect.objectContaining({ msgType: 'markdown', useAICard: false }));
      expect(state.stopDispatcher).not.toHaveBeenCalled();
      // 主消息会使旧问题失效，旁路问题不能再次作废正在等待的表单。
      expect(state.invalidate).toHaveBeenCalledTimes(1);
    } finally { gate.resolve(); await main; }
  });

  it.each(['停止', 'stop', '/stop', 'esc'])('%s 同时取消本地 signal、关闭旧卡并向宿主派发 /stop，禁止迟到异步兜底', async (command) => {
    const gate = deferred();
    state.dispatch.mockImplementation(async ({ ctx, dispatcherOptions }) => {
      if (ctx.CommandBody === '/stop') await dispatcherOptions.deliver({ text: '已停止' });
      else await gate.promise;
      return dispatchResult;
    });
    const main = handleDingTalkMessage(message('长任务', { config: { asyncMode: true } }));
    try {
      await vi.waitFor(() => expect(state.dispatch).toHaveBeenCalledTimes(1));
      const first = state.dispatch.mock.calls[0][0];
      expect(first.replyOptions.abortSignal.aborted).toBe(false);
      await handleDingTalkMessage(message(command));
      expect(first.replyOptions.abortSignal.aborted).toBe(true);
      expect(state.stopDispatcher).toHaveBeenCalledWith(expect.objectContaining({
        accountId: 'TeamBot', sessionKey: first.ctx.SessionKey, runId: first.replyOptions.runId,
      }));
      expect(state.dispatch.mock.calls[1][0].ctx).toMatchObject({ CommandBody: '/stop', Body: '/stop', SessionKey: first.ctx.SessionKey });
      gate.resolve(); await main;
      expect(state.send.mock.calls.map((args) => args[2])).toEqual(['🫡 任务已接收，处理中...', '已停止']);
      expect(state.oapiToken).not.toHaveBeenCalled();
      expect(state.httpPost).not.toHaveBeenCalled();
      expect(state.recall).toHaveBeenCalledTimes(1);
    } finally { gate.resolve(); await main; }
  });

  it.each(['resolve', 'reject'] as const)('停止发生在异步结果准备期间，令牌请求 %s 后不发送迟到结果或错误通知', async (outcome) => {
    const token = deferred<null>();
    state.oapiToken.mockReturnValueOnce(token.promise);
    state.dispatch.mockImplementation(async ({ ctx, dispatcherOptions }) => {
      if (ctx.CommandBody === '/stop') await dispatcherOptions.deliver({ text: '已停止' });
      return dispatchResult;
    });
    const main = handleDingTalkMessage(message('异步任务', { config: { asyncMode: true } }));
    try {
      await vi.waitFor(() => expect(state.oapiToken).toHaveBeenCalledTimes(1));
      await handleDingTalkMessage(message('/stop'));
      if (outcome === 'resolve') token.resolve(null); else token.reject(new Error('late-token-failure'));
      await main;
      expect(state.send.mock.calls.map((args) => args[2])).toEqual(['🫡 任务已接收，处理中...', '已停止']);
      expect(state.httpPost).not.toHaveBeenCalled();
      expect(state.recall).toHaveBeenCalledTimes(1);
    } finally { token.resolve(null); await main; }
  });

  it('主派发在 stop 后抛错，不再走 webhook 错误兜底', async () => {
    const gate = deferred();
    state.dispatch.mockImplementation(async ({ ctx }) => {
      if (ctx.CommandBody !== '/stop') { await gate.promise; throw new Error('late-dispatch-error'); }
      return dispatchResult;
    });
    const main = handleDingTalkMessage(message());
    try {
      await vi.waitFor(() => expect(state.dispatch).toHaveBeenCalledTimes(1));
      await handleDingTalkMessage(message('/stop'));
      gate.resolve(); await main;
      expect(state.httpPost).not.toHaveBeenCalled();
      expect(state.send).not.toHaveBeenCalled();
      expect(state.recall).toHaveBeenCalledTimes(1);
    } finally { gate.resolve(); await main; }
  });

  it('错误兜底等待 token 时收到 stop，token 返回后也不能发送迟到 webhook', async () => {
    const token = deferred<string>();
    state.accessToken.mockReturnValueOnce(token.promise);
    state.dispatch.mockImplementation(async ({ ctx }) => {
      if (ctx.CommandBody !== '/stop') throw new Error('dispatch-error');
      return dispatchResult;
    });
    const main = handleDingTalkMessage(message('会报错的主任务'));
    try {
      await vi.waitFor(() => expect(state.accessToken).toHaveBeenCalledTimes(1));
      await handleDingTalkMessage(message('/stop'));
      token.resolve('late-token'); await main;
      expect(state.httpPost).not.toHaveBeenCalled();
      expect(state.send).not.toHaveBeenCalled();
      expect(state.recall).toHaveBeenCalledTimes(1);
    } finally { token.resolve('late-token'); await main; }
  });

  it('附件准备期间停止后，不启动生成、不发送迟到 ACK，仍执行表情清理', async () => {
    const token = deferred<string>();
    state.accessToken.mockReturnValueOnce(token.promise);
    state.httpPost.mockRejectedValueOnce(new Error('download-unavailable'));
    state.dispatch.mockImplementation(async ({ ctx, dispatcherOptions }) => {
      if (ctx.CommandBody === '/stop') await dispatcherOptions.deliver({ text: '已停止' });
      return dispatchResult;
    });
    const params = message('附件任务', { config: { asyncMode: true } });
    params.data = { ...params.data, msgtype: 'file', text: undefined, content: { fileName: 'report.txt', downloadCode: 'observed-code' } };
    const main = handleDingTalkMessage(params);
    try {
      await vi.waitFor(() => expect(state.accessToken).toHaveBeenCalledTimes(1));
      await handleDingTalkMessage(message('/stop'));
      token.resolve('late-download-token'); await main;
      expect(state.send.mock.calls.map((args) => args[2])).toEqual(['已停止']);
      expect(state.dispatch.mock.calls.map(([{ ctx }]) => ctx.CommandBody)).toEqual(['/stop']);
      expect(state.createDispatcher).not.toHaveBeenCalled();
      expect(state.recall).toHaveBeenCalledTimes(1);
    } finally { token.resolve('late-download-token'); await main; }
  });

  it('引用中的 /stop 仅作为引用内容，新消息正常派发且不取消在途 generation', async () => {
    const gate = deferred();
    state.dispatch.mockImplementationOnce(async () => { await gate.promise; return dispatchResult; });
    const main = handleDingTalkMessage(message());
    try {
      await vi.waitFor(() => expect(state.dispatch).toHaveBeenCalledTimes(1));
      const first = state.dispatch.mock.calls[0][0];
      const next = message('解释这个命令');
      next.data.text = { content: '解释这个命令', isReplyMsg: true, repliedMsg: { msgId: 'old-command', msgType: 'text', content: { text: '/stop' } } };
      await handleDingTalkMessage(next);
      expect(state.dispatch.mock.calls[1][0].ctx).toMatchObject({ CommandBody: '解释这个命令', RawBody: '解释这个命令' });
      expect(state.dispatch.mock.calls[1][0].ctx.BodyForAgent).toContain('/stop');
      expect(first.replyOptions.abortSignal.aborted).toBe(false);
      expect(state.stopDispatcher).not.toHaveBeenCalled();
      expect(state.createDispatcher).toHaveBeenCalledTimes(2);
    } finally { gate.resolve(); await main; }
  });
});

describe('真实入站缓存引用与命令隔离', () => {
  it('从出站 card alias 恢复 ReplyTo/UntrustedContext，CommandBody 仅保留本条新消息', async () => {
    state.store.rememberMessageContext(scope, { id: 'outbound-message', direction: 'outbound', text: '/stop\n这是被引用的旧答案', aliases: ['card-instance'] });
    const next = message('继续分析');
    next.data.text = { content: '继续分析', isReplyMsg: true, repliedMsg: { cardInstanceId: 'card-instance', msgType: 'text' } };
    await handleDingTalkMessage(next);
    const ctx = state.dispatch.mock.calls[0][0].ctx;
    expect(ctx).toMatchObject({ CommandBody: '继续分析', RawBody: '继续分析', ReplyToId: 'outbound-message', ReplyToBody: '/stop\n这是被引用的旧答案', ReplyToSender: 'assistant', ReplyToIsQuote: true });
    expect(ctx.UntrustedContext).toHaveLength(1);
    expect(JSON.parse(ctx.UntrustedContext[0])).toMatchObject({ type: 'dingtalk-quoted-message-context', source: 'observed-message-cache', quotedChain: [{ id: 'outbound-message', direction: 'outbound', text: '/stop\n这是被引用的旧答案' }] });
    expect(state.stopDispatcher).not.toHaveBeenCalled();
  });

  it.each([{ accountId: 'OtherBot' }, { data: { conversationId: 'other-group' } }])('缓存不会通过真实入站链跨 scope 恢复：%j', async (overrides) => {
    state.store.rememberMessageContext(scope, { id: 'private-message', direction: 'inbound', text: '不能跨scope恢复' });
    const next = message('继续');
    Object.assign(next, 'accountId' in overrides ? overrides : {});
    Object.assign(next.data, 'data' in overrides ? overrides.data : {});
    next.data.text = { content: '继续', isReplyMsg: true, repliedMsg: { msgId: 'private-message' } };
    await handleDingTalkMessage(next);
    expect(state.dispatch.mock.calls[0][0].ctx.ReplyToBody).toBeUndefined();
    expect(state.dispatch.mock.calls[0][0].ctx.UntrustedContext).toBeUndefined();
  });

  it('真实 dispatcher 的 onFinalReply 保存正文与卡片别名供下一轮引用', async () => {
    await handleDingTalkMessage(message('原问题'));
    const callbacks = state.createDispatcher.mock.calls[0][0];
    callbacks.onFinalReply({ text: '已经回答', messageId: 'delivered-id', cardInstanceId: 'track-id' });
    const next = message('引用你的回答');
    next.data.originalProcessQueryKey = 'track-id';
    await handleDingTalkMessage(next);
    expect(state.dispatch.mock.calls[1][0].ctx).toMatchObject({ ReplyToId: 'delivered-id', ReplyToBody: '已经回答', ReplyToSender: 'assistant' });
  });

  it('分块 Markdown 的每个真实 messageId 都能恢复同一份最终正文', async () => {
    await handleDingTalkMessage(message('长回复问题'));
    const callbacks = state.createDispatcher.mock.calls[0][0];
    callbacks.onFinalReply({ text: '完整的长回复', messageId: 'chunk-1', messageIds: ['chunk-1', 'chunk-2'] });
    const next = message('继续分析第二段');
    next.data.text = { content: '继续分析第二段', isReplyMsg: true, repliedMsg: { msgId: 'chunk-2' } };
    await handleDingTalkMessage(next);
    expect(state.dispatch.mock.calls[1][0].ctx).toMatchObject({ ReplyToId: 'chunk-1', ReplyToBody: '完整的长回复', ReplyToSender: 'assistant' });
  });
});

describe('实验 aliases 进入独立 agent 会话', () => {
  const cfg: Params['cfg'] = {
    agents: { entries: { support: {}, coder: {} }, ownership: 'explicit' },
    bindings: [{ agentId: 'support', match: { channel: 'dingtalk-connector', accountId: 'TeamBot' } }],
  };
  const experimentalMultiAgent = { enabled: true, aliases: { 帮手: 'support', 程序员: 'coder' }, maxTargets: 2 };

  it('两个显式别名分别使用独立 session/workspace，正文去掉路由别名', async () => {
    await handleDingTalkMessage(message('@帮手 @程序员 比较两个方案', { cfg, config: { experimentalMultiAgent } }));
    expect(state.dispatch.mock.calls.map(([{ ctx }]) => [ctx.SessionKey, ctx.CommandBody])).toEqual([
      ['agent:support:dingtalk-connector:group:group-1', '比较两个方案'],
      ['agent:coder:dingtalk-connector:group:group-1', '比较两个方案'],
    ]);
    expect(state.createDispatcher.mock.calls.map(([options]) => [options.agentId, options.mediaLocalRoots])).toEqual([
      ['support', ['/workspaces/support']], ['coder', ['/workspaces/coder']],
    ]);
  });

  it('默认关闭或配置 disabled 时保持 bindings 和原始正文', async () => {
    for (const config of [{}, { experimentalMultiAgent: { ...experimentalMultiAgent, enabled: false } }]) {
      await handleDingTalkMessage(message('@程序员 比较方案', { cfg, config }));
    }
    expect(state.dispatch.mock.calls.map(([{ ctx }]) => [ctx.SessionKey, ctx.CommandBody])).toEqual([
      ['agent:support:dingtalk-connector:group:group-1', '@程序员 比较方案'],
      ['agent:support:dingtalk-connector:group:group-1', '@程序员 比较方案'],
    ]);
  });

  it('超出最大目标数时提示并完全不派发，也不创建卡片', async () => {
    await handleDingTalkMessage(message('@帮手 @程序员 比较方案', { cfg, config: { experimentalMultiAgent: { ...experimentalMultiAgent, maxTargets: 1 } } }));
    expect(state.dispatch).not.toHaveBeenCalled();
    expect(state.createDispatcher).not.toHaveBeenCalled();
    expect(state.send).toHaveBeenCalledWith(expect.anything(), { openConversationId: 'group-1' }, expect.stringContaining('最多可指定 1 个助手'), expect.objectContaining({ useAICard: false }));
  });

  it('多个别名携带 /btw 时只进入首个目标并保持旁路交付', async () => {
    await handleDingTalkMessage(message('@程序员 @帮手 /btw 什么是闭包', { cfg, config: { experimentalMultiAgent } }));
    expect(state.dispatch).toHaveBeenCalledTimes(1);
    expect(state.dispatch.mock.calls[0][0].ctx).toMatchObject({ SessionKey: 'agent:coder:dingtalk-connector:group:group-1', CommandBody: '/btw 什么是闭包' });
    expect(state.createDispatcher).not.toHaveBeenCalled();
  });

  it('顺序派发首个助手收到 stop 后，不得再启动同一消息的后续助手', async () => {
    const gate = deferred();
    state.dispatch.mockImplementation(async ({ ctx }) => {
      if (ctx.CommandBody === '先检查再回答' && ctx.SessionKey.startsWith('agent:support:')) await gate.promise;
      return dispatchResult;
    });
    const main = handleDingTalkMessage(message('@帮手 @程序员 先检查再回答', { cfg, config: { experimentalMultiAgent } }));
    try {
      await vi.waitFor(() => expect(state.dispatch).toHaveBeenCalledTimes(1));
      const first = state.dispatch.mock.calls[0][0];
      await handleDingTalkMessage(message('@帮手 /stop', { cfg, config: { experimentalMultiAgent } }));
      expect(first.replyOptions.abortSignal.aborted).toBe(true);
      gate.resolve(); await main;
      expect(state.dispatch.mock.calls.map(([{ ctx }]) => [ctx.SessionKey, ctx.CommandBody])).toEqual([
        ['agent:support:dingtalk-connector:group:group-1', '先检查再回答'],
        ['agent:support:dingtalk-connector:group:group-1', '/stop'],
      ]);
    } finally { gate.resolve(); await main; }
  });

  it('实验停止保持显式路由：裸 stop 进入 bindings，@程序员 /stop 才取消 coder', async () => {
    const gate = deferred();
    state.dispatch.mockImplementation(async ({ ctx }) => {
      if (ctx.CommandBody !== '/stop') await gate.promise;
      return dispatchResult;
    });
    const main = handleDingTalkMessage(message('@程序员 检查代码', { cfg, config: { experimentalMultiAgent } }));
    try {
      await vi.waitFor(() => expect(state.dispatch).toHaveBeenCalledTimes(1));
      const signal = state.dispatch.mock.calls[0][0].replyOptions.abortSignal;
      await handleDingTalkMessage(message('stop', { cfg, config: { experimentalMultiAgent } }));
      expect(signal.aborted).toBe(false);
      expect(state.stopDispatcher).not.toHaveBeenCalled();
      await handleDingTalkMessage(message('@程序员 /stop', { cfg, config: { experimentalMultiAgent } }));
      expect(signal.aborted).toBe(true);
      expect(state.dispatch.mock.calls.map(([{ ctx }]) => [ctx.SessionKey, ctx.CommandBody])).toEqual([
        ['agent:coder:dingtalk-connector:group:group-1', '检查代码'],
        ['agent:support:dingtalk-connector:group:group-1', '/stop'],
        ['agent:coder:dingtalk-connector:group:group-1', '/stop'],
      ]);
    } finally { gate.resolve(); await main; }
  });
});

describe('真实入站的表单回调续聊身份与代次', () => {
  const cfg: Params['cfg'] = {
    agents: { entries: { support: {}, research: {} }, ownership: 'explicit' },
    bindings: [{ agentId: 'support', match: { channel: 'dingtalk-connector', accountId: 'TeamBot' } }],
  };
  const config: Params['config'] = { experimentalMultiAgent: { enabled: true, aliases: { 研究: 'research' } } };
  const answer = JSON.stringify({ type: 'dingtalk_question_answer', answers: [{ name: 'scope', value: '所有项目' }] });

  it('实验 @研究 的表单继续 research 原会话与 workspace，不误回静态 bindings agent', async () => {
    await handleDingTalkMessage(message('@研究 开始调研', { cfg, config }));
    const context = state.questionContexts[0];
    expect(context).toMatchObject({ accountId: 'TeamBot', conversationId: 'group-1', senderId: 'user-1', agentId: 'research', sessionKey: 'agent:research:dingtalk-connector:group:group-1' });
    await context.resume(answer, 'question-research');
    expect(state.dispatch.mock.calls.map(([{ ctx }]) => [ctx.SessionKey, ctx.CommandBody])).toEqual([
      ['agent:research:dingtalk-connector:group:group-1', '开始调研'],
      ['agent:research:dingtalk-connector:group:group-1', answer],
    ]);
    expect(state.createDispatcher.mock.calls[1][0]).toMatchObject({ agentId: 'research', mediaLocalRoots: ['/workspaces/research'], replyAgentLabel: 'research' });
    expect(state.dispatch.mock.calls[1][0].ctx.MessageSid).toBe('question-answer:question-research');
  });

  it('新普通消息完成后旧表单 resume 拒绝，不再触发宿主生成', async () => {
    await handleDingTalkMessage(message('原始问题'));
    const pending = state.questionContexts[0];
    await handleDingTalkMessage(message('我已经改主意了'));
    await expect(pending.resume(answer, 'old-question')).rejects.toThrow('失效');
    expect(state.dispatch.mock.calls.map(([{ ctx }]) => ctx.CommandBody)).toEqual(['原始问题', '我已经改主意了']);
  });

  it('/btw 不作废已有表单，回答仍能续聊', async () => {
    await handleDingTalkMessage(message('原始问题'));
    const pending = state.questionContexts[0];
    await handleDingTalkMessage(message('/btw 顺便解释一下'));
    expect(state.invalidate).toHaveBeenCalledTimes(1);
    await expect(pending.resume(answer, 'still-pending')).resolves.toBeUndefined();
    expect(state.dispatch.mock.calls.map(([{ ctx }]) => ctx.CommandBody)).toEqual(['原始问题', '/btw 顺便解释一下', answer]);
  });

  it('旧回调经过 prepare 的 await 边界时被新消息抢先更新代次，复核后拒绝续聊', async () => {
    await handleDingTalkMessage(message('原始问题'));
    const pending = state.questionContexts[0];
    let replacement: Promise<void> | undefined;
    state.workspace.mockImplementationOnce((_cfg: unknown, agentId: string) => {
      // 在旧回调 prepare 同步计算 workspace 时启动新消息，使其后续 continuation
      // 先于旧回调 await prepare 的 continuation 执行，复现二次校验窗口。
      replacement = handleDingTalkMessage(message('抢先到达的新消息'));
      return `/workspaces/${agentId}`;
    });
    await expect(pending.resume(answer, 'racing-question')).rejects.toThrow('失效');
    await replacement;
    expect(state.dispatch.mock.calls.map(([{ ctx }]) => ctx.CommandBody)).toEqual(['原始问题', '抢先到达的新消息']);
  });

  it('原实验 agent 别名被撤销后拒绝旧表单续聊', async () => {
    const mutableConfig = { experimentalMultiAgent: { enabled: true, aliases: { 研究: 'research' } as Record<string, string> } };
    await handleDingTalkMessage(message('@研究 开始调研', { cfg, config: mutableConfig }));
    const pending = state.questionContexts[0];
    delete mutableConfig.experimentalMultiAgent.aliases.研究;
    await expect(pending.resume(answer, 'removed-alias')).rejects.toThrow('失效');
    expect(state.dispatch).toHaveBeenCalledTimes(1);
  });
});
