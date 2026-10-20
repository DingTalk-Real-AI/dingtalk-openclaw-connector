import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCheckAndMarkDingtalkMessage = vi.hoisted(() => vi.fn());
const mockLoggerInfo = vi.hoisted(() => vi.fn());
const mockLoggerDebug = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());
const mockQuestionCallback = vi.hoisted(() => vi.fn(async (_params: any) => ({ handled: true })));

vi.mock('../../src/questions/index.ts', () => ({ handleDingtalkQuestionCallback: mockQuestionCallback }));

class FakeSocket extends EventEmitter {
  readyState = 1;
  ping = vi.fn();

  closeFromServer(code = 1000) {
    this.readyState = 3;
    this.emit("close", code, Buffer.alloc(0));
  }
}

class FakeDWClient extends EventEmitter {
  static nextConnectError: any = null;
  static latestInstance: FakeDWClient | null = null;
  static replaceSocketOnConnect = false;
  socket = new FakeSocket();
  callback: ((res: any) => Promise<void>) | null = null;
  cardCallback: ((res: any) => Promise<void>) | null = null;
  disconnect = vi.fn(async () => undefined);
  connect = vi.fn(async () => {
    if (FakeDWClient.nextConnectError) {
      const err = FakeDWClient.nextConnectError;
      FakeDWClient.nextConnectError = null;
      throw err;
    }
    if (FakeDWClient.replaceSocketOnConnect) {
      this.socket = new FakeSocket();
    }
    return undefined;
  });
  socketCallBackResponse = vi.fn();
  registerCallbackListener = vi.fn((topic: string, cb: any) => {
    if (topic === 'topic_card') this.cardCallback = cb;
    else this.callback = cb;
  });
  constructor(_: any) {
    super();
    FakeDWClient.latestInstance = this;
  }
}

vi.mock("dingtalk-stream", () => ({
  DWClient: FakeDWClient,
  TOPIC_ROBOT: "topic_robot",
  TOPIC_CARD: "topic_card",
}));

vi.mock("../../src/utils/utils-legacy.ts", () => ({
  checkAndMarkDingtalkMessage: mockCheckAndMarkDingtalkMessage,
}));

vi.mock("../../src/utils/logger.ts", () => ({
  createLoggerFromConfig: () => ({
    info: mockLoggerInfo,
    debug: mockLoggerDebug,
    warn: mockLoggerWarn,
    error: mockLoggerError,
  }),
}));

describe("core/connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeDWClient.nextConnectError = null;
    FakeDWClient.latestInstance = null;
    FakeDWClient.replaceSocketOnConnect = false;
    // 默认首次处理：返回 false（未重复）
    mockCheckAndMarkDingtalkMessage.mockReturnValue(false);
  });

  function createOpts(overrides?: Partial<any>) {
    const account = {
      accountId: "acc-1",
      clientId: "1234567890",
      clientSecret: "abcdefghij",
      config: { debug: false },
    };
    return {
      cfg: {} as any,
      account: { ...account, ...(overrides?.account ?? {}) },
      runtime: {
        log: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      abortSignal: overrides?.abortSignal,
      messageHandler: overrides?.messageHandler ?? vi.fn(async () => undefined),
    };
  }

  it("throws when credentials are missing", async () => {
    const { monitorSingleAccount } = await import("../../src/core/connection");
    await expect(
      monitorSingleAccount(
        createOpts({
          account: { clientId: "", clientSecret: "" },
        }),
      ),
    ).rejects.toThrow("Missing credentials");
  });

  it("throws when credentials format is too short", async () => {
    const { monitorSingleAccount } = await import("../../src/core/connection");
    await expect(
      monitorSingleAccount(
        createOpts({
          account: { clientId: "123", clientSecret: "456" },
        }),
      ),
    ).rejects.toThrow("Invalid credentials format");
  });

  it("handles message callback and resolves on abort", async () => {
    const { monitorSingleAccount } = await import("../../src/core/connection");
    const controller = new AbortController();
    const messageHandler = vi.fn(async () => undefined);

    const running = monitorSingleAccount(
      createOpts({
        abortSignal: controller.signal,
        messageHandler,
      }),
    );

    // DWClient is imported dynamically in connection.ts; allow a few ticks for instantiation.
    let client: FakeDWClient | null = null;
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      client = FakeDWClient.latestInstance;
      if (client) break;
    }
    expect(client).toBeTruthy();

    await client!.callback?.({
      headers: { messageId: "m1" },
      data: JSON.stringify({
        conversationType: "1",
        senderNick: "u",
        senderStaffId: "u1",
        conversationId: "c1",
        msgId: "m1",
        sessionWebhook: "http://webhook",
        text: { content: "hello" },
      }),
    });

    expect(client!.socketCallBackResponse).toHaveBeenCalledWith("m1", { success: true });
    // 协议层去重：首次消息时 checkAndMarkDingtalkMessage 应被调用（传入 accountId + messageId，返回 false）
    expect(mockCheckAndMarkDingtalkMessage).toHaveBeenCalledWith("acc-1", "m1", undefined);    expect(messageHandler).toHaveBeenCalledTimes(1);

    // 模拟重复消息：checkAndMarkDingtalkMessage 返回 true，应跳过处理
    mockCheckAndMarkDingtalkMessage.mockReturnValue(true);
    await client!.callback?.({
      headers: { messageId: "m1" },
      data: JSON.stringify({ sessionWebhook: "http://webhook" }),
    });
    expect(messageHandler).toHaveBeenCalledTimes(1);

    controller.abort();
    await running;
    expect(client!.disconnect).toHaveBeenCalled();
  });

  it('卡片回调先 ACK，再按连接账号续聊，不进入机器人消息处理器', async () => {
    const { monitorSingleAccount } = await import('../../src/core/connection');
    const controller = new AbortController();
    let finish!: () => void;
    mockQuestionCallback.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { finish = resolve; });
      return { handled: true };
    });
    const messageHandler = vi.fn(async () => undefined);
    const running = monitorSingleAccount(createOpts({ abortSignal: controller.signal, messageHandler }));
    try {
      await vi.waitFor(() => expect(FakeDWClient.latestInstance?.cardCallback).toBeTruthy());
      const client = FakeDWClient.latestInstance!;
      const data = { outTrackId: 'dingtalk_question_test', userId: 'u1', content: '{}' };
      const pending = client.cardCallback!({ headers: { messageId: 'card-1' }, data: JSON.stringify(data) });
      expect(client.socketCallBackResponse).toHaveBeenCalledWith('card-1', { success: true });
      expect(mockQuestionCallback).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acc-1', data }));
      expect(messageHandler).not.toHaveBeenCalled();
      finish();
      await pending;
      await client.cardCallback!({ headers: { messageId: 'bad-card' }, data: '{invalid' });
      expect(client.socketCallBackResponse).toHaveBeenCalledWith('bad-card', { success: true });
      expect(mockLoggerWarn).toHaveBeenCalledWith('原生问题卡回调处理失败');
    } finally { finish?.(); controller.abort(); await running; }
  });

  it("keeps the processing heartbeat active until all concurrent messages settle", async () => {
    const realSetInterval = globalThis.setInterval;
    const processingTicks: Array<() => void> = [];
    const intervalSpy = vi
      .spyOn(globalThis, "setInterval")
      .mockImplementation(((handler: TimerHandler, timeout?: number, ...args: any[]) => {
        if (timeout === 15_000 && typeof handler === "function") {
          processingTicks.push(() => handler(...args));
          return { unref: vi.fn() } as unknown as NodeJS.Timeout;
        }
        return realSetInterval(handler, timeout, ...args);
      }) as typeof globalThis.setInterval);
    const controller = new AbortController();
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let handled = 0;
    const messageHandler = vi.fn(async () => {
      handled += 1;
      if (handled === 1) {
        markFirstStarted();
        await firstPending;
      }
    });

    try {
      const { monitorSingleAccount } = await import("../../src/core/connection");
      const running = monitorSingleAccount(
        createOpts({ abortSignal: controller.signal, messageHandler }),
      );
      await vi.waitFor(() => expect(FakeDWClient.latestInstance).toBeTruthy());
      const client = FakeDWClient.latestInstance!;
      const event = (id: string) => ({
        headers: { messageId: id },
        data: JSON.stringify({
          conversationType: "1",
          senderStaffId: "u1",
          conversationId: "c1",
          msgId: id,
          sessionWebhook: "http://webhook",
          text: { content: id },
        }),
      });

      const first = client.callback!(event("m-concurrent-1"));
      await firstStarted;
      await client.callback!(event("m-concurrent-2"));

      mockLoggerDebug.mockClear();
      expect(processingTicks.length).toBeGreaterThan(0);
      processingTicks.at(-1)!();
      expect(mockLoggerDebug).toHaveBeenCalledWith("📝 消息处理中，更新 socket 可用时间");

      releaseFirst();
      await first;
      controller.abort();
      await running;
    } finally {
      releaseFirst?.();
      controller.abort();
      intervalSpy.mockRestore();
    }
  });

  it("rejects (not unhandled) when connect() fails", async () => {
    const { monitorSingleAccount } = await import("../../src/core/connection");
    FakeDWClient.nextConnectError = new Error("connection refused");

    await expect(
      monitorSingleAccount(createOpts()),
    ).rejects.toThrow("Failed to connect to DingTalk Stream: connection refused");
  });

  it("rejects with 400 message when connect() fails with status 400", async () => {
    const { monitorSingleAccount } = await import("../../src/core/connection");
    const err = new Error("Request failed with status code 400");
    (err as any).response = { status: 400, data: { message: "invalid_client" } };
    FakeDWClient.nextConnectError = err;

    await expect(
      monitorSingleAccount(createOpts()),
    ).rejects.toThrow("Bad Request (400)");
  });

  /** 真实 monitor 配合可替换 socket；只手动推进 0ms 重连，不触发心跳兜底。 */
  async function withReconnectProbe(
    action: (probe: {
      client: FakeDWClient;
      controller: AbortController;
      onStatusChange: ReturnType<typeof vi.fn>;
    }) => Promise<void>,
  ) {
    vi.useFakeTimers();
    FakeDWClient.replaceSocketOnConnect = true;
    const controller = new AbortController();
    const onStatusChange = vi.fn();
    const lifecycleEvents = ["exit", "SIGINT", "SIGTERM"] as const;
    const existingListeners = new Map(lifecycleEvents.map((event) => [event, process.listeners(event)]));
    let running: Promise<void> | undefined;
    try {
      const { monitorSingleAccount } = await import("../../src/core/connection");
      running = monitorSingleAccount({
        ...createOpts({ abortSignal: controller.signal }),
        onStatusChange,
      });
      await vi.waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({ connected: true }),
      ));
      onStatusChange.mockClear();
      await action({ client: FakeDWClient.latestInstance!, controller, onStatusChange });
    } finally {
      controller.abort();
      await running;
      // monitor 的进程退出回调和统计定时器不能跨用例残留。
      for (const event of lifecycleEvents) {
        for (const listener of process.listeners(event)) {
          if (!existingListeners.get(event)!.includes(listener)) process.removeListener(event, listener);
        }
      }
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  }

  it("SYSTEM disconnect 重连成功后，旧 socket close 不得关闭新连接或报告离线", async () => {
    await withReconnectProbe(async ({ client, onStatusChange }) => {
      const oldSocket = client.socket;
      oldSocket.emit("message", JSON.stringify({ type: "SYSTEM", headers: { topic: "disconnect" } }));
      await vi.waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(
        expect.objectContaining({ connected: true }),
      ));
      const newSocket = client.socket;
      expect(newSocket).not.toBe(oldSocket);
      expect(newSocket.readyState).toBe(1);
      expect(client.connect).toHaveBeenCalledTimes(2);

      onStatusChange.mockClear();
      client.disconnect.mockClear();
      oldSocket.closeFromServer();
      await vi.advanceTimersByTimeAsync(0);

      expect({
        connects: client.connect.mock.calls.length,
        disconnects: client.disconnect.mock.calls.length,
        retainsNewSocket: client.socket === newSocket,
        statuses: onStatusChange.mock.calls.map(([patch]) => patch.connected),
      }).toEqual({ connects: 2, disconnects: 0, retainsNewSocket: true, statuses: [] });
    });
  });

  it("当前 socket close 已排队后，若执行前连接已替换，旧重连任务不得关闭新 socket", async () => {
    await withReconnectProbe(async ({ client, onStatusChange }) => {
      const oldSocket = client.socket;
      const replacementReady = new Promise<void>((resolve) => {
        onStatusChange.mockImplementation((patch) => {
          if (patch.connected === true) resolve();
        });
      });
      // SYSTEM 启动真实重连，但仍在 await disconnect；同一调用栈里的 close 属于当前 socket。
      oldSocket.emit("message", JSON.stringify({ type: "SYSTEM", headers: { topic: "disconnect" } }));
      expect(client.socket).toBe(oldSocket);
      oldSocket.closeFromServer();
      expect(onStatusChange).toHaveBeenCalledWith({ connected: false });
      expect(client.connect).toHaveBeenCalledTimes(1);

      // 只等待微任务：monitor 已完成替换且 finally 释放重连锁，旧 close 的 0ms timer 还未运行。
      await replacementReady;
      const replacement = client.socket;
      expect(replacement).not.toBe(oldSocket);
      expect(replacement.readyState).toBe(1);
      expect(client.connect).toHaveBeenCalledTimes(2);
      onStatusChange.mockClear();
      client.disconnect.mockClear();
      await vi.advanceTimersByTimeAsync(0);

      expect({
        connects: client.connect.mock.calls.length,
        disconnects: client.disconnect.mock.calls.length,
        retainsReplacement: client.socket === replacement,
        statuses: onStatusChange.mock.calls.map(([patch]) => patch.connected),
      }).toEqual({ connects: 2, disconnects: 0, retainsReplacement: true, statuses: [] });
    });
  });

  it("当前 socket 正常 close 仍报告离线并恰好重连一次", async () => {
    await withReconnectProbe(async ({ client, onStatusChange }) => {
      const oldSocket = client.socket;
      oldSocket.closeFromServer(1012);
      expect(onStatusChange).toHaveBeenCalledWith({ connected: false });
      await vi.advanceTimersByTimeAsync(0);

      expect(client.connect).toHaveBeenCalledTimes(2);
      expect(client.socket).not.toBe(oldSocket);
      expect(client.socket.readyState).toBe(1);
      expect(onStatusChange.mock.calls.map(([patch]) => patch.connected)).toEqual([false, true]);
    });
  });

  it("当前 socket close 已排队后 abort，不得继续重连", async () => {
    await withReconnectProbe(async ({ client, controller, onStatusChange }) => {
      client.socket.closeFromServer();
      expect(onStatusChange).toHaveBeenCalledWith({ connected: false });
      controller.abort();
      await vi.advanceTimersByTimeAsync(0);

      expect(client.connect).toHaveBeenCalledTimes(1);
      expect(client.disconnect).not.toHaveBeenCalled();
      expect(onStatusChange.mock.calls.map(([patch]) => patch.connected)).toEqual([false]);
    });
  });
});
