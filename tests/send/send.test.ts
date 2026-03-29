import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAxiosPost = vi.hoisted(() => vi.fn());
const mockGetAccessToken = vi.hoisted(() => vi.fn());

vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } })),
    post: mockAxiosPost,
  },
}));

vi.mock('../../src/utils/http-client.ts', () => ({
  dingtalkHttp: { post: mockAxiosPost, get: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
  dingtalkOapiHttp: { get: vi.fn(), post: mockAxiosPost, put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
  dingtalkUploadHttp: { post: mockAxiosPost, get: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
}));

vi.mock("../../src/utils/token.ts", () => ({
  DINGTALK_API: "https://api.dingtalk.com",
  getAccessToken: mockGetAccessToken,
}));

describe("services/messaging/send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue("tk");
    mockAxiosPost.mockResolvedValue({ data: { ok: true } });
  });

  it("sendMarkdownMessage sends markdown body and optional @", async () => {
    const { sendMarkdownMessage } = await import("../../src/services/messaging/send");
    await sendMarkdownMessage({} as any, "http://webhook", "title", "md");
    expect(mockAxiosPost).toHaveBeenCalledTimes(1);
    expect(mockAxiosPost.mock.calls[0][1]).toMatchObject({
      msgtype: "markdown",
      markdown: { title: "title", text: "md" },
    });

    mockAxiosPost.mockClear();
    await sendMarkdownMessage({} as any, "http://webhook", "title", "md", { atUserId: "u1" });
    expect(mockAxiosPost.mock.calls[0][1]).toMatchObject({
      at: { userIds: ["u1"], isAtAll: false },
    });
  });

  it("sendTextMessage sends text body and optional @", async () => {
    const { sendTextMessage } = await import("../../src/services/messaging/send");
    await sendTextMessage({} as any, "http://webhook", "hello");
    expect(mockAxiosPost.mock.calls[0][1]).toMatchObject({
      msgtype: "text",
      text: { content: "hello" },
    });

    mockAxiosPost.mockClear();
    await sendTextMessage({} as any, "http://webhook", "hello", { atUserId: "u2" });
    expect(mockAxiosPost.mock.calls[0][1].text.content).toContain("@u2");
  });

  it("sendLinkMessage sends link body", async () => {
    const { sendLinkMessage } = await import("../../src/services/messaging/send");
    await sendLinkMessage({} as any, "http://webhook", {
      title: "t",
      text: "c",
      picUrl: "p",
      messageUrl: "m",
    });
    expect(mockAxiosPost.mock.calls[0][1]).toEqual({
      msgtype: "link",
      link: {
        title: "t",
        text: "c",
        picUrl: "p",
        messageUrl: "m",
      },
    });
  });
});
