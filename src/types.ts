/**
 * 类型定义模块
 * 集中管理所有 TypeScript 类型定义
 */

/** 用户会话状态：记录最后活跃时间和当前 session 标识 */
export interface UserSession {
  lastActivity: number;
  sessionId: string;  // 格式: dingtalk-connector:<senderId> 或 dingtalk-connector:<senderId>:<timestamp>
}

/** 视频信息接口 */
export interface VideoInfo {
  path: string;
}

/** 视频元数据接口 */
export interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

/** 文件信息接口 */
export interface FileInfo {
  path: string;        // 本地文件路径
  fileName: string;    // 文件名
  fileType: string;    // 文件类型（扩展名）
}

/** 音频信息接口 */
export interface AudioInfo {
  path: string;
}

/** 消息内容提取结果 */
export interface ExtractedMessage {
  text: string;
  messageType: string;
  /** 图片 URL 列表（来自 richText 或 picture 消息） */
  imageUrls: string[];
  /** 图片 downloadCode 列表（用于通过 API 下载） */
  downloadCodes: string[];
  /** 文件名列表（与 downloadCodes 对应，用于文件类型消息） */
  fileNames: string[];
  /** at的钉钉用户ID列表 */
  atDingtalkIds: string[];
  /** at的手机号列表 */
  atMobiles: string[];
}

/** AI Card 实例 */
export interface AICardInstance {
  cardInstanceId: string;
  accessToken: string;
  inputingStarted: boolean;
}

/** Gateway 选项 */
export interface GatewayOptions {
  userContent: string;
  systemPrompts: string[];
  sessionKey: string;
  gatewayAuth?: string;  // token 或 password，都用 Bearer 格式
  /** 本地图片文件路径列表，用于 OpenClaw AgentMediaPayload */
  imageLocalPaths?: string[];
  log?: any;
}

/** 消息类型枚举 */
export type DingTalkMsgType = 'text' | 'markdown' | 'link' | 'actionCard' | 'image';

/** 主动发送消息的结果 */
export interface SendResult {
  ok: boolean;
  processQueryKey?: string;
  cardInstanceId?: string;  // AI Card 成功时返回
  error?: string;
  usedAICard?: boolean;  // 是否使用了 AI Card
}

/** 主动发送选项 */
export interface ProactiveSendOptions {
  msgType?: DingTalkMsgType;
  title?: string;
  log?: any;
  useAICard?: boolean;  // 是否使用 AI Card，默认 true
  fallbackToNormal?: boolean;  // AI Card 失败时是否降级到普通消息，默认 true
}

/** AI Card 投放目标类型 */
export type AICardTarget =
  | { type: 'user'; userId: string }
  | { type: 'group'; openConversationId: string };

/** 文档信息接口 */
export interface DocInfo {
  docId: string;
  title: string;
  docType: string;
  creatorId?: string;
  updatedAt?: string;
}

/** 文档内容块 */
export interface DocBlock {
  blockId: string;
  blockType: string;
  text?: string;
  children?: DocBlock[];
}
