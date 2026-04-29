/**
 * Card-to-Session 映射注册表
 *
 * 维护 cardInstanceId (outTrackId) → session 信息的内存映射，
 * 使卡片回调（点赞/点踩）能够定位到对应的 session JSONL 文件并追加反馈条目。
 */

import { readFile, appendFile, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

// ============ 类型定义 ============

export interface CardSessionInfo {
  sessionKey: string;
  agentId: string;
  createdAt: number;
}

export interface RecordFeedbackParams {
  outTrackId: string;
  like: 1 | -1;
  userId: string;
  dislikeReasons?: string[];
  customDislikeReason?: string;
  logger?: { info?: (...args: any[]) => void; warn?: (...args: any[]) => void; error?: (...args: any[]) => void };
}

// ============ 内存注册表 ============

const CARD_SESSION_TTL = 24 * 60 * 60 * 1000; // 24 小时
const CLEANUP_INTERVAL = 30 * 60 * 1000; // 30 分钟

const cardSessionMap = new Map<string, CardSessionInfo>();

/**
 * 注册 cardInstanceId → session 映射
 */
export function registerCardSession(cardInstanceId: string, info: CardSessionInfo): void {
  cardSessionMap.set(cardInstanceId, info);
}

/**
 * 查找 cardInstanceId 对应的 session 信息
 */
export function lookupCardSession(cardInstanceId: string): CardSessionInfo | null {
  return cardSessionMap.get(cardInstanceId) ?? null;
}

/**
 * 清理过期条目（超过 24 小时）
 */
export function cleanupExpiredCardSessions(): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, info] of cardSessionMap) {
    if (now - info.createdAt > CARD_SESSION_TTL) {
      cardSessionMap.delete(key);
      removed++;
    }
  }
  return removed;
}

// 自动清理定时器（unref 防止阻止进程退出）
const cleanupTimer = setInterval(cleanupExpiredCardSessions, CLEANUP_INTERVAL);
if (typeof cleanupTimer.unref === "function") {
  cleanupTimer.unref();
}

// ============ 反馈写入 ============

/**
 * 将用户反馈追加到 session JSONL 文件
 *
 * 流程：
 * 1. 通过 outTrackId 查找注册表，获取 sessionKey + agentId
 * 2. 读取 ~/.openclaw/agents/{agentId}/sessions/sessions.json 获取 sessionFile
 * 3. 构造 customType: "user-feedback" 条目
 * 4. appendFileSync 追加到 JSONL 文件
 *
 * 此函数永远不会抛出异常（内部 try/catch），调用方无需处理错误。
 */
export async function recordFeedbackToSession(params: RecordFeedbackParams): Promise<boolean> {
  const { outTrackId, like, userId, dislikeReasons, customDislikeReason, logger } = params;

  if (!outTrackId) {
    logger?.warn?.("[CardFeedback] outTrackId 为空，跳过反馈记录");
    return false;
  }

  try {
    // 1. 查找注册表
    const info = lookupCardSession(outTrackId);
    if (!info) {
      logger?.warn?.(`[CardFeedback] 未找到 outTrackId=${outTrackId} 的 session 映射（可能已重启或过期），跳过`);
      return false;
    }

    // 2. 读取 sessions.json 获取 sessionFile 路径
    const sessionsJsonPath = join(homedir(), ".openclaw", "agents", info.agentId, "sessions", "sessions.json");
    try {
      await access(sessionsJsonPath);
    } catch {
      logger?.warn?.(`[CardFeedback] sessions.json 不存在: ${sessionsJsonPath}`);
      return false;
    }

    let sessionsStore: Record<string, any>;
    try {
      sessionsStore = JSON.parse(await readFile(sessionsJsonPath, "utf-8"));
    } catch (parseErr: any) {
      logger?.error?.(`[CardFeedback] sessions.json 解析失败: ${parseErr.message}`);
      return false;
    }

    const sessionEntry = sessionsStore[info.sessionKey];
    if (!sessionEntry) {
      logger?.warn?.(`[CardFeedback] sessionKey=${info.sessionKey} 在 sessions.json 中不存在`);
      return false;
    }

    const sessionFile = sessionEntry.sessionFile as string | undefined;
    if (!sessionFile) {
      logger?.warn?.(`[CardFeedback] session 文件路径为空`);
      return false;
    }
    try {
      await access(sessionFile);
    } catch {
      logger?.warn?.(`[CardFeedback] session 文件不存在: ${sessionFile}`);
      return false;
    }

    // 3. 构造反馈 JSONL 条目
    const feedbackData: Record<string, unknown> = {
      like,
      userId,
      cardInstanceId: outTrackId,
      source: "dingtalk-card",
    };
    if (like === -1) {
      if (dislikeReasons && dislikeReasons.length > 0) {
        feedbackData.dislikeReasons = dislikeReasons;
      }
      if (customDislikeReason) {
        feedbackData.customDislikeReason = customDislikeReason;
      }
    }

    const entry = {
      type: "custom",
      customType: "user-feedback",
      data: feedbackData,
      id: randomBytes(4).toString("hex"),
      parentId: null,
      timestamp: new Date().toISOString(),
    };

    // 4. 追加到 session 文件
    // 注意：反馈写入通常发生在会话活跃期结束后（用户先看到回复再点赞/踩），
    // 此时 OpenClaw 通常不再写入该 session 文件，并发冲突概率极低。
    const jsonLine = "\n" + JSON.stringify(entry);
    await appendFile(sessionFile, jsonLine, "utf-8");

    logger?.info?.(`[CardFeedback] 反馈已记录到 session: like=${like}, userId=${userId}, outTrackId=${outTrackId}, file=${sessionFile}`);
    return true;
  } catch (err: any) {
    logger?.error?.(`[CardFeedback] 记录反馈异常: ${err.message}`);
    return false;
  }
}

// 导出常量供测试使用
export { CARD_SESSION_TTL, CLEANUP_INTERVAL };
// 导出 Map 引用供测试清理
export function _getRegistryForTesting(): Map<string, CardSessionInfo> {
  return cardSessionMap;
}
