/**
 * 钉钉单账号监控模块
 * 独立于 monitor.account.ts，避免循环依赖
 */



import type { ClawdbotConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import type { ResolvedDingtalkAccount } from "./types";
import { TOPIC_ROBOT, GATEWAY_URL } from 'dingtalk-stream';

// ============ 消息去重（内置，避免循环依赖） ============

/** 消息去重缓存 Map<messageId, timestamp> */
const processedMessages = new Map<string, number>();

/** 消息去重缓存过期时间（5 分钟） */
const MESSAGE_DEDUP_TTL = 5 * 60 * 1000;

/** 清理过期的消息去重缓存 */
function cleanupProcessedMessages(): void {
  const now = Date.now();
  for (const [msgId, timestamp] of processedMessages.entries()) {
    if (now - timestamp > MESSAGE_DEDUP_TTL) {
      processedMessages.delete(msgId);
    }
  }
}

/** 检查消息是否已处理过（去重） */
function isMessageProcessed(messageId: string): boolean {
  if (!messageId) return false;
  return processedMessages.has(messageId);
}

/** 标记消息为已处理 */
function markMessageProcessed(messageId: string): void {
  if (!messageId) return;
  processedMessages.set(messageId, Date.now());
  // 定期清理（每处理 100 条消息清理一次）
  if (processedMessages.size >= 100) {
    cleanupProcessedMessages();
  }
}

// ============ 类型定义 ============

export type DingtalkReactionCreatedEvent = {
  type: "reaction_created";
  channelId: string;
  messageId: string;
  userId: string;
  emoji: string;
};

export type MonitorDingtalkAccountOpts = {
  cfg: ClawdbotConfig;
  account: ResolvedDingtalkAccount;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  messageHandler: MessageHandler; // 直接传入消息处理器
};

// 消息处理器函数类型
export type MessageHandler = (params: {
  accountId: string;
  config: any;
  data: any;
  sessionWebhook: string;
  runtime?: RuntimeEnv;
  log?: any;
  cfg: ClawdbotConfig;
}) => Promise<void>;

// ============ 监控账号 ============

export async function monitorSingleAccount(opts: MonitorDingtalkAccountOpts): Promise<void> {
  const { cfg, account, runtime, abortSignal, messageHandler } = opts;
  const { accountId } = account;
  
  // 保存 cfg 以便传递给 messageHandler
  const clawdbotConfig = cfg;
  const log = runtime?.log ?? console.log;

  // 验证凭据是否存在
  if (!account.clientId || !account.clientSecret) {
    throw new Error(
      `[DingTalk][${accountId}] Missing credentials: ` +
      `clientId=${!!account.clientId ? 'present' : 'MISSING'}, ` +
      `clientSecret=${!!account.clientSecret ? 'present' : 'MISSING'}. ` +
      `Please check your configuration in channels.dingtalk-connector.`
    );
  }

  // 验证凭据格式
  const clientIdStr = String(account.clientId);
  const clientSecretStr = String(account.clientSecret);
  
  if (clientIdStr.length < 10 || clientSecretStr.length < 10) {
    throw new Error(
      `[DingTalk][${accountId}] Invalid credentials format: ` +
      `clientId length=${clientIdStr.length}, clientSecret length=${clientSecretStr.length}. ` +
      `Credentials appear to be too short or invalid.`
    );
  }

  log(`[DingTalk][${accountId}] Starting DingTalk Stream client...`);
  log?.info?.(
    `[DingTalk][${accountId}] Initializing with clientId: ${clientIdStr.substring(0, 8)}...`
  );
  log?.info?.(
    `[DingTalk][${accountId}] WebSocket keepAlive: interval=30s, timeout=15s`
  );

  // 动态导入 dingtalk-stream 模块
  const dingtalkStreamModule = await import('dingtalk-stream');
  const DWClient = dingtalkStreamModule.DWClient ?? dingtalkStreamModule.default?.DWClient;
  
  if (!DWClient) {
    throw new Error('Failed to import DWClient from dingtalk-stream module');
  }
  
  const client = new DWClient({
    clientId: account.clientId,
    clientSecret: account.clientSecret,
    debug: false,
    autoReconnect: true,
    keepAlive: true,
    keepAliveInterval: 30000,  // 心跳间隔 30 秒
    keepAliveTimeout: 15000,   // 心跳超时 15 秒（增加到 15 秒，更宽容）
  } as any);

  return new Promise<void>(async (resolve, reject) => {
    // Handle abort signal
    if (abortSignal) {
      const onAbort = () => {
        log(`[DingTalk][${accountId}] Abort signal received, stopping...`);
        client.disconnect();
        resolve();
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    // Register message handler
    client.registerCallbackListener(TOPIC_ROBOT, async (res: any) => {
      const messageId = res.headers?.messageId;

      // 立即确认回调
      if (messageId) {
        client.socketCallBackResponse(messageId, { success: true });
      }

      // 消息去重
      if (messageId && isMessageProcessed(messageId)) {
        log?.warn?.(`[DingTalk][${accountId}] Duplicate message skipped: ${messageId}`);
        return;
      }

      if (messageId) {
        markMessageProcessed(messageId);
      }

      // 异步处理消息
      try {
        const data = JSON.parse(res.data);
        
        await messageHandler({
          accountId,
          config: account.config,
          data,
          sessionWebhook: data.sessionWebhook,
          runtime,
          log,
          cfg: clawdbotConfig,
        });
      } catch (error: any) {
        log?.error?.(`[DingTalk][${accountId}] Message processing error: ${error.message}`);
      }
    });

    // Connect to DingTalk Stream
    try {
      await client.connect();
      log(`[DingTalk][${accountId}] Connected to DingTalk Stream successfully`);
    } catch (error: any) {
      // 处理 401 认证错误
      if (error.response?.status === 401 || error.message?.includes('401')) {
        throw new Error(
          `[DingTalk][${accountId}] Authentication failed (401 Unauthorized):\n` +
          `  - Your clientId or clientSecret is invalid, expired, or revoked\n` +
          `  - clientId: ${clientIdStr.substring(0, 8)}...\n` +
          `  - Please verify your credentials at DingTalk Developer Console\n` +
          `  - Error details: ${error.message}`
        );
      }
      
      // 处理其他连接错误
      throw new Error(
        `[DingTalk][${accountId}] Failed to connect to DingTalk Stream: ${error.message}`
      );
    }

    // 连接状态追踪
    let connectionStartTime = Date.now();
    let reconnectCount = 0;

    // Handle disconnection
    client.on('close', () => {
      const connectionDuration = Date.now() - connectionStartTime;
      log?.info?.(`[DingTalk][${accountId}] Connection closed after ${Math.round(connectionDuration / 1000)}s, will auto-reconnect...`);
    });

    client.on('error', (err: Error) => {
      log?.error?.(`[DingTalk][${accountId}] Connection error: ${err.message}`);
    });

    // 监听重连事件（如果 SDK 支持）
    client.on('reconnect', () => {
      reconnectCount++;
      connectionStartTime = Date.now();
      log?.info?.(`[DingTalk][${accountId}] Reconnecting... (attempt ${reconnectCount})`);
    });

    client.on('reconnected', () => {
      log?.info?.(`[DingTalk][${accountId}] Reconnected successfully after ${reconnectCount} attempts`);
    });
  });
}

export function resolveReactionSyntheticEvent(
  event: any,
): DingtalkReactionCreatedEvent | null {
  // DingTalk doesn't support reactions in the same way as Feishu
  return null;
}


