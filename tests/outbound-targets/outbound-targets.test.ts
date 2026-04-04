import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHttpPost = vi.hoisted(() => vi.fn());

vi.mock("../../src/utils/index.ts", () => ({
  DINGTALK_API: "https://api.dingtalk.com",
  getAccessToken: vi.fn().mockResolvedValue("token"),
  getOapiAccessToken: vi.fn().mockResolvedValue("oapi-token"),
}));

vi.mock("../../src/utils/http-client.ts", () => ({
  dingtalkHttp: {
    post: mockHttpPost,
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    defaults: { headers: { common: {} } },
  },
  dingtalkOapiHttp: {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
    defaults: { headers: { common: {} } },
  },
}));

vi.mock("../../src/utils/logger.ts", () => ({
  createLoggerFromConfig: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock("../../src/services/media.ts", () => ({
  processLocalImages: vi.fn(async (content: string) => content),
  processVideoMarkers: vi.fn(async (content: string) => content),
  processAudioMarkers: vi.fn(async (content: string) => content),
  processFileMarkers: vi.fn(async (content: string) => content),
  uploadMediaToDingTalk: vi.fn(),
}));

vi.mock("../../src/services/messaging/card.ts", () => ({
  createAICardForTarget: vi.fn(),
  streamAICard: vi.fn(),
  finishAICard: vi.fn(),
}));

describe("outbound target parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpPost.mockResolvedValue({ status: 200, data: { processQueryKey: "pqk" } });
  });

  it("routes group-prefixed outbound text targets as group messages", async () => {
    const { sendTextToDingTalk } = await import("../../src/services/messaging.ts");

    const result = await sendTextToDingTalk({
      config: { clientId: "test", clientSecret: "secret" } as any,
      target: "group:cid123==",
      text: "hello",
    });

    expect(result.ok).toBe(true);
    expect(mockHttpPost).toHaveBeenCalledWith(
      "https://api.dingtalk.com/v1.0/robot/groupMessages/send",
      expect.objectContaining({
        openConversationId: "cid123==",
      }),
      expect.any(Object),
    );
  });

  it("routes group-prefixed outbound media targets as group messages", async () => {
    const { sendMediaToDingTalk } = await import("../../src/services/messaging.ts");

    const result = await sendMediaToDingTalk({
      config: { clientId: "test", clientSecret: "secret" } as any,
      target: "group:cid456==",
      mediaUrl: "https://example.com/image.png",
      text: "hello",
    });

    expect(result.ok).toBe(true);
    expect(mockHttpPost).toHaveBeenCalledWith(
      "https://api.dingtalk.com/v1.0/robot/groupMessages/send",
      expect.objectContaining({
        openConversationId: "cid456==",
      }),
      expect.any(Object),
    );
  });
});
