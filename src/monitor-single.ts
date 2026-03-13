/**
 * 钉钉单账号监控模块
 * 独立于 monitor.account.ts，避免循环依赖
 */

console.log('='.repeat(60));
console.log('[monitor-single.ts] 模块开始加载');
console.log('[monitor-single.ts] 当前 globalMessageHandler 初始值:', null);
console.log('='.repeat(60));

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
}) => Promise<void>;

// ============ 监控账号 ============

export async function monitorSingleAccount(opts: MonitorDingtalkAccountOpts): Promise<void> {
  const { cfg, account, runtime, abortSignal, messageHandler } = opts;
  const { accountId } = account;
  const log = runtime?.log ?? console.log;

  if (!account.clientId || !account.clientSecret) {
    throw new Error(`DingTalk account "${accountId}" missing credentials`);
  }

  log(`[DingTalk][${accountId}] Starting DingTalk Stream client...`);
  log(`[DingTalk][${accountId}] 消息处理器：${typeof messageHandler === 'function' ? '已传入 ✓' : '未传入 ✗'}`);

  // 动态导入 dingtalk-stream 模块，避免动态导入场景下的导出问题
  log(`[DingTalk][${accountId}] 开始动态导入 dingtalk-stream 模块...`);
  const dingtalkStreamModule = await import('dingtalk-stream');
  log(`[DingTalk][${accountId}] dingtalk-stream 模块导入完成，keys:`, Object.keys(dingtalkStreamModule).join(', '));
  
  const DWClient = dingtalkStreamModule.DWClient ?? dingtalkStreamModule.default?.DWClient;
  log(`[DingTalk][${accountId}] DWClient 获取结果：`, DWClient ? '成功 ✓' : '失败 ✗');
  
  if (!DWClient) {
    throw new Error('Failed to import DWClient from dingtalk-stream module');
  }

  log(`[DingTalk][${accountId}] 创建 DWClient 实例...`);
  log(`[DingTalk][${accountId}] 使用网关地址：${GATEWAY_URL}`);
  const client = new DWClient({
    clientId: account.clientId,
    clientSecret: account.clientSecret,
    debug: true, // 启用调试模式，查看详细连接日志
    autoReconnect: true, // 启用自动重连
    keepAlive: true, // 启用心跳机制
  } as any);
  log(`[DingTalk][${accountId}] DWClient 实例创建完成`);

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
    console.log(`[DingTalk][${accountId}] 注册消息监听器...`);
    client.registerCallbackListener(TOPIC_ROBOT, async (res: any) => {
      const messageId = res.headers?.messageId;
      console.log(`[DingTalk][${accountId}] 收到 Stream 回调，messageId=${messageId}, hasData=${!!res.data}`);

      // 立即确认回调
      if (messageId) {
        client.socketCallBackResponse(messageId, { success: true });
        console.log(`[DingTalk][${accountId}] 已立即确认回调：messageId=${messageId}`);
      }

      // 消息去重
      if (messageId && isMessageProcessed(messageId)) {
        console.warn(`[DingTalk][${accountId}] 检测到重复消息，跳过处理：messageId=${messageId}`);
        return;
      }

      if (messageId) {
        markMessageProcessed(messageId);
      }

      // 异步处理消息
      try {
        const data = JSON.parse(res.data);
        console.log(`[DingTalk][${accountId}] 开始处理消息：accountId=${accountId}, hasConfig=${!!account.config}, dataKeys=${Object.keys(data).join(',')}`);
        
        await messageHandler({
          accountId,
          config: account.config,
          data,
          sessionWebhook: data.sessionWebhook,
          runtime,
          log,
        });
        
        console.log(`[DingTalk][${accountId}] 消息处理完成`);
      } catch (error: any) {
        console.error(`[DingTalk][${accountId}] 处理消息异常：${error.message}\n${error.stack}`);
      }
    });
    console.log(`[DingTalk][${accountId}] 消息监听器注册完成`);

    // Connect to DingTalk Stream (同步等待，和老版本一致)
    await client.connect();
    log(`[DingTalk][${accountId}] 钉钉 Stream 客户端已连接`);

    // Handle disconnection
    client.on('close', () => {
      log(`[DingTalk][${accountId}] Connection closed`);
      resolve();
    });

    client.on('error', (err: Error) => {
      log(`[DingTalk][${accountId}] Connection error: ${err.message}`);
      reject(err);
    });
  });
}

export function resolveReactionSyntheticEvent(
  event: any,
): DingtalkReactionCreatedEvent | null {
  // DingTalk doesn't support reactions in the same way as Feishu
  return null;
}

console.log('[monitor-single.ts] 模块加载完成，monitorSingleAccount 已导出');
