import { beforeEach, describe, expect, it, vi } from "vitest";

const mockLogInfo = vi.hoisted(() => vi.fn());

vi.mock("../../src/utils/logger", () => ({
  createLogger: vi.fn(() => ({ info: mockLogInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  createLoggerFromConfig: vi.fn(() => ({ info: mockLogInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

describe("core/provider", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function loadProviderWithMocks(params?: {
    resolvedAccount?: any;
    accounts?: any[];
    abortSignal?: AbortSignal;
  }) {
    const monitorSingleAccount = vi.fn().mockResolvedValue(undefined);
    const handleDingTalkMessage = vi.fn();
    const resolveReactionSyntheticEvent = vi.fn();
    const stopDingtalkMonitorState = vi.fn();

    vi.doMock("../../src/config/accounts", () => ({
      resolveDingtalkAccount: vi.fn().mockReturnValue(
        params?.resolvedAccount ?? {
          accountId: "acc-1",
          enabled: true,
          configured: true,
        },
      ),
      listEnabledDingtalkAccounts: vi.fn().mockReturnValue(
        params?.accounts ?? [{ accountId: "acc-1", enabled: true, configured: true }],
      ),
    }));

    vi.doMock("../../src/core/message-handler", () => ({
      handleDingTalkMessage,
    }));

    vi.doMock("../../src/core/connection", () => ({
      monitorSingleAccount,
      resolveReactionSyntheticEvent,
    }));

    vi.doMock("../../src/core/state", () => ({
      clearDingtalkWebhookRateLimitStateForTest: vi.fn(),
      getDingtalkWebhookRateLimitStateSizeForTest: vi.fn().mockReturnValue(0),
      isWebhookRateLimitedForTest: vi.fn().mockReturnValue(false),
      stopDingtalkMonitorState,
    }));

    const provider = await import("../../src/core/provider");
    return {
      provider,
      monitorSingleAccount,
      handleDingTalkMessage,
      stopDingtalkMonitorState,
    };
  }

  it("throws when config is missing", async () => {
    const { provider } = await loadProviderWithMocks();
    await expect(provider.monitorDingtalkProvider({})).rejects.toThrow(
      "Config is required for DingTalk monitor",
    );
  });

  it("throws for disabled or unconfigured single account", async () => {
    const { provider } = await loadProviderWithMocks({
      resolvedAccount: { accountId: "acc-1", enabled: false, configured: false },
    });

    await expect(
      provider.monitorDingtalkProvider({ config: {} as any, accountId: "acc-1" }),
    ).rejects.toThrow('DingTalk account "acc-1" not configured or disabled');
  });

  it("starts single account monitor with handler", async () => {
    const { provider, monitorSingleAccount, handleDingTalkMessage } = await loadProviderWithMocks();

    await provider.monitorDingtalkProvider({
      config: {} as any,
      accountId: "acc-1",
      runtime: { log: { info: vi.fn() } } as any,
    });

    expect(monitorSingleAccount).toHaveBeenCalledTimes(1);
    expect(monitorSingleAccount.mock.calls[0][0]).toMatchObject({
      account: { accountId: "acc-1", enabled: true, configured: true },
      messageHandler: handleDingTalkMessage,
    });
  });

  it("throws when no enabled account found in multi-account mode", async () => {
    const { provider } = await loadProviderWithMocks({ accounts: [] });
    await expect(provider.monitorDingtalkProvider({ config: {} as any })).rejects.toThrow(
      "No enabled DingTalk accounts configured",
    );
  });

  it("starts all enabled accounts in multi-account mode", async () => {
    const accounts = [
      { accountId: "a-1", enabled: true, configured: true },
      { accountId: "a-2", enabled: true, configured: true },
    ];
    const { provider, monitorSingleAccount } = await loadProviderWithMocks({ accounts });

    await provider.monitorDingtalkProvider({
      config: {} as any,
      runtime: { log: { info: vi.fn() } } as any,
    });

    expect(mockLogInfo).toHaveBeenCalledTimes(1);
    expect(monitorSingleAccount).toHaveBeenCalledTimes(2);
  });

  it("stops startup preflight when abort signal already aborted", async () => {
    const accounts = [{ accountId: "a-1", enabled: true, configured: true }];
    const controller = new AbortController();
    controller.abort();
    const { provider, monitorSingleAccount } = await loadProviderWithMocks({ accounts });

    await provider.monitorDingtalkProvider({
      config: {} as any,
      abortSignal: controller.signal,
      runtime: { log: { info: vi.fn() } } as any,
    });

    expect(mockLogInfo).toHaveBeenCalledTimes(2);
    expect(mockLogInfo.mock.calls[1][0]).toContain("abort signal received during startup preflight");
    expect(monitorSingleAccount).not.toHaveBeenCalled();
  });

  it("delegates stopDingtalkMonitor to state layer", async () => {
    const { provider, stopDingtalkMonitorState } = await loadProviderWithMocks();
    provider.stopDingtalkMonitor("acc-1");
    expect(stopDingtalkMonitorState).toHaveBeenCalledWith("acc-1");
  });
});
