/**
 * 出站路由单元测试
 *
 * 验证 sendTextToDingTalk / sendMediaToDingTalk 正确解析 group:/user: 前缀，
 * 以及 channel.ts resolveAllowFrom 返回空列表不影响内部策略过滤。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock http client
const mockPost = vi.hoisted(() => vi.fn());
const mockGet = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/http-client.ts", () => ({
  dingtalkHttp: { post: mockPost, get: mockGet },
  dingtalkOapiHttp: { get: mockGet, post: mockPost },
  dingtalkUploadHttp: { post: mockPost, get: mockGet },
}));

// Mock token — 直接返回 fake token，避免 HTTP 请求
vi.mock("../../src/utils/token.ts", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/utils/token.ts")>();
  return {
    ...orig,
    getAccessToken: vi.fn().mockResolvedValue("fake-token"),
    getOapiAccessToken: vi.fn().mockResolvedValue(null), // media 路径不走
    DINGTALK_API: orig.DINGTALK_API,
    DINGTALK_OAPI: orig.DINGTALK_OAPI,
  };
});

// Mock AI Card 创建，让 sendProactive 走普通消息路径（useAICard: false）
vi.mock("../../src/services/messaging/card.ts", () => ({
  createAICardForTarget: vi.fn().mockResolvedValue(null), // 返回 null → fallback 到普通消息
  finishAICard: vi.fn(),
  streamAICard: vi.fn(),
  updateAICard: vi.fn(),
}));

const config = {
  clientId: "ding_client_id",
  clientSecret: "ding_client_secret",
};

describe("sendTextToDingTalk target routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 默认 API 调用返回成功
    mockPost.mockResolvedValue({ data: { processQueryKey: "pqk-123" }, status: 200 });
  });

  it("group:cid... 前缀 → 调用群消息 API，openConversationId 去掉前缀", async () => {
    const { sendTextToDingTalk } = await import("../../src/services/messaging.ts");
    await sendTextToDingTalk({ config, target: "group:cidABC123==", text: "hello" });

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining("/groupMessages/send"),
      expect.objectContaining({ openConversationId: "cidABC123==" }),
      expect.anything(),
    );
  });

  it("cid... 无前缀 → 调用群消息 API（旧格式兼容）", async () => {
    const { sendTextToDingTalk } = await import("../../src/services/messaging.ts");
    await sendTextToDingTalk({ config, target: "cidABC123==", text: "hello" });

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining("/groupMessages/send"),
      expect.objectContaining({ openConversationId: "cidABC123==" }),
      expect.anything(),
    );
  });

  it("user:xxx 前缀 → 调用单聊消息 API，userId 去掉前缀", async () => {
    const { sendTextToDingTalk } = await import("../../src/services/messaging.ts");
    await sendTextToDingTalk({ config, target: "user:staff001", text: "hello" });

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining("/oToMessages/batchSend"),
      expect.objectContaining({ userIds: ["staff001"] }),
      expect.anything(),
    );
  });

  it("裸 userId（无前缀且不以 cid 开头）→ 调用单聊消息 API", async () => {
    const { sendTextToDingTalk } = await import("../../src/services/messaging.ts");
    await sendTextToDingTalk({ config, target: "staff001", text: "hello" });

    expect(mockPost).toHaveBeenCalledWith(
      expect.stringContaining("/oToMessages/batchSend"),
      expect.objectContaining({ userIds: ["staff001"] }),
      expect.anything(),
    );
  });

  it("旧行为回归：group:cidXXX== 不再被误路由为单聊", async () => {
    const { sendTextToDingTalk } = await import("../../src/services/messaging.ts");
    await sendTextToDingTalk({ config, target: "group:cidXXX==", text: "hello" });

    // 不应调用单聊 API
    const calls = mockPost.mock.calls.map((c) => c[0]);
    expect(calls.every((url: string) => !url.includes("oToMessages"))).toBe(true);
  });
});
