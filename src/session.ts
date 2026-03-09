/**
 * Session 管理模块
 * 处理用户会话的创建、管理和超时控制
 */

import type { UserSession } from './types';
import { NEW_SESSION_COMMANDS, MESSAGE_DEDUP_TTL } from './constants';

/** 用户会话缓存 Map<senderId, UserSession> */
const userSessions = new Map<string, UserSession>();

/** 消息去重缓存 Map<messageId, timestamp> - 防止同一消息被重复处理 */
const processedMessages = new Map<string, number>();

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
export function isMessageProcessed(messageId: string): boolean {
  if (!messageId) return false;
  return processedMessages.has(messageId);
}

/** 标记消息为已处理 */
export function markMessageProcessed(messageId: string): void {
  if (!messageId) return;
  processedMessages.set(messageId, Date.now());
  // 定期清理（每处理100条消息清理一次）
  if (processedMessages.size >= 100) {
    cleanupProcessedMessages();
  }
}

/** 检查消息是否是新会话命令 */
export function isNewSessionCommand(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return NEW_SESSION_COMMANDS.some(cmd => trimmed === cmd.toLowerCase());
}

/** 获取或创建用户 session key */
export function getSessionKey(
  senderId: string,
  accountId: string,  // 添加 accountId 参数，支持多 agent 路由
  forceNew: boolean,
  sessionTimeout: number,
  log?: any,
): { sessionKey: string; isNew: boolean } {
  const now = Date.now();
  const sessionKeyPrefix = `dingtalk-connector:${accountId}`;  // 使用 accountId 作为前缀
  const cacheKey = `${accountId}:${senderId}`;  // 使用 accountId:senderId 作为缓存键
  const existing = userSessions.get(cacheKey);

  // 强制新会话
  if (forceNew) {
    const sessionId = `${sessionKeyPrefix}:${senderId}:${now}`;
    userSessions.set(cacheKey, { lastActivity: now, sessionId });
    log?.info?.(`[DingTalk][Session] 账号[${accountId}] 用户主动开启新会话: ${senderId}`);
    return { sessionKey: sessionId, isNew: true };
  }

  // 检查超时
  if (existing) {
    const elapsed = now - existing.lastActivity;
    if (elapsed > sessionTimeout) {
      const sessionId = `${sessionKeyPrefix}:${senderId}:${now}`;
      userSessions.set(cacheKey, { lastActivity: now, sessionId });
      log?.info?.(`[DingTalk][Session] 账号[${accountId}] 会话超时(${Math.round(elapsed / 60000)}分钟)，自动开启新会话: ${senderId}`);
      return { sessionKey: sessionId, isNew: true };
    }
    // 更新活跃时间
    existing.lastActivity = now;
    return { sessionKey: existing.sessionId, isNew: false };
  }

  // 首次会话
  const sessionId = `${sessionKeyPrefix}:${senderId}`;
  userSessions.set(cacheKey, { lastActivity: now, sessionId });
  log?.info?.(`[DingTalk][Session] 账号[${accountId}] 新用户首次会话: ${senderId}`);
  return { sessionKey: sessionId, isNew: false };
}
