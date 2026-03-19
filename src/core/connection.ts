/**
 * 钉钉 WebSocket 连接层
 *
 * 职责：
 * - 管理单个钉钉账号的 WebSocket 连接
 * - 实现应用层心跳检测（10 秒间隔，90 秒超时）
 * - 处理连接重连逻辑，带指数退避
 * - 消息去重（内置 Map，5 分钟 TTL）
 *
 * 核心特性：
 * - 关闭 SDK 内置 keepAlive，使用自定义心跳
 * - 详细的消息接收日志（三阶段：接收、解析、处理）
 * - 连接统计和监控（每分钟输出）
 */
import type { ClawdbotConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import type { MonitorDingtalkAccountOpts, ResolvedDingtalkAccount } from "../types/index.ts";
import {
  isMessageProcessed,
  markMessageProcessed,
} from "../utils/utils-legacy.ts";
import { createLoggerFromConfig } from "../utils/logger.ts";

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

// ============ 连接配置 ============

/** 心跳间隔（毫秒） */
const HEARTBEAT_INTERVAL = 10 * 1000; // 10 秒
/** 超时阈值（毫秒） */
const TIMEOUT_THRESHOLD = 90 * 1000; // 90 秒
/** 基础退避时间（毫秒） */
const BASE_BACKOFF_DELAY = 1000; // 1 秒
/** 最大退避时间（毫秒） */
const MAX_BACKOFF_DELAY = 30 * 1000; // 30 秒

// ============ 监控账号 ============

export async function monitorSingleAccount(
  opts: MonitorDingtalkAccountOpts,
): Promise<void> {
  const { cfg, account, runtime, abortSignal, messageHandler } = opts;
  const { accountId } = account;

  // 保存 cfg 以便传递给 messageHandler
  const clawdbotConfig = cfg;
  const log = runtime?.log;
  
  // 创建 debug logger（仅在 debug 模式下输出 info/debug 日志）
  const logger = createLoggerFromConfig(account.config, `DingTalk:${accountId}`);

  // 验证凭据是否存在
  if (!account.clientId || !account.clientSecret) {
    throw new Error(
      `[DingTalk][${accountId}] Missing credentials: ` +
        `clientId=${account.clientId ? "present" : "MISSING"}, ` +
        `clientSecret=${account.clientSecret ? "present" : "MISSING"}. ` +
        `Please check your configuration in channels.dingtalk-connector.`,
    );
  }

  // 验证凭据格式
  const clientIdStr = String(account.clientId);
  const clientSecretStr = String(account.clientSecret);

  if (clientIdStr.length < 10 || clientSecretStr.length < 10) {
    throw new Error(
      `[DingTalk][${accountId}] Invalid credentials format: ` +
        `clientId length=${clientIdStr.length}, clientSecret length=${clientSecretStr.length}. ` +
        `Credentials appear to be too short or invalid.`,
    );
  }

  logger.info(`Starting DingTalk Stream client...`);
  logger.info(`Initializing with clientId: ${clientIdStr.substring(0, 8)}...`);
  logger.info(`WebSocket keepAlive: false (using application-layer heartbeat)`);

  // 动态导入 dingtalk-stream 模块（避免循环依赖和 ESM/CJS 兼容性问题）
  const dingtalkStreamModule = await import("dingtalk-stream");
  const DWClient = dingtalkStreamModule.DWClient;
  const { TOPIC_ROBOT } = dingtalkStreamModule;

  if (!DWClient) {
    throw new Error("Failed to import DWClient from dingtalk-stream module");
  }

  // 配置 DWClient：禁用 SDK 内置的 keepAlive 和 autoReconnect，使用自定义实现
  const client = new DWClient({
    clientId: account.clientId,
    clientSecret: account.clientSecret,
    debug: account.config.debug,
    endpoint: account.config.endpoint,
    autoReconnect: false, // ❌ 禁用 SDK 自动重连
    keepAlive: false, // ❌ 禁用 SDK 心跳检测
  } as any);

  // ============ 连接状态管理 ============

  let lastSocketAvailableTime = Date.now();
  let isReconnecting = false;
  let reconnectAttempts = 0;
  let keepAliveTimer: NodeJS.Timeout | null = null;
  let isStopped = false;

  // ============ 辅助函数 ============

  /** 计算指数退避延迟（带抖动） */
  function calculateBackoffDelay(attempt: number): number {
    const exponentialDelay = BASE_BACKOFF_DELAY * Math.pow(2, attempt);
    const jitter = Math.random() * 1000; // 0-1 秒随机抖动
    return Math.min(exponentialDelay + jitter, MAX_BACKOFF_DELAY);
  }

  /** 统一重连函数，带指数退避（无限重连） */
  async function doReconnect(immediate = false) {
    if (isReconnecting || isStopped) {
      logger.debug(`正在重连中或已停止，跳过`);
      return;
    }

    isReconnecting = true;

    // 应用指数退避（非立即重连时）
    if (!immediate && reconnectAttempts > 0) {
      const delay = calculateBackoffDelay(reconnectAttempts);
      logger.info(
        `⏳ 等待 ${Math.round(delay / 1000)} 秒后重连 (尝试 ${reconnectAttempts + 1})`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    try {
      // 1. 先断开旧连接（检查 WebSocket 状态）
      if (client.socket?.readyState === 1 || client.socket?.readyState === 3) {
        await client.disconnect();
        logger.info(`已断开旧连接`);
      }

      // 2. 重新建立连接
      await client.connect();

      // 3. 重置 socket 可用时间和重连计数
      lastSocketAvailableTime = Date.now();
      reconnectAttempts = 0; // 重连成功，重置计数

      logger.info(`✅ 重连成功`);
    } catch (err: any) {
      reconnectAttempts++;
      log?.error?.(
        `重连失败：${err.message} (尝试 ${reconnectAttempts})`,
      );
      throw err;
    } finally {
      isReconnecting = false;
    }
  }

  /** 监听 pong 响应（更新 socket 可用时间） */
  function setupPongListener() {
    client.socket?.on("pong", () => {
      lastSocketAvailableTime = Date.now();
      logger.debug(`收到 PONG 响应`);
    });
  }

  /** 监听 WebSocket message 事件，收到 disconnect 消息时立即触发重连 */
  function setupMessageListener() {
    client.socket?.on("message", (data: any) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "SYSTEM" && msg.headers?.topic === "disconnect") {
          if (!isStopped && !isReconnecting) {
            // 立即重连，不退避
            doReconnect(true).catch((err) => {
              log?.error?.(`[${accountId}] 重连失败：${err.message}`);
            });
          }
        }
      } catch (e) {
        // 忽略解析错误
      }
    });
  }

  /** 监听 WebSocket close 事件，服务端主动断开时立即触发重连 */
  function setupCloseListener() {
    client.socket?.on("close", (code, reason) => {
      logger.info(
        `WebSocket close: code=${code}, reason=${reason || "未知"}, isStopped=${isStopped}`,
      );

      if (isStopped) {
        return;
      }

      // 立即重连，不退避
      setTimeout(() => {
        doReconnect(true).catch((err) => {
          log?.error?.(`重连失败：${err.message}`);
        });
      }, 0);
    });
  }

  /**
   * 启动 keepAlive 机制（单定时器 + 指数退避）
   *
   * 业界最佳实践：
   * - 单定时器：每 10 秒检查一次，同时完成心跳和超时检测
   * - 使用 WebSocket 原生 Ping
   * - 指数退避重连：避免雪崩效应
   */
  function startKeepAlive(): () => void {
    logger.debug(
      `🚀 启动 keepAlive 定时器，间隔=${HEARTBEAT_INTERVAL / 1000}秒`,
    );

    keepAliveTimer = setInterval(async () => {
      if (isStopped) {
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        return;
      }

      try {
        const elapsed = Date.now() - lastSocketAvailableTime;

        // 【超时检测】超过 90 秒未确认 socket 可用，触发重连
        if (elapsed > TIMEOUT_THRESHOLD) {
          logger.info(
            `⚠️ 超时检测：已 ${Math.round(elapsed / 1000)} 秒未确认 socket 可用，触发重连...`,
          );
          await doReconnect();
          return;
        }

        // 【心跳检测】检查 socket 状态
        const socketState = client.socket?.readyState;
        logger.debug(
          `🔍 心跳检测：socket 状态=${socketState}, elapsed=${Math.round(elapsed / 1000)}s`,
        );

        if (socketState !== 1) {
          logger.info(
            `⚠️ 心跳检测：socket 状态=${socketState}，触发重连...`,
          );
          await doReconnect(true); // 立即重连，不退避
          return;
        }

        // 【发送原生 Ping】更新可用时间
        try {
          client.socket?.ping();
          lastSocketAvailableTime = Date.now();
          logger.debug(`💓 发送 PING 心跳成功`);
        } catch (err: any) {
          log?.warn?.(`发送 PING 失败：${err.message}`);
          // 发送失败也计入超时
        }
      } catch (err: any) {
        log?.error?.(`keepAlive 检测失败：${err.message}`);
      }
    }, HEARTBEAT_INTERVAL); // 每 10 秒检测一次

    logger.debug(`✅ keepAlive 定时器已启动`);

    // 返回清理函数
    return () => {
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      keepAliveTimer = null;
      logger.debug(`keepAlive 定时器已清理`);
    };
  }

  /** 停止并清理所有资源 */
  function stop() {
    isStopped = true;

    // 清理定时器
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = null;

    // 清理事件监听器
    if (client.socket) {
      client.socket.removeAllListeners();
    }

    logger.debug(`Connection 已停止`);
  }

  // 初始化：设置所有事件监听器
  setupPongListener();
  setupMessageListener();
  setupCloseListener();

  return new Promise<void>(async (resolve, reject) => {
    // Handle abort signal
    if (abortSignal) {
      const onAbort = async () => {
        logger.info(`Abort signal received, stopping...`);
        stop();
        try {
          // 只在连接已建立时才断开
          if (client.socket && client.socket.readyState === 1) {
            await client.disconnect();
          }
        } catch (err: any) {
          log?.warn?.(`断开连接时出错：${err.message}`);
        }
        resolve();
      };
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    // 消息接收统计（用于检测消息丢失）
    let receivedCount = 0;
    let processedCount = 0;
    let lastMessageTime = Date.now();

    // 定期输出统计信息
    const statsInterval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastMessage = Math.round((now - lastMessageTime) / 1000);
      logger.info(
        `统计：收到=${receivedCount}, 处理=${processedCount}, ` +
          `丢失=${receivedCount - processedCount}, 距上次消息=${timeSinceLastMessage}s`,
      );
    }, 60000); // 每分钟输出一次

    // Register message handler
    client.registerCallbackListener(TOPIC_ROBOT, async (res: any) => {
      receivedCount++;
      lastMessageTime = Date.now();
      const messageId = res.headers?.messageId;
      const timestamp = new Date().toISOString();

      // ===== 第一步：记录原始消息接收 =====
      logger.info(`\n========== 收到新消息 ==========`);
      logger.info(`时间：${timestamp}`);
      logger.info(`MessageId: ${messageId || "N/A"}`);
      logger.info(`Headers: ${JSON.stringify(res.headers || {})}`);
      logger.info(`Data 长度：${res.data?.length || 0} 字符`);

      // 立即确认回调
      if (messageId) {
        client.socketCallBackResponse(messageId, { success: true });
        logger.info(`✅ 已立即确认回调：messageId=${messageId}`);
      } else {
        log?.warn?.(`⚠️ 警告：消息没有 messageId`);
      }

      // 消息去重
      if (messageId && isMessageProcessed(messageId)) {
        log?.warn?.(`⚠️ 检测到重复消息，跳过处理：messageId=${messageId}`);
        logger.info(`========== 消息处理结束（重复） ==========\n`);
        return;
      }

      if (messageId) {
        markMessageProcessed(messageId);
        logger.info(`标记消息为已处理：messageId=${messageId}`);
      }

      // 异步处理消息
      try {
        // 解析消息数据
        const data = JSON.parse(res.data);

        // ===== 第二步：记录解析后的消息详情 =====
        logger.info(`\n----- 消息详情 -----`);
        logger.info(`消息类型：${data.msgtype || "unknown"}`);
        logger.info(
          `会话类型：${data.conversationType === "1" ? "DM (单聊)" : data.conversationType === "2" ? "Group (群聊)" : data.conversationType}`,
        );
        logger.info(
          `发送者：${data.senderNick || "unknown"} (${data.senderStaffId || data.senderId || "unknown"})`,
        );
        logger.info(`会话 ID: ${data.conversationId || "N/A"}`);
        logger.info(`消息 ID: ${data.msgId || "N/A"}`);
        logger.info(
          `SessionWebhook: ${data.sessionWebhook ? "已提供" : "未提供"}`,
        );
        logger.info(
          `RobotCode: ${data.robotCode || account.config?.clientId || "N/A"}`,
        );

        // 记录消息内容（简化版，避免过长）
        let contentPreview = "N/A";
        if (data.text?.content) {
          contentPreview =
            data.text.content.length > 100
              ? data.text.content.substring(0, 100) + "..."
              : data.text.content;
        } else if (data.content) {
          contentPreview =
            JSON.stringify(data.content).substring(0, 100) + "...";
        }
        logger.info(`消息内容预览：${contentPreview}`);
        logger.info(`完整数据字段：${Object.keys(data).join(", ")}`);
        logger.info(`----- 消息详情结束 -----\n`);

        // ===== 第三步：开始处理消息 =====
        logger.info(`🚀 开始处理消息...`);
        logger.info(`AccountId: ${accountId}`);
        logger.info(`HasConfig: ${!!account.config}`);

        await messageHandler({
          accountId,
          config: account.config,
          data,
          sessionWebhook: data.sessionWebhook,
          runtime,
          log,
          cfg: clawdbotConfig,
        });

        processedCount++;
        logger.info(`✅ 消息处理完成 (${processedCount}/${receivedCount})`);
        logger.info(`========== 消息处理结束（成功） ==========\n`);
      } catch (error: any) {
        processedCount++;
        log?.error?.(
          `❌ 处理消息异常 (${processedCount}/${receivedCount}):`,
        );
        log?.error?.(`错误类型：${error.name || "Error"}`);
        log?.error?.(`错误信息：${error.message}`);
        log?.error?.(`错误堆栈:\n${error.stack}`);
        logger.info(`========== 消息处理结束（失败） ==========\n`);
      }
    });

    // 清理定时器
    const cleanup = () => {
      clearInterval(statsInterval);
      stop();
    };

    // Connect to DingTalk Stream
    try {
      await client.connect();
      logger.info(`Connected to DingTalk Stream successfully`);
      logger.info(`PID: ${process.pid}`);
      logger.info(
        `✅ 自定义 keepAlive: true (10 秒心跳，90 秒超时), 指数退避重连`,
      );

      // 启动自定义心跳检测
      const cleanupKeepAlive = startKeepAlive();

      // 重写 cleanup 函数，包含 keepAlive 清理
      const enhancedCleanup = () => {
        cleanupKeepAlive();
        clearInterval(statsInterval);
        stop();
      };

      // 进程退出时清理
      process.on("exit", enhancedCleanup);
      process.on("SIGINT", enhancedCleanup);
      process.on("SIGTERM", enhancedCleanup);
    } catch (error: any) {
      cleanup(); // 连接失败时清理资源

      // 处理 401 认证错误
      if (error.response?.status === 401 || error.message?.includes("401")) {
        throw new Error(
          `[DingTalk][${accountId}] Authentication failed (401 Unauthorized):\n` +
            `  - Your clientId or clientSecret is invalid, expired, or revoked\n` +
            `  - clientId: ${clientIdStr.substring(0, 8)}...\n` +
            `  - Please verify your credentials at DingTalk Developer Console\n` +
            `  - Error details: ${error.message}`,
        );
      }

      // 处理其他连接错误
      throw new Error(
        `[DingTalk][${accountId}] Failed to connect to DingTalk Stream: ${error.message}`,
      );
    }

    // Handle disconnection（已被自定义 close 监听器替代）
    // client.on('close', ...) - 已移除，使用 setupCloseListener

    client.on("error", (err: Error) => {
      log?.error?.(`Connection error: ${err.message}`);
    });

    // 监听重连事件（仅用于日志，实际重连由自定义逻辑处理）
    client.on("reconnect", () => {
      logger.info(`SDK reconnecting...`);
    });

    client.on("reconnected", () => {
      logger.info(`✅ SDK reconnected successfully`);
    });
  });
}

export function resolveReactionSyntheticEvent(
  event: any,
): DingtalkReactionCreatedEvent | null {
  void event;
  return null;
}
