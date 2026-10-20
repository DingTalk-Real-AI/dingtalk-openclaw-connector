import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn() }));
vi.mock('../../src/utils/http-client.ts', () => ({ dingtalkHttp: http }));
vi.mock('../../src/utils/token.ts', () => ({ DINGTALK_API: 'https://api.dingtalk.com', getAccessToken: vi.fn(async () => 'test-token') }));
import {
  DEFAULT_QUESTION_TEMPLATE_ID, handleDingtalkQuestionCallback, invalidatePendingQuestionsForScope,
  registerDingtalkQuestionTool, withDingtalkQuestionContext, type DingtalkQuestionContext,
} from '../../src/questions/index.ts';

let contexts: DingtalkQuestionContext[] = [];
let factory: (context: any) => any;
const input = { questions: [{ question: '确认？', options: [{ value: 'yes', label: '确认' }, { value: 'no', label: '取消' }] }] };

function context(overrides: Partial<DingtalkQuestionContext> = {}): DingtalkQuestionContext {
  const ctx = {
    accountId: 'bot-a', conversationId: 'group-a', senderId: 'user-a', agentId: 'main',
    sessionKey: 'agent:main:group-a', isDirect: false, config: { clientId: 'robot-a' } as any,
    stopCurrentGeneration: vi.fn(async () => true), resume: vi.fn(async () => {}), ...overrides,
  };
  contexts.push(ctx);
  return ctx;
}

async function send(ctx: DingtalkQuestionContext, params = input) {
  return withDingtalkQuestionContext(ctx, async () => {
    const result = await factory({ sessionKey: ctx.sessionKey }).execute('call', params);
    return result.details;
  });
}

function payload(result: any, values: unknown = { answer_0: 'yes' }, extra: Record<string, unknown> = {}) {
  return {
    outTrackId: result.outTrackId, userId: 'user-a',
    content: JSON.stringify({ cardPrivateData: { actionIds: [result.questionId], params: { form: values } } }),
    ...extra,
  };
}

async function submit(ctx: DingtalkQuestionContext, result: any, values?: unknown, extra?: Record<string, unknown>) {
  return handleDingtalkQuestionCallback({ accountId: ctx.accountId, config: ctx.config, data: payload(result, values, extra) });
}

beforeEach(() => {
  vi.clearAllMocks();
  contexts = [];
  http.post.mockResolvedValue({ data: { result: { deliverResults: [{ success: true }] } } });
  http.put.mockResolvedValue({ data: {} });
  registerDingtalkQuestionTool({ registerTool: (create: any) => { factory = create; } } as any);
});
afterEach(async () => {
  for (const ctx of contexts) await invalidatePendingQuestionsForScope(ctx);
  vi.useRealTimers();
});

describe('原生问题卡完整生命周期', () => {
  it('按当前机器人和群发送，停下当前生成，提交后只续聊一次', async () => {
    const ctx = context();
    const result = await send(ctx);
    expect(result.status).toBe('pending');
    expect(ctx.stopCurrentGeneration).toHaveBeenCalledOnce();
    expect(http.post.mock.calls[0][1]).toMatchObject({
      cardTemplateId: DEFAULT_QUESTION_TEMPLATE_ID, callbackType: 'STREAM',
      openSpaceId: 'dtv1.card//IM_GROUP.group-a', imGroupOpenDeliverModel: { robotCode: 'robot-a' },
      imGroupOpenSpaceModel: { supportForward: false },
    });
    await Promise.all([submit(ctx, result), submit(ctx, result)]);
    expect(ctx.resume).toHaveBeenCalledOnce();
    expect(JSON.parse(vi.mocked(ctx.resume).mock.calls[0][0])).toMatchObject({ questionId: result.questionId, answers: { answer_0: 'yes' } });
    expect(vi.mocked(ctx.resume).mock.calls[0][1]).toBe(result.questionId);
    expect(http.put.mock.calls.at(-1)?.[1].cardData.cardParamMap.card_status).toBe('submitted');
  });

  it('私聊使用当前 senderId，不把 conversationId 当用户 ID', async () => {
    const ctx = context({ isDirect: true, config: { clientId: 'robot-a', questionCardTemplateId: 'private.schema' } as any });
    await send(ctx);
    expect(http.post.mock.calls[0][1]).toMatchObject({ cardTemplateId: 'private.schema', openSpaceId: 'dtv1.card//IM_ROBOT.user-a' });
  });

  it('拒绝其他机器人、非答题者、缺失身份、伪造内层身份及错误问题ID', async () => {
    const ctx = context();
    const result = await send(ctx);
    expect((await handleDingtalkQuestionCallback({ accountId: 'bot-b', config: ctx.config, data: payload(result) })).status).toBe('forbidden');
    for (const userId of ['other', undefined]) expect((await submit(ctx, result, undefined, { userId })).status).toBe('forbidden');
    const forged = { outTrackId: result.outTrackId, content: { cardPrivateData: { actionIds: [result.questionId], params: { form: { answer_0: 'yes' }, userId: 'user-a' } } } };
    expect((await handleDingtalkQuestionCallback({ accountId: ctx.accountId, config: ctx.config, data: forged })).status).toBe('forbidden');
    expect((await submit(ctx, { ...result, questionId: 'wrong' })).status).toBe('forbidden');
    expect(ctx.resume).not.toHaveBeenCalled();
    expect((await submit(ctx, result)).status).toBe('submitted');
  });

  it('拒绝非法选项，允许用户修正后再次提交', async () => {
    const ctx = context();
    const result = await send(ctx);
    expect((await submit(ctx, result, { answer_0: 'unsafe-value' })).status).toBe('invalid');
    expect(ctx.resume).not.toHaveBeenCalled();
    expect((await submit(ctx, result)).status).toBe('submitted');
  });

  it('取消是终态，不生成下一轮，也不能再次提交', async () => {
    const ctx = context();
    const result = await send(ctx);
    const data = payload(result, undefined, { content: { cardPrivateData: { actionIds: [result.questionId], params: { user_cancel: true } } } });
    expect((await handleDingtalkQuestionCallback({ accountId: ctx.accountId, config: ctx.config, data })).status).toBe('cancelled');
    expect((await submit(ctx, result)).status).toBe('cancelled');
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it('过期自动关闭卡片并拒绝迟到提交', async () => {
    vi.useFakeTimers();
    const ctx = context({ config: { clientId: 'robot-a', questionTimeoutMs: 10_000 } as any });
    const result = await send(ctx);
    await vi.advanceTimersByTimeAsync(10_001);
    expect((await submit(ctx, result)).status).toBe('expired');
    expect(ctx.resume).not.toHaveBeenCalled();
    expect(http.put.mock.calls.at(-1)?.[1].cardData.cardParamMap.card_status).toBe('expired');
  });

  it('新消息只失效匹配 scope，不影响其他机器人和用户', async () => {
    const first = context();
    const other = context({ senderId: 'user-b' });
    const a = await send(first);
    const b = await send(other);
    await invalidatePendingQuestionsForScope(first);
    expect((await submit(first, a)).status).toBe('superseded');
    expect((await submit(other, b, undefined, { userId: 'user-b' })).status).toBe('submitted');
    expect(first.resume).not.toHaveBeenCalled();
  });

  it('发送期间的新消息不会被迟到投递重新激活，且会关闭已投递卡片', async () => {
    let release!: (value: any) => void;
    const deliveryStarted = new Promise<void>((resolve) => {
      http.post.mockImplementationOnce(() => { resolve(); return new Promise((done) => { release = done; }); });
    });
    const ctx = context();
    const sending = send(ctx);
    await deliveryStarted;
    await invalidatePendingQuestionsForScope(ctx);
    release({ data: {} });
    const result = await sending;
    expect(result.status).toBe('superseded');
    expect(ctx.stopCurrentGeneration).not.toHaveBeenCalled();
    const outTrackId = http.post.mock.calls[0][1].outTrackId;
    expect((await submit(ctx, { ...result, outTrackId })).status).toBe('superseded');
    expect(http.put.mock.calls.at(-1)?.[1].cardData.cardParamMap.card_status).toBe('superseded');
  });

  it('旧生成在新消息之后才调用工具时不发送陈旧表单', async () => {
    const ctx = context({ isCurrent: () => false });
    expect((await send(ctx)).status).toBe('superseded');
    expect(http.post).not.toHaveBeenCalled();
    expect(ctx.stopCurrentGeneration).not.toHaveBeenCalled();
  });

  it('原始轮次已失效时回调关闭表单，不领取续聊', async () => {
    let current = true;
    const ctx = context({ isCurrent: () => current });
    const result = await send(ctx);
    current = false;
    expect((await submit(ctx, result)).status).toBe('superseded');
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it('卡片投递失败不停止当前生成，也不留可续聊状态', async () => {
    const ctx = context();
    http.post.mockResolvedValueOnce({ data: { result: { deliverResults: [{ success: false }] } } });
    const result = await send(ctx);
    expect(result.status).toBe('failed');
    expect(ctx.stopCurrentGeneration).not.toHaveBeenCalled();
    const outTrackId = http.post.mock.calls[0][1].outTrackId;
    expect((await submit(ctx, { ...result, outTrackId })).status).toBe('failed');
  });

  it('停止生成失败时关闭表单，不等待用户', async () => {
    const ctx = context({ stopCurrentGeneration: vi.fn(async () => false) });
    const result = await send(ctx);
    expect(result.status).toBe('failed');
    expect(ctx.resume).not.toHaveBeenCalled();
    expect(http.put.mock.calls.at(-1)?.[1].cardData.cardParamMap.card_status).toBe('failed');
  });

  it('续聊失败仍为已领取终态，重复回调不会重跑', async () => {
    const ctx = context({ resume: vi.fn(async () => { throw new Error('failed'); }) });
    const result = await send(ctx);
    expect((await submit(ctx, result)).status).toBe('resume_failed');
    await submit(ctx, result);
    expect(ctx.resume).toHaveBeenCalledOnce();
  });

  it('未知旧问题只关闭卡片，不猜测会话路由', async () => {
    const ctx = context();
    expect((await submit(ctx, { outTrackId: 'dingtalk_question_after-restart', questionId: 'q_old' })).status).toBe('expired');
    expect(ctx.resume).not.toHaveBeenCalled();
    expect(http.put.mock.calls.at(-1)?.[1].cardData.cardParamMap.card_status).toBe('expired');
  });

  it('校验错误的迟到更新不会在有效提交后重开卡片', async () => {
    const ctx = context();
    const result = await send(ctx);
    await Promise.all([submit(ctx, result, { answer_0: 'invalid' }), submit(ctx, result)]);
    expect(http.put.mock.calls.at(-1)?.[1].cardData.cardParamMap.card_status).toBe('submitted');
    expect(ctx.resume).toHaveBeenCalledOnce();
  });
});

describe('工具的当前会话绑定', () => {
  it('仅完整宿主身份匹配时接受可信 DM 工具策略别名', async () => {
    const ctx = context({ isDirect: true, sessionKey: 'agent:main:main', trustedToolSessionKeys: ['agent:main:dingtalk-connector:bot-a:direct:user-a'] });
    await withDingtalkQuestionContext(ctx, async () => {
      const toolContext = { sessionKey: ctx.trustedToolSessionKeys![0], messageChannel: 'dingtalk-connector', agentAccountId: ctx.accountId, requesterSenderId: ctx.senderId };
      expect((await factory({ ...toolContext, requesterSenderId: undefined }).execute('call', input)).details.status).toBe('failed');
      expect((await factory(toolContext).execute('call', input)).details.status).toBe('pending');
    });
  });

  it('没有活跃钉钉上下文时不发送，也不能执行过期缓存工具', async () => {
    expect((await factory({}).execute('call', input)).details.status).toBe('failed');
    const ctx = context();
    let cached: any;
    await withDingtalkQuestionContext(ctx, async () => { cached = factory({ sessionKey: ctx.sessionKey }); });
    expect((await cached.execute('call', input)).details.status).toBe('failed');
    expect(http.post).not.toHaveBeenCalled();
  });

  it.each([
    { sessionKey: 'other' }, { agentId: 'other' }, { messageChannel: 'slack' },
    { agentAccountId: 'other' }, { requesterSenderId: 'other' },
  ])('拒绝宿主不同会话身份：%j', async (toolContext) => {
    const ctx = context();
    await withDingtalkQuestionContext(ctx, async () => {
      expect((await factory(toolContext).execute('call', input)).details.status).toBe('failed');
    });
    expect(http.post).not.toHaveBeenCalled();
  });
});
