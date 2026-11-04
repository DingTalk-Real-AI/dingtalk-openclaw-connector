import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetAccessToken, mockPost, mockPut, mockResolveContext } = vi.hoisted(() => ({
  mockGetAccessToken: vi.fn(async () => "test-token"),
  mockPost: vi.fn(),
  mockPut: vi.fn(),
  mockResolveContext: vi.fn(),
}));

vi.mock("../src/utils/token.ts", () => ({ DINGTALK_API: "https://api.dingtalk.com", getAccessToken: mockGetAccessToken }));
vi.mock("../src/utils/http-client.ts", () => ({ dingtalkHttp: { post: mockPost, put: mockPut } }));
vi.mock("../src/questions/context.ts", () => ({
  captureQuestionContext: () => undefined,
  resolveQuestionContext: mockResolveContext,
}));

import {
  DINGTALK_A2UI_BRIDGE_SYMBOL,
  dispatchDingtalkA2uiAction,
  installDingtalkA2UIBridge,
} from "../src/services/card-bridge.ts";

const config = { clientId: "robot-code", clientSecret: "secret" } as any;
function context() {
  return {
    accountId: "main", senderId: "user-1", sessionKey: "session-1", conversationId: "cid-1",
    isDirect: true, config, isCurrent: () => true,
  };
}
function api() {
  return { runtime: { config: { current: () => ({}) } }, logger: {} } as any;
}

describe("DingTalk A2UI bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({ status: 200, data: { success: true, result: { cardInstanceId: "instance-1", deliverResults: [{ success: true }] } } });
    mockPut.mockResolvedValue({ status: 200, data: { success: true } });
    delete (globalThis as any)[DINGTALK_A2UI_BRIDGE_SYMBOL];
  });

  it("sends native A2UI through the current trusted private context and preserves the returned instance", async () => {
    const trusted = context();
    mockResolveContext.mockReturnValue(trusted);
    installDingtalkA2UIBridge(api());
    const bridge = (globalThis as any)[DINGTALK_A2UI_BRIDGE_SYMBOL];
    const safe = bridge.getCurrentContext({ sessionKey: trusted.sessionKey });
    expect(safe).toMatchObject({ accountId: "main", senderId: "user-1", isDirect: true });
    const created = await bridge.createCurrentCard({ context: safe, outTrackId: "track-1", summary: "test", messages: [
      { version: "v1.0", createSurface: { surfaceId: "surface-1", catalogId: "catalog" } },
    ] });
    expect(created).toEqual({ status: "accepted", cardInstanceId: "instance-1" });
    expect(mockPost).toHaveBeenCalledWith("https://api.dingtalk.com/v1.0/card/ai/instances/createAndDeliver", expect.objectContaining({
      outTrackId: "track-1", openSpaceId: "dtv1.card//im_robot.user-1", protocolVersion: "1.0",
      a2uiMessages: [JSON.stringify({ version: "v1.0", createSurface: { surfaceId: "surface-1", catalogId: "catalog" } })],
    }), expect.objectContaining({ maxRedirects: 0 }));
    const updated = await bridge.updateCard({ cardInstanceId: "instance-1", outTrackId: "track-1", outUpdateId: "update-1", status: "FINISH", messages: [
      { version: "v1.0", updateComponents: { surfaceId: "surface-1", components: [] } },
    ] });
    expect(updated).toEqual({ status: "accepted" });
    expect(mockPut).toHaveBeenCalledWith("https://api.dingtalk.com/v1.0/card/ai/instances/update", expect.objectContaining({
      outTrackId: "track-1", outUpdateId: "update-1", flowStatus: "FINISH",
    }), expect.any(Object));
  });

  it("rejects caller-forged context and updates to an unbound or different card", async () => {
    const trusted = context();
    mockResolveContext.mockReturnValue(trusted);
    installDingtalkA2UIBridge(api());
    const bridge = (globalThis as any)[DINGTALK_A2UI_BRIDGE_SYMBOL];
    const safe = bridge.getCurrentContext({});
    expect((await bridge.createCurrentCard({ context: { ...safe }, outTrackId: "track-x", summary: "x", messages: [{}] })).status).toBe("failed");
    expect((await bridge.updateCard({ cardInstanceId: "wrong", outTrackId: "track-x", outUpdateId: "u", status: "FINISH", messages: [{}] })).status).toBe("failed");
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("routes callback identity only when the Stream account, user, and card mapping agree", async () => {
    const trusted = context();
    mockResolveContext.mockReturnValue(trusted);
    installDingtalkA2UIBridge(api());
    const bridge = (globalThis as any)[DINGTALK_A2UI_BRIDGE_SYMBOL];
    const safe = bridge.getCurrentContext({});
    await bridge.createCurrentCard({ context: safe, outTrackId: "track-1", summary: "test", messages: [{ version: "v1.0" }] });
    const handler = vi.fn();
    bridge.onCardAction(handler);
    dispatchDingtalkA2uiAction({ accountId: "main", senderId: "user-1", messageId: "m1", outTrackId: "track-1", data: {} });
    await Promise.resolve();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ cardInstanceId: "instance-1", trustedContext: expect.objectContaining({
      accountId: trusted.accountId, senderId: trusted.senderId, sessionKey: trusted.sessionKey,
      robotCode: trusted.config.clientId,
    }) }));
    dispatchDingtalkA2uiAction({ accountId: "other", senderId: "user-1", messageId: "m2", outTrackId: "track-1", data: {} });
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("expires private A2UI card mappings and refuses late updates", async () => {
    const trusted = context();
    mockResolveContext.mockReturnValue(trusted);
    installDingtalkA2UIBridge(api());
    const bridge = (globalThis as any)[DINGTALK_A2UI_BRIDGE_SYMBOL];
    const safe = bridge.getCurrentContext({});
    await bridge.createCurrentCard({ context: safe, outTrackId: "track-expiring", summary: "test", messages: [{ version: "v1.0" }] });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 31 * 60 * 1000);
      const updated = await bridge.updateCard({ cardInstanceId: "instance-1", outTrackId: "track-expiring", outUpdateId: "late", status: "FINISH", messages: [{ version: "v1.0" }] });
      expect(updated).toEqual({ status: "failed" });
      expect(mockPut).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
