import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  post: vi.fn(), createCard: vi.fn(), finishCard: vi.fn(),
}));
vi.mock("../../src/utils/index.ts", () => ({
  DINGTALK_API: "https://api.dingtalk.com",
  getAccessToken: vi.fn().mockResolvedValue("fake-token"),
  getOapiAccessToken: vi.fn(),
}));
vi.mock("../../src/utils/logger.ts", () => ({
  createLoggerFromConfig: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));
vi.mock("../../src/utils/http-client.ts", () => ({
  dingtalkHttp: { post: mocks.post }, dingtalkOapiHttp: {},
}));
vi.mock("../../src/services/media.ts", () => ({
  processLocalImages: vi.fn(), processVideoMarkers: vi.fn(),
  processAudioMarkers: vi.fn(), processFileMarkers: vi.fn(), uploadMediaToDingTalk: vi.fn(),
}));
vi.mock("../../src/services/messaging/card.ts", () => ({
  createAICardForTarget: mocks.createCard, finishAICard: mocks.finishCard, streamAICard: vi.fn(),
}));
import { sendTextToDingTalk, sendProactive } from "../../src/services/messaging.ts";

const config = { clientId: "fake-client", clientSecret: "fake-secret" };
const markdown = "# Heading\n**bold**";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createCard.mockReset().mockResolvedValue(null);
  mocks.finishCard.mockReset().mockResolvedValue(undefined);
  mocks.post.mockReset().mockResolvedValue({ status: 200, data: { processQueryKey: "fake-query" } });
});

describe("outbound text formatting (#639)", () => {
  it.each([
    ["heading", "# Heading"], ["bold", "**bold**"], ["list", "- item"],
    ["link", "[label](https://example.com)"], ["table", "| A | B |\n| - | - |"],
    ["multiline", "first\nsecond"],
  ])("detects %s when AI Card is unavailable", async (_name, text) => {
    const result = await sendTextToDingTalk({ config, target: "group:cid-test", text });
    expect(result).toEqual({ ok: true, usedAICard: false, processQueryKey: "fake-query" });
    const body = mocks.post.mock.calls[0][1];
    expect(body.msgKey).toBe("sampleMarkdown");
    expect(JSON.parse(body.msgParam).text).toBe(text);
  });

  it.each(["plain text", ""])('keeps ordinary content as text: "%s"', async (text) => {
    await sendTextToDingTalk({ config, target: "group:cid-test", text });
    const body = mocks.post.mock.calls[0][1];
    expect(body.msgKey).toBe("sampleText");
    expect(JSON.parse(body.msgParam).content).toBe(text);
  });

  it.each([undefined, "aicard", "markdown", "text"] as const)(
    "preserves outbound AI Card priority with groupReplyMode=%s", async (groupReplyMode) => {
      mocks.createCard.mockResolvedValue({ cardInstanceId: "fake-card" });
      const result = await sendTextToDingTalk({
        config: { ...config, groupReplyMode }, target: "group:cid-test", text: markdown, replyToId: "reply-id",
      });
      expect(result).toEqual({ ok: true, usedAICard: true, cardInstanceId: "fake-card" });
      expect(mocks.finishCard).toHaveBeenCalledWith({ cardInstanceId: "fake-card" }, markdown,
        { ...config, groupReplyMode }, undefined);
      expect(mocks.post).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, "aicard", "markdown", "text"] as const)(
    "uses existing auto-detection on fallback with groupReplyMode=%s", async (groupReplyMode) => {
      await sendTextToDingTalk({ config: { ...config, groupReplyMode }, target: "cid-test", text: markdown });
      expect(mocks.post.mock.calls[0][1].msgKey).toBe("sampleMarkdown");
    },
  );

  it.each(["creation", "completion"])("falls back to Markdown after card %s fails", async (stage) => {
    if (stage === "creation") mocks.createCard.mockRejectedValue(new Error("card failed"));
    else {
      mocks.createCard.mockResolvedValue({ cardInstanceId: "fake-card" });
      mocks.finishCard.mockRejectedValue(new Error("card failed"));
    }
    const result = await sendTextToDingTalk({ config, target: "cid-test", text: markdown });
    expect(result.ok).toBe(true);
    expect(result.usedAICard).toBe(false);
    expect(mocks.post.mock.calls[0][1].msgKey).toBe("sampleMarkdown");
  });

  it.each([
    ["group:cid-test", "groupMessages/send", { openConversationId: "cid-test" }],
    ["cid-test", "groupMessages/send", { openConversationId: "cid-test" }],
    ["user:staff-test", "oToMessages/batchSend", { userIds: ["staff-test"] }],
    ["staff-test", "oToMessages/batchSend", { userIds: ["staff-test"] }],
  ])("preserves routing for %s", async (target, endpoint, fields) => {
    await sendTextToDingTalk({ config, target, text: markdown, replyToId: "reply-id" });
    expect(mocks.post).toHaveBeenCalledWith(expect.stringContaining(endpoint as string),
      expect.objectContaining({ ...fields as object, msgKey: "sampleMarkdown" }), expect.anything());
  });

  it("preserves explicit text options for other proactive callers", async () => {
    await sendProactive(config, { userId: "staff-test" }, markdown, { msgType: "text", useAICard: false });
    expect(mocks.createCard).not.toHaveBeenCalled();
    expect(mocks.post.mock.calls[0][1].msgKey).toBe("sampleText");
  });

  it("preserves explicit Markdown and disabled fallback options", async () => {
    await sendProactive(config, { userId: "staff-test" }, "plain", { msgType: "markdown", useAICard: false });
    expect(mocks.post.mock.calls[0][1].msgKey).toBe("sampleMarkdown");
    mocks.post.mockClear();
    const result = await sendProactive(config, { userId: "staff-test" }, markdown, { fallbackToNormal: false });
    expect(result.ok).toBe(false);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("propagates normal-send failure without attempting a second send", async () => {
    mocks.post.mockRejectedValue(new Error("normal send failed"));
    const result = await sendTextToDingTalk({ config, target: "cid-test", text: markdown });
    expect(result).toEqual({ ok: false, error: "normal send failed", usedAICard: false });
    expect(mocks.post).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid target before sending", async () => {
    const result = await sendTextToDingTalk({ config, target: "", text: markdown });
    expect(result.ok).toBe(false);
    expect(mocks.createCard).not.toHaveBeenCalled();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
