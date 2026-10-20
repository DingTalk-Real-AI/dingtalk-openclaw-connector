import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRunUsage = vi.hoisted(() => vi.fn());
vi.mock("../../src/run-metadata.ts", () => ({ getDingtalkRunUsage: mockRunUsage }));

const mockResolveDingtalkAccount = vi.hoisted(() => vi.fn());
const mockGetDingtalkRuntime = vi.hoisted(() => vi.fn());
const mockCreateAICardForTarget = vi.hoisted(() => vi.fn());
const mockStreamAICard = vi.hoisted(() => vi.fn());
const mockFinishAICard = vi.hoisted(() => vi.fn());
const mockIsQpsLimitError = vi.hoisted(() => vi.fn());
const mockSendMessage = vi.hoisted(() => vi.fn());
const mockSendTextMessage = vi.hoisted(() => vi.fn());
const mockSendMarkdownMessage = vi.hoisted(() => vi.fn());
const mockGetOapiAccessToken = vi.hoisted(() => vi.fn());
const mockProcessLocalImages = vi.hoisted(() => vi.fn());

vi.mock("openclaw/plugin-sdk/channel-outbound", () => ({
  createReplyPrefixOptions: vi.fn(() => ({
    onModelSelected: vi.fn(),
  })),
  createTypingCallbacks: vi.fn(() => ({
    onActive: vi.fn(),
    onIdle: vi.fn(),
    onCleanup: vi.fn(),
  })),
  logTypingFailure: vi.fn(),
}));

vi.mock("../../src/config/accounts.ts", () => ({
  resolveDingtalkAccount: mockResolveDingtalkAccount,
}));

vi.mock("../../src/runtime.ts", () => ({
  getDingtalkRuntime: mockGetDingtalkRuntime,
}));

vi.mock("../../src/services/messaging/card.ts", () => ({
  createAICardForTarget: mockCreateAICardForTarget,
  streamAICard: mockStreamAICard,
  finishAICard: mockFinishAICard,
  isQpsLimitError: mockIsQpsLimitError,
}));

vi.mock("../../src/services/messaging.ts", () => ({
  sendMessage: mockSendMessage,
  sendTextMessage: mockSendTextMessage,
  sendMarkdownMessage: mockSendMarkdownMessage,
}));

vi.mock("../../src/services/media/image.ts", () => ({
  processLocalImages: mockProcessLocalImages,
}));

vi.mock("../../src/services/media/index.ts", () => ({
  processLocalImages: mockProcessLocalImages,
  processVideoMarkers: vi.fn(async (s: string) => s),
  processAudioMarkers: vi.fn(async (s: string) => s),
  uploadAndReplaceFileMarkers: vi.fn(async (s: string) => s),
}));

vi.mock("../../src/services/media/video.ts", () => ({
  processVideoMarkers: vi.fn(async (s: string) => s),
}));

vi.mock("../../src/services/media/audio.ts", () => ({
  processAudioMarkers: vi.fn(async (s: string) => s),
}));

vi.mock("../../src/services/media/file.ts", () => ({
  uploadAndReplaceFileMarkers: vi.fn(async (s: string) => s),
}));

vi.mock("../../src/services/media.ts", () => ({
  processRawMediaPaths: vi.fn(async (s: string) => s),
}));

vi.mock("../../src/utils/token.ts", () => ({
  getAccessToken: vi.fn(),
  getOapiAccessToken: mockGetOapiAccessToken,
}));

const CARD = {
  cardInstanceId: "card-1",
  accessToken: "tk",
  inputingStarted: false,
};

function makeRuntime() {
  return {
    log: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

async function makeDispatcher(overrides: Record<string, unknown> = {}) {
  const { createDingtalkReplyDispatcher } = await import("../../src/reply-dispatcher");
  const result = createDingtalkReplyDispatcher({
    cfg: {} as any,
    agentId: "a1",
    runtime: makeRuntime() as any,
    conversationId: "conv-1",
    senderId: "user-1",
    isDirect: true,
    sessionWebhook: "http://webhook",
    ...overrides,
  } as any);
  const args = result.dispatcherOptions;
  return { result, args };
}

describe("社区对齐卡片与停止", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunUsage.mockReturnValue(undefined);
    mockResolveDingtalkAccount.mockReturnValue({
      accountId: "acc-1",
      config: { debug: false, streaming: true },
    });
    mockGetOapiAccessToken.mockResolvedValue(null);
    mockProcessLocalImages.mockImplementation(async (s: string) => s);
    mockCreateAICardForTarget.mockResolvedValue(CARD);
    mockStreamAICard.mockResolvedValue(undefined);
    mockFinishAICard.mockResolvedValue(undefined);
    mockSendMessage.mockResolvedValue({ ok: true });
    mockSendTextMessage.mockResolvedValue({ ok: true });
    mockSendMarkdownMessage.mockResolvedValue({ ok: true });
    mockIsQpsLimitError.mockReturnValue(false);
    mockGetDingtalkRuntime.mockReturnValue({
      channel: {
        text: {
          resolveTextChunkLimit: () => 4000,
          resolveChunkMode: () => "markdown",
          chunkTextWithMode: (text: string) => [text],
        },
      },
    });
  });


  it("v2 贯通模型元数据、工具与正文 blocks，回执钩子仅在成功投放后触发", async () => {
    mockResolveDingtalkAccount.mockReturnValue({ accountId: "acc-1", config: { streaming: true, cardTemplateMode: "v2" } });
    const onCardCreated = vi.fn(); const onFinalReply = vi.fn();
    const { args, result } = await makeDispatcher({ onCardCreated, onFinalReply });
    result.replyOptions.onModelSelected({ model: "actual-model", provider: "provider", thinkLevel: undefined });
    await result.replyOptions.onPartialReply!({ text: "检查中" });
    await result.replyOptions.onToolStart!({ name: "search", toolCallId: "tool-1", phase: "start" });
    result.replyOptions.onAssistantMessageStart!();
    await result.replyOptions.onPartialReply!({ text: "结论" });
    await args.deliver!({ text: "结论" }, { kind: "final" });
    expect(onCardCreated).toHaveBeenCalledWith({ cardInstanceId: "card-1" });
    expect(onFinalReply).toHaveBeenCalledWith({ text: "结论", cardInstanceId: "card-1", messageId: "card-1" });
    const finalPresentation = mockFinishAICard.mock.calls[0][4];
    expect(finalPresentation.statusLine).toContain("actual-model");
    expect(finalPresentation.blocks.map((b: any) => b.type)).toEqual([0, 2, 0]);
    expect(finalPresentation.blocks.at(-1)).toEqual({ type: 0, markdown: "结论" });
    await args.onIdle!();
  });

  it("stop 必须匹配账号、会话、发送者和 run，停止后所有迟到输出被抑制", async () => {
    const { stopDingtalkReplyDispatchers } = await import("../../src/reply-dispatcher.ts");
    const { args, result } = await makeDispatcher({ sessionKey: "s1", runId: "r1" });
    await result.replyOptions.onPartialReply!({ text: "现有答复" });
    expect(await stopDingtalkReplyDispatchers({ accountId: "other", sessionKey: "s1", senderId: "user-1", runId: "r1" })).toBe(0);
    expect(await stopDingtalkReplyDispatchers({ accountId: "acc-1", sessionKey: "s1", senderId: "other", runId: "r1" })).toBe(0);
    expect(await stopDingtalkReplyDispatchers({ accountId: "acc-1", sessionKey: "s1", senderId: "user-1", runId: "old" })).toBe(0);
    expect(await stopDingtalkReplyDispatchers({ accountId: "acc-1", sessionKey: "s1", senderId: "user-1", runId: "r1" })).toBe(1);
    expect(mockFinishAICard).toHaveBeenCalledTimes(1);
    expect(mockFinishAICard.mock.calls[0][1]).toContain("已停止生成。");
    await result.replyOptions.onPartialReply!({ text: "迟到" });
    await args.deliver!({ text: "迟到 final" }, { kind: "final" });
    await args.deliver!({ text: "迟到 block" }, { kind: "block" });
    args.onReplyStart!(); await args.onIdle!();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockCreateAICardForTarget).toHaveBeenCalledTimes(1);
    expect(mockFinishAICard).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 'default', ' Default ', '__default__'])('默认账号停止入口 %s 能收口规范账号并丢弃迟到输出', async (accountId) => {
    mockResolveDingtalkAccount.mockReturnValue({ accountId: '__default__', config: { streaming: true } });
    const { stopDingtalkReplyDispatchers } = await import('../../src/reply-dispatcher.ts');
    const sessionKey = `default-${String(accountId)}`;
    const { args, result } = await makeDispatcher({ accountId, sessionKey, runId: 'default-r' });
    try {
      await result.replyOptions.onPartialReply!({ text: '已有内容' });
      expect(await stopDingtalkReplyDispatchers({ accountId, sessionKey, senderId: 'user-1' })).toBe(1);
      await args.deliver!({ text: '迟到终稿' }, { kind: 'final' });
      expect(mockFinishAICard).toHaveBeenCalledTimes(1);
      expect(mockFinishAICard.mock.calls[0][1]).toContain('已停止生成。');
      expect(mockSendMessage).not.toHaveBeenCalled();
    } finally {
      await args.onIdle!();
    }
  });

  it('停止入口保留非默认账号的大小写隔离', async () => {
    mockResolveDingtalkAccount.mockReturnValue({ accountId: 'TeamBot', config: { streaming: true } });
    const { stopDingtalkReplyDispatchers } = await import('../../src/reply-dispatcher.ts');
    const { args } = await makeDispatcher({ accountId: 'TeamBot', sessionKey: 'case-s', runId: 'case-r' });
    expect(await stopDingtalkReplyDispatchers({ accountId: 'teambot', sessionKey: 'case-s', senderId: 'user-1' })).toBe(0);
    expect(await stopDingtalkReplyDispatchers({ accountId: 'TeamBot', sessionKey: 'case-s', senderId: 'user-1' })).toBe(1);
    await args.onIdle!();
  });

  it("卡片创建在途时 stop 等待创建并收口，异步缓冲停止后清空", async () => {
    const { stopDingtalkReplyDispatchers } = await import("../../src/reply-dispatcher.ts");
    let resolveCard!: (value: typeof CARD) => void;
    mockCreateAICardForTarget.mockImplementation(() => new Promise(resolve => { resolveCard = resolve; }));
    const { args } = await makeDispatcher({ sessionKey: "pending", runId: "run" });
    args.onReplyStart!();
    const stop = stopDingtalkReplyDispatchers({ accountId: "acc-1", sessionKey: "pending", senderId: "user-1", runId: "run" });
    resolveCard(CARD); await stop;
    expect(mockFinishAICard).toHaveBeenCalledTimes(1);
    const asyncDispatcher = await makeDispatcher({ sessionKey: "async", runId: "async-run", asyncMode: true });
    await asyncDispatcher.args.deliver!({ text: "buffered" }, { kind: "final" });
    expect(asyncDispatcher.result.getAsyncModeResponse()).toBe("buffered");
    await stopDingtalkReplyDispatchers({ accountId: "acc-1", sessionKey: "async", senderId: "user-1" });
    expect(asyncDispatcher.result.getAsyncModeResponse()).toBe("");
    await asyncDispatcher.args.deliver!({ text: "late" }, { kind: "final" });
    expect(asyncDispatcher.result.getAsyncModeResponse()).toBe("");
  });

  it("v2 创建失败后 Markdown 降级，记录失败不能再次发送", async () => {
    mockResolveDingtalkAccount.mockReturnValue({ accountId: "acc-1", config: { streaming: true, cardTemplateMode: "v2" } });
    mockCreateAICardForTarget.mockResolvedValue(null);
    const onFinalReply = vi.fn().mockRejectedValue(new Error("cache rejected"));
    const { args } = await makeDispatcher({ onFinalReply });
    await args.deliver!({ text: "完整文本" }, { kind: "final" });
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls[0][2]).toBe("完整文本");
    expect(onFinalReply).toHaveBeenCalledWith({ text: "完整文本" });
  });
  it("成功发送的真实消息查询键能从 originalProcessQueryKey 恢复正文", async () => {
    const { MessageContextStore } = await import("../../src/messages/context-store.ts");
    const store = new MessageContextStore();
    const scope = { accountId: "acc-1", conversationId: "conv-1" };
    mockCreateAICardForTarget.mockResolvedValue({ ...CARD, messageIds: ["platform-query-key", "message-id"] });
    const onFinalReply = vi.fn(({ text, messageId, cardInstanceId, messageIds }) => {
      store.rememberMessageContext(scope, { id: messageId, direction: "outbound", text, aliases: [cardInstanceId, ...messageIds] });
    });
    const { args } = await makeDispatcher({ onFinalReply });
    await args.deliver!({ text: "真正的引用正文" }, { kind: "final" });
    expect(store.resolveQuotedMessageContext(scope, { originalProcessQueryKey: "platform-query-key" }).replyToBody).toBe("真正的引用正文");
    expect(store.resolveById(scope, "message-id")?.text).toBe("真正的引用正文");
    await args.onIdle!();
  });
  it("仅显式实验路由添加 Agent 署名，Markdown 回执携带真实 processQueryKey", async () => {
    const onFinalReply = vi.fn();
    mockCreateAICardForTarget.mockResolvedValue(null);
    mockSendMessage.mockResolvedValue({ processQueryKey: "markdown-query-key" });
    const { args } = await makeDispatcher({ replyAgentLabel: "helper", onFinalReply });
    await args.deliver!({ text: "答案" }, { kind: "final" });
    expect(mockSendMessage.mock.calls[0][2]).toBe("【helper】\n\n答案");
    expect(onFinalReply).toHaveBeenCalledWith({ text: "【helper】\n\n答案", messageId: "markdown-query-key", messageIds: ["markdown-query-key"] });
  });

  it("终态用量只查询实际宿主 runId，并显示实际 hook 数字", async () => {
    mockResolveDingtalkAccount.mockReturnValue({ accountId: "acc-1", config: { streaming: true, cardTemplateMode: "v2" } });
    mockRunUsage.mockReturnValue({ input: 10, output: 5, cacheRead: 3 });
    const { args, result } = await makeDispatcher({ sessionKey: "usage-session", runId: "plugin-run" });
    result.replyOptions.onAgentRunStart("host-run");
    await args.deliver!({ text: "答案" }, { kind: "final" });
    expect(mockRunUsage).toHaveBeenCalledWith({ accountId: "acc-1", sessionKey: "usage-session", runId: "host-run" });
    const status = mockFinishAICard.mock.calls[0][4].statusLine;
    expect(status).toContain("输入 10 · 输出 5 · 缓存读 3");
    expect(status).not.toContain("总计");
    await args.onIdle!();
  });
  it("HTTP 成功但业务投递失败时不写引用缓存", async () => {
    mockCreateAICardForTarget.mockResolvedValue(null);
    mockSendMessage.mockResolvedValue({ errcode: 403, errmsg: "forbidden" });
    const onFinalReply = vi.fn();
    const { args } = await makeDispatcher({ onFinalReply });
    await args.deliver!({ text: "未交付" }, { kind: "final" });
    expect(onFinalReply).not.toHaveBeenCalled();
  });

});
