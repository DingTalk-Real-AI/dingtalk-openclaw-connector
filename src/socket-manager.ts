/**
 * DingTalk WebSocket Socket 管理器
 * 
 * 负责管理 DingTalk Stream 客户端的 WebSocket 连接、心跳检测、自动重连等生命周期
 */

import type { DWClient } from 'dingtalk-stream';

export interface SocketManagerOptions {
  accountId: string;
  log?: any;
  stopped: () => boolean;
  onReconnect?: () => void;
  pendingAckQueue?: Set<string>;  // 待确认消息队列
  client?: any;  // DWClient 实例，用于批量确认消息
  debug?: boolean;  // 是否开启 debug 日志
}

export interface SocketManagerConfig {
  /** 心跳间隔（毫秒） */
  heartbeatInterval: number;
  /** 超时阈值（毫秒） */
  timeoutThreshold: number;
  /** 基础退避时间（毫秒） */
  baseBackoffDelay: number;
  /** 最大退避时间（毫秒） */
  maxBackoffDelay: number;
}

export interface SocketManager {
  /** 启动 keepAlive 机制，返回清理函数 */
  startKeepAlive: () => () => void;
  /** 停止并清理所有资源 */
  stop: () => void;
}

/**
 * 创建 Socket 管理器
 * 
 * @param client - DingTalk Stream 客户端实例
 * @param options - 配置选项
 * @returns SocketManager 实例
 */
export function createSocketManager(
  client: DWClient,
  options: SocketManagerOptions
): SocketManager {
  const { accountId, log, stopped, onReconnect, pendingAckQueue: externalPendingAckQueue, client: externalClient, debug = false } = options;
  
  // 使用传入的 pendingAckQueue 或创建新的
  const pendingAckQueue = externalPendingAckQueue || new Set<string>();
  const targetClient = externalClient || client;
  
  // 【业界最佳实践配置】
  const config: SocketManagerConfig = {
    heartbeatInterval: 10 * 1000,      // 10 秒心跳间隔
    timeoutThreshold: 90 * 1000,       // 90 秒超时阈值
    baseBackoffDelay: 1000,            // 基础退避 1 秒
    maxBackoffDelay: 30 * 1000,        // 最大退避 30 秒
  };
  
  // 日志辅助函数
  const debugLog = (...args: any[]) => {
    if (debug && log) {
      log?.info?.(...args);
    }
  };
  
  // 状态管理
  let lastSocketAvailableTime = Date.now();
  let isReconnecting = false;
  let reconnectAttempts = 0;
  
  // 定时器引用
  let keepAliveTimer: NodeJS.Timeout | null = null;
  
  /**
   * 计算指数退避延迟（带抖动）
   */
  function calculateBackoffDelay(attempt: number): number {
    const exponentialDelay = config.baseBackoffDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 1000;  // 0-1 秒随机抖动
    return Math.min(exponentialDelay + jitter, config.maxBackoffDelay);
  }
  
  /**
   * 统一重连函数，带指数退避（无限重连）
   */
  async function doReconnect(immediate = false) {
    if (isReconnecting) {
      log?.debug?.(`[${accountId}] 正在重连中，跳过`);
      return;
    }
    
    isReconnecting = true;
    
    // 应用指数退避（非立即重连时）
    if (!immediate && reconnectAttempts > 0) {
      const delay = calculateBackoffDelay(reconnectAttempts);
      log?.info?.(`[${accountId}] ⏳ 等待 ${Math.round(delay / 1000)} 秒后重连 (尝试 ${reconnectAttempts + 1})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    try {
      // 1. 先断开旧连接（检查 WebSocket 状态）
      if (client.socket?.readyState === 1 || client.socket?.readyState === 3) {
        await client.disconnect();
        log?.info?.(`[${accountId}] 已断开旧连接`);
      }
      
      // 2. 重新建立连接
      await client.connect();
      
      // 3. 重置 socket 可用时间和重连计数
      lastSocketAvailableTime = Date.now();
      reconnectAttempts = 0;  // 重连成功，重置计数
      
      log?.info?.(`[${accountId}] ✅ 重连成功`);
      
      // 调用外部回调
      if (onReconnect) {
        onReconnect();
      }
    } catch (err: any) {
      reconnectAttempts++;
      log?.error?.(`[${accountId}] 重连失败：${err.message} (尝试 ${reconnectAttempts})`);
      throw err;
    } finally {
      isReconnecting = false;
    }
  }
  
  /**
   * 监听 pong 响应（更新 socket 可用时间）
   */
  function setupPongListener() {
    client.socket?.on('pong', () => {
      lastSocketAvailableTime = Date.now();
      log?.debug?.(`[${accountId}] 收到 PONG 响应`);
    });
  }
  
  /**
   * 监听 WebSocket message 事件，收到 disconnect 消息时立即触发重连
   */
  function setupMessageListener() {
    client.socket?.on('message', (data: any) => {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'SYSTEM' && msg.headers?.topic === 'disconnect') {
          if (!stopped() && !isReconnecting) {
            // 立即重连，不退避
            doReconnect(true).catch(err => {
              log?.error?.(`[${accountId}] 重连失败：${err.message}`);
            });
          }
        }
      } catch (e) {
        // 忽略解析错误
      }
    });
  }
  
  /**
   * 监听 WebSocket close 事件，服务端主动断开时立即触发重连
   */
  function setupCloseListener() {
    client.socket?.on('close', (code, reason) => {
      log?.info?.(`[${accountId}] WebSocket close: code=${code}, reason=${reason || '未知'}, stopped=${stopped()}`);
      
      if (stopped()) {
        return;
      }

      // 立即重连，不退避
      setTimeout(() => {
        doReconnect(true).catch(err => {
          log?.error?.(`[${accountId}] 重连失败：${err.message}`);
        });
      }, 0);
    });
  }
  
  /**
   * 监听 WebSocket open 事件，批量确认重连期间积压的消息
   */
  function setupOpenListener() {
    client.socket?.on('open', () => {
      if (pendingAckQueue.size > 0) {
        log?.info?.(`[${accountId}] WebSocket 已打开，批量确认 ${pendingAckQueue.size} 条积压消息`);
        for (const msgId of pendingAckQueue) {
          try {
            targetClient.socketCallBackResponse(msgId, { success: true });
            log?.info?.(`[DingTalk] 批量确认成功：messageId=${msgId}`);
          } catch (err: any) {
            log?.error?.(`[DingTalk] 批量确认失败：messageId=${msgId}, error=${err.message}`);
          }
        }
        pendingAckQueue.clear();
      }
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
    debugLog(`[${accountId}] 🚀 启动 keepAlive 定时器，间隔=${config.heartbeatInterval / 1000}秒`);
    
    keepAliveTimer = setInterval(async () => {
      if (stopped()) {
        if (keepAliveTimer) clearInterval(keepAliveTimer);
        return;
      }
      
      try {
        const elapsed = Date.now() - lastSocketAvailableTime;
        
        // 【超时检测】超过 90 秒未确认 socket 可用，触发重连
        if (elapsed > config.timeoutThreshold) {
          log?.info?.(`[${accountId}] ⚠️ 超时检测：已 ${Math.round(elapsed / 1000)} 秒未确认 socket 可用，触发重连...`);
          await doReconnect();
          return;
        }
        
        // 【心跳检测】检查 socket 状态
        const socketState = client.socket?.readyState;
        debugLog(`[${accountId}] 🔍 心跳检测：socket 状态=${socketState}, elapsed=${Math.round(elapsed / 1000)}s`);
        
        if (socketState !== 1) {
          log?.info?.(`[${accountId}] ⚠️ 心跳检测：socket 状态=${socketState}，触发重连...`);
          await doReconnect(true);  // 立即重连，不退避
          return;
        }
        
        // 【发送原生 Ping】更新可用时间
        try {
          client.socket?.ping();
          lastSocketAvailableTime = Date.now();
          debugLog(`[${accountId}] 💓 发送 PING 心跳成功`);
        } catch (err: any) {
          log?.warn?.(`[${accountId}] 发送 PING 失败：${err.message}`);
          // 发送失败也计入超时
        }
      } catch (err: any) {
        log?.error?.(`[${accountId}] keepAlive 检测失败：${err.message}`);
      }
    }, config.heartbeatInterval);  // 每 10 秒检测一次
    
    debugLog(`[${accountId}] ✅ keepAlive 定时器已启动`);
    
    // 返回清理函数
    return () => {
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      keepAliveTimer = null;
      debugLog(`[${accountId}] keepAlive 定时器已清理`);
    };
  }
  
  /**
   * 停止并清理所有资源
   */
  function stop() {
    // 清理定时器
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = null;
    
    // 清理事件监听器（WebSocket 会自动清理）
    if (client.socket) {
      client.socket.removeAllListeners();
    }
    
    log?.debug?.(`[${accountId}] SocketManager 已停止`);
  }
  
  // 初始化：设置所有事件监听器
  setupPongListener();
  setupMessageListener();
  setupCloseListener();
  setupOpenListener();
  
  return {
    startKeepAlive,
    stop,
  };
}

/**
 * 添加消息到待确认队列
 */
export function addToPendingAckQueue(queue: Set<string>, messageId: string) {
  queue.add(messageId);
}

/**
 * 从待确认队列移除消息
 */
export function removeFromPendingAckQueue(queue: Set<string>, messageId: string) {
  queue.delete(messageId);
}

/**
 * 清空待确认队列
 */
export function clearPendingAckQueue(queue: Set<string>) {
  queue.clear();
}