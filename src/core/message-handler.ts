/**
 * 钉钉消息业务处理器
 * 
 * 职责：
 * - 处理钉钉消息的业务逻辑
 * - 支持多种消息类型：text、richText、picture、audio、video、file
 * - 媒体文件下载和上传（图片、语音、视频、文件）
 * - 会话上下文构建和管理
 * - 消息分发（AI Card、命令处理、主动消息）
 * - Policy 检查（DM 白名单、群聊策略）
 * 
 * 核心功能：
 * - 消息内容提取和归一化
 * - 媒体文件本地缓存管理
 * - 钉钉 API 调用（accessToken、文件下载）
 * - 与 OpenClaw 框架集成（bindings、runtime）
 */
import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import type { ResolvedDingtalkAccount, DingtalkConfig } from "../types/index.ts";
import { 
  isMessageProcessed, 
  markMessageProcessed, 
  buildSessionContext,
  getAccessToken,
  getOapiAccessToken,
  DINGTALK_API,
  DINGTALK_OAPI,
  addEmotionReply,
  recallEmotionReply,
} from "../utils/utils-legacy.ts";
import { resolveAgentWorkspaceDir } from "../utils/agent.ts";
import { 
  processLocalImages, 
  processVideoMarkers, 
  processAudioMarkers, 
  processFileMarkers,
  uploadMediaToDingTalk,
  toLocalPath,
  FILE_MARKER_PATTERN,
  VIDEO_MARKER_PATTERN,
  AUDIO_MARKER_PATTERN
} from "../services/media/index.ts";
import { sendProactive, type AICardTarget } from "../services/messaging/index.ts";
import { createDingtalkReplyDispatcher, normalizeSlashCommand } from "../reply-dispatcher.ts";
import { getDingtalkRuntime } from "../runtime.ts";
import { dingtalkHttp } from '../utils/http-client.ts';
import { createLoggerFromConfig } from '../utils/logger.ts';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

// ============ 常量 ============

const AI_CARD_TEMPLATE_ID = '02fcf2f4-5e02-4a85-b672-46d1f715543e.schema';

const AICardStatus = {
  PROCESSING: '1',
  INPUTING: '2',
  FINISHED: '3',
  EXECUTING: '4',
  FAILED: '5',
} as const;

// ============ 会话级别消息队列 ============

/**
 * 会话消息队列管理
 * 用于确保同一会话+agent的消息按顺序处理，避免并发冲突导致AI返回空响应
 * 队列键格式：{sessionId}:{agentId}
 * 这样不同 agent 可以并发处理，同一 agent 的同一会话串行处理
 */
const sessionQueues = new Map<string, Promise<void>>();

/**
 * 清理过期的会话队列（超过5分钟没有新消息的会话+agent）
 */
const sessionLastActivity = new Map<string, number>();
const SESSION_QUEUE_TTL = 5 * 60 * 1000; // 5分钟

function cleanupExpiredSessionQueues(): void {
  const now = Date.now();
  for (const [queueKey, lastActivity] of sessionLastActivity.entries()) {
    if (now - lastActivity > SESSION_QUEUE_TTL) {
      sessionQueues.delete(queueKey);
      sessionLastActivity.delete(queueKey);
    }
  }
}

// 每分钟清理一次过期队列
setInterval(cleanupExpiredSessionQueues, 60_000);

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
};

// ============ Agent 路由解析 ============
// SDK 会自动处理 bindings 解析，无需手动实现

// ============ 消息内容提取 ============

interface ExtractedMessage {
  text: string;
  messageType: string;
  imageUrls: string[];
  downloadCodes: string[];
  fileNames: string[];
  atDingtalkIds: string[];
  atMobiles: string[];
}

export function extractMessageContent(data: any): ExtractedMessage {
  const msgtype = data.msgtype || 'text';
  switch (msgtype) {
    case 'text': {
      const atDingtalkIds = data.text?.at?.atDingtalkIds || [];
      const atMobiles = data.text?.at?.atMobiles || [];
      return { 
        text: data.text?.content?.trim() || '', 
        messageType: 'text', 
        imageUrls: [], 
        downloadCodes: [], 
        fileNames: [],
        atDingtalkIds,
        atMobiles
      };
    }
    case 'richText': {
      const parts = data.content?.richText || [];
      const textParts: string[] = [];
      const imageUrls: string[] = [];
      const downloadCodes: string[] = [];
      const fileNames: string[] = [];

      for (const part of parts) {
        if (part.text) {
          textParts.push(part.text);
        }
        // 处理图片
        if (part.pictureUrl) {
          imageUrls.push(part.pictureUrl);
        }
        if (part.type === 'picture' && part.downloadCode) {
          imageUrls.push(`downloadCode:${part.downloadCode}`);
        }
        // 处理视频
        if (part.type === 'video' && part.downloadCode) {
          downloadCodes.push(part.downloadCode);
          fileNames.push(part.fileName || 'video.mp4');
        }
        // 处理音频
        if (part.type === 'audio' && part.downloadCode) {
          downloadCodes.push(part.downloadCode);
          fileNames.push(part.fileName || 'audio');
        }
        // 处理文件
        if (part.type === 'file' && part.downloadCode) {
          downloadCodes.push(part.downloadCode);
          fileNames.push(part.fileName || '文件');
        }
      }

      const text = textParts.join('') || (imageUrls.length > 0 ? '[图片]' : (downloadCodes.length > 0 ? '[媒体文件]' : '[富文本消息]'));
      return { text, messageType: 'richText', imageUrls, downloadCodes, fileNames, atDingtalkIds: [], atMobiles: [] };
    }
    case 'picture': {
      const downloadCode = data.content?.downloadCode || '';
      const pictureUrl = data.content?.pictureUrl || '';
      const imageUrls: string[] = [];
      const downloadCodes: string[] = [];

      if (pictureUrl) {
        imageUrls.push(pictureUrl);
      }
      if (downloadCode) {
        downloadCodes.push(downloadCode);
      }

      return { text: '[图片]', messageType: 'picture', imageUrls, downloadCodes, fileNames: [], atDingtalkIds: [], atMobiles: [] };
    }
    case 'audio': {
      const audioDownloadCode = data.content?.downloadCode || '';
      const audioFileName = data.content?.fileName || 'audio.amr';
      const downloadCodes: string[] = [];
      const fileNames: string[] = [];
      if (audioDownloadCode) {
        downloadCodes.push(audioDownloadCode);
        fileNames.push(audioFileName);
      }
      return { 
        text: data.content?.recognition || '[语音消息]', 
        messageType: 'audio', 
        imageUrls: [], 
        downloadCodes, 
        fileNames, 
        atDingtalkIds: [], 
        atMobiles: [] 
      };
    }
    case 'video': {
      const videoDownloadCode = data.content?.downloadCode || '';
      const videoFileName = data.content?.fileName || 'video.mp4';
      const downloadCodes: string[] = [];
      const fileNames: string[] = [];
      if (videoDownloadCode) {
        downloadCodes.push(videoDownloadCode);
        fileNames.push(videoFileName);
      }
      return { 
        text: '[视频]', 
        messageType: 'video', 
        imageUrls: [], 
        downloadCodes, 
        fileNames, 
        atDingtalkIds: [], 
        atMobiles: [] 
      };
    }
    case 'file': {
      const fileName = data.content?.fileName || '文件';
      const downloadCode = data.content?.downloadCode || '';
      const downloadCodes: string[] = [];
      const fileNames: string[] = [];
      if (downloadCode) {
        downloadCodes.push(downloadCode);
        fileNames.push(fileName);
      }
      return { text: `[文件: ${fileName}]`, messageType: 'file', imageUrls: [], downloadCodes, fileNames, atDingtalkIds: [], atMobiles: [] };
    }
    case 'interactiveCard': {
      // 交互式卡片消息（通常是文档分享）
      const actionUrl = data.content?.biz_custom_action_url || '';
      if (actionUrl) {
        // 提取文档链接并格式化
        const text = `[钉钉文档]\n🔗 ${actionUrl}`;
        return { text, messageType: 'interactiveCard', imageUrls: [], downloadCodes: [], fileNames: [], atDingtalkIds: [], atMobiles: [] };
      }
      return { text: '[交互式卡片]', messageType: 'interactiveCard', imageUrls: [], downloadCodes: [], fileNames: [], atDingtalkIds: [], atMobiles: [] };
    }
    default:
      return { text: data.text?.content?.trim() || `[${msgtype}消息]`, messageType: msgtype, imageUrls: [], downloadCodes: [], fileNames: [], atDingtalkIds: [], atMobiles: [] };
  }
}

// ============ 图片下载 ============

export async function downloadImageToFile(
  downloadUrl: string,
  agentWorkspaceDir: string,
  log?: any,
): Promise<string | null> {
  try {
    log?.info?.(`开始下载图片: ${downloadUrl.slice(0, 100)}...`);
    const resp = await dingtalkHttp.get(downloadUrl, {
      proxy: false, // 禁用代理，避免 PAC 文件影响

      headers: {
        'Content-Type': undefined, // 删除默认的 Content-Type 请求头，让 OSS 签名验证通过
      },
      responseType: 'arraybuffer',
      timeout: 30_000,
    });

    const buffer = Buffer.from(resp.data);
    const contentType = resp.headers['content-type'] || 'image/jpeg';
    const ext = contentType.includes('png') ? '.png' : contentType.includes('gif') ? '.gif' : contentType.includes('webp') ? '.webp' : '.jpg';
    // 使用 Agent 工作空间路径
    const mediaDir = path.join(agentWorkspaceDir, 'media', 'inbound');
    fs.mkdirSync(mediaDir, { recursive: true });
    const tmpFile = path.join(mediaDir, `openclaw-media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    fs.writeFileSync(tmpFile, buffer);

    log?.info?.(`图片下载成功: size=${buffer.length} bytes, type=${contentType}, path=${tmpFile}`);
    return tmpFile;
  } catch (err: any) {
    log?.error?.(`图片下载失败: ${err.message}`);
    return null;
  }
}

export async function downloadMediaByCode(
  downloadCode: string,
  config: DingtalkConfig,
  agentWorkspaceDir: string,
  log?: any,
): Promise<string | null> {
  try {
    const token = await getAccessToken(config);
    log?.info?.(`通过 downloadCode 下载媒体: ${downloadCode.slice(0, 30)}...`);

    const resp = await dingtalkHttp.post(
      `${DINGTALK_API}/v1.0/robot/messageFiles/download`,
      { downloadCode, robotCode: config.clientId },
      {
        headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
        timeout: 30_000,
      },
    );

    const downloadUrl = resp.data?.downloadUrl;
    if (!downloadUrl) {
      log?.warn?.(`downloadCode 换取 downloadUrl 失败: ${JSON.stringify(resp.data)}`);
      return null;
    }

    return downloadImageToFile(downloadUrl, agentWorkspaceDir, log);
  } catch (err: any) {
    log?.error?.(`downloadCode 下载失败: ${err.message}`);
    return null;
  }
}

export async function getFileDownloadUrl(
  downloadCode: string,
  fileName: string,
  config: DingtalkConfig,
  log?: any,
): Promise<string | null> {
  try {
    const token = await getAccessToken(config);
    log?.info?.(`获取文件下载链接: ${fileName}`);

    const resp = await dingtalkHttp.post(
      `${DINGTALK_API}/v1.0/robot/messageFiles/download`,
      { downloadCode, robotCode: config.clientId },
      {
        headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
        timeout: 30_000,
      },
    );

    const downloadUrl = resp.data?.downloadUrl;
    if (!downloadUrl) {
      log?.warn?.(`downloadCode 换取 downloadUrl 失败: ${JSON.stringify(resp.data)}`);
      return null;
    }

    log?.info?.(`获取下载链接成功: ${fileName}`);
    return downloadUrl;
  } catch (err: any) {
    log?.error?.(`获取下载链接失败: ${err.message}`);
    return null;
  }
}

// ============ 文件下载和解析 ============

/**
 * 下载文件到本地
 */
export async function downloadFileToLocal(
  downloadUrl: string,
  fileName: string,
  agentWorkspaceDir: string,
  log?: any,
): Promise<string | null> {
  try {
    log?.info?.(`开始下载文件: ${fileName}`);
    const resp = await dingtalkHttp.get(downloadUrl, {
      proxy: false, // 禁用代理，避免 PAC 文件影响
      headers: {
        'Content-Type': undefined, // 删除默认的 Content-Type 请求头，让 OSS 签名验证通过
      },
      responseType: 'arraybuffer',
      timeout: 60_000, // 文件可能较大，增加超时时间
    });

    const buffer = Buffer.from(resp.data);
    const mediaDir = path.join(agentWorkspaceDir, 'media', 'inbound');
    fs.mkdirSync(mediaDir, { recursive: true });
    
    // 安全过滤文件名
    const sanitizeFileName = (name: string): string => {
      // 移除路径分隔符，防止目录遍历攻击
      let safe = name.replace(/[/\\]/g, '_');
      // 移除或替换危险字符
      safe = safe.replace(/[<>:"|?*\x00-\x1f]/g, '_');
      // 移除开头的点，防止隐藏文件
      safe = safe.replace(/^\.+/, '');
      // 限制长度
      if (safe.length > 200) {
        const ext = path.extname(safe);
        const base = path.basename(safe, ext);
        safe = base.substring(0, 200 - ext.length) + ext;
      }
      // 如果处理后为空，使用默认名称
      if (!safe) {
        safe = 'unnamed_file';
      }
      return safe;
    };
    
    // 保留原始文件名，但添加时间戳避免冲突
    const ext = path.extname(fileName);
    const baseName = path.basename(fileName, ext);
    const timestamp = Date.now();
    const safeBaseName = sanitizeFileName(baseName);
    const safeFileName = `${safeBaseName}-${timestamp}${ext}`;
    const localPath = path.join(mediaDir, safeFileName);
    
    fs.writeFileSync(localPath, buffer);
    log?.info?.(`文件下载成功: ${fileName}, size=${buffer.length} bytes, path=${localPath}`);
    return localPath;
  } catch (err: any) {
    console.error(`[ERROR] downloadFileToLocal 异常: ${err.message}`);
    console.error(`[ERROR] 异常堆栈:\n${err.stack}`);
    return null;
  }
}

/**
 * 解析 Word 文档 (.docx)
 */
async function parseDocxFile(filePath: string, log?: any): Promise<string | null> {
  try {
    log?.info?.(`开始解析 Word 文档: ${filePath}`);
    const buffer = fs.readFileSync(filePath);
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    
    if (text) {
      log?.info?.(`Word 文档解析成功: ${filePath}, 文本长度=${text.length}`);
      return text;
    } else {
      log?.warn?.(`Word 文档解析结果为空: ${filePath}`);
      return null;
    }
  } catch (err: any) {
    log?.error?.(`Word 文档解析失败: ${filePath}, error=${err.message}`);
    return null;
  }
}

/**
 * 解析 PDF 文档
 */
async function parsePdfFile(filePath: string, log?: any): Promise<string | null> {
  try {
    log?.info?.(`开始解析 PDF 文档: ${filePath}`);
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    const text = data.text.trim();
    
    if (text) {
      log?.info?.(`PDF 文档解析成功: ${filePath}, 文本长度=${text.length}, 页数=${data.numpages}`);
      return text;
    } else {
      log?.warn?.(`PDF 文档解析结果为空: ${filePath}`);
      return null;
    }
  } catch (err: any) {
    log?.error?.(`PDF 文档解析失败: ${filePath}, error=${err.message}`);
    return null;
  }
}

/**
 * 读取纯文本文件
 */
async function readTextFile(filePath: string, log?: any): Promise<string | null> {
  try {
    log?.info?.(`开始读取文本文件: ${filePath}`);
    const text = fs.readFileSync(filePath, 'utf-8').trim();
    
    if (text) {
      log?.info?.(`文本文件读取成功: ${filePath}, 文本长度=${text.length}`);
      return text;
    } else {
      log?.warn?.(`文本文件内容为空: ${filePath}`);
      return null;
    }
  } catch (err: any) {
    log?.error?.(`文本文件读取失败: ${filePath}, error=${err.message}`);
    return null;
  }
}

/**
 * 根据文件类型解析文件内容
 */
async function parseFileContent(
  filePath: string,
  fileName: string,
  log?: any,
): Promise<{ content: string | null; type: 'text' | 'binary' }> {
  const ext = path.extname(fileName).toLowerCase();
  
  // Word 文档
  if (['.docx', '.doc'].includes(ext)) {
    const content = await parseDocxFile(filePath, log);
    return { content, type: 'text' };
  }
  
  // PDF 文档
  if (ext === '.pdf') {
    const content = await parsePdfFile(filePath, log);
    return { content, type: 'text' };
  }
  
  // 纯文本文件
  if (['.txt', '.md', '.json', '.xml', '.yaml', '.yml', '.csv', '.log', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.sh', '.bat'].includes(ext)) {
    const content = await readTextFile(filePath, log);
    return { content, type: 'text' };
  }
  
  // 二进制文件（不解析）
  return { content: null, type: 'binary' };
}

// ============ 消息处理 ============

interface HandleMessageParams {
  accountId: string;
  config: DingtalkConfig;
  data: any;
  sessionWebhook: string;
  runtime?: RuntimeEnv;
  log?: any;
  cfg: ClawdbotConfig;
}

/**
 * 内部消息处理函数（实际执行消息处理逻辑）
 */
export async function handleDingTalkMessageInternal(params: HandleMessageParams): Promise<void> {
  const { accountId, config, data, sessionWebhook, runtime, log: inputLog, cfg } = params;

  // 如果传入的 log 为空，则使用基于 config 的 logger
  const log = createLoggerFromConfig(config, `DingTalk:${accountId}`);

  const content = extractMessageContent(data);
  if (!content.text && content.imageUrls.length === 0 && content.downloadCodes.length === 0) return;

  const isDirect = data.conversationType === '1';
  const senderId = data.senderStaffId || data.senderId;
  const senderName = data.senderNick || 'Unknown';

  // ===== 提前解析 agentId 和工作空间路径 =====
  const chatType = isDirect ? "direct" : "group";
  const peerId = isDirect ? senderId : data.conversationId;
  
  // 手动匹配 bindings 获取 agentId
  let matchedAgentId: string | null = null;
  if (cfg.bindings && cfg.bindings.length > 0) {
    for (const binding of cfg.bindings) {
      const match = binding.match;
      if (match.channel && match.channel !== "dingtalk-connector") continue;
      if (match.accountId && match.accountId !== accountId) continue;
      if (match.peer) {
        if (match.peer.kind && match.peer.kind !== chatType) continue;
        if (match.peer.id && match.peer.id !== '*' && match.peer.id !== peerId) continue;
      }
      matchedAgentId = binding.agentId;
      break;
    }
  }
  if (!matchedAgentId) {
    matchedAgentId = cfg.defaultAgent || 'main';
  }
  
  // 获取 Agent 工作空间路径
  const agentWorkspaceDir = resolveAgentWorkspaceDir(cfg, matchedAgentId);
  log?.info?.(`Agent 工作空间路径: ${agentWorkspaceDir}`);



  // ===== DM Policy 检查 =====
  if (isDirect) {
    const dmPolicy = config.dmPolicy || 'open';
    const allowFrom: (string | number)[] = config.allowFrom || [];
    
    // 处理 pairing 策略（暂不支持，当作 open 处理并记录警告）
    if (dmPolicy === 'pairing') {
      log?.warn?.(`dmPolicy="pairing" 暂不支持，将按 "open" 策略处理`);
      // 继续执行，不拦截
    }
    
    // 处理 allowlist 策略
    if (dmPolicy === 'allowlist') {
      if (!senderId) {
        log?.warn?.(`DM 被拦截: senderId 为空`);
        return;
      }
      
      // 规范化 senderId 和 allowFrom 进行比较（支持 string 和 number 类型）
      const normalizedSenderId = String(senderId);
      const normalizedAllowFrom = allowFrom.map(id => String(id));
      
      // 白名单为空时拦截所有（虽然 Schema 验证会阻止这种情况，但代码层面也要防御）
      if (normalizedAllowFrom.length === 0) {
        log?.warn?.(`[DingTalk] DM 被拦截: allowFrom 白名单为空，拒绝所有请求`);
        
        try {
          await sendProactive(config, { userId: senderId }, '抱歉，此机器人的访问白名单配置有误。请联系管理员检查配置。', {
            msgType: 'text',
            useAICard: false,
            fallbackToNormal: true,
            log,
          });
        } catch (err: any) {
          log?.error?.(`[DingTalk] 发送 DM 配置错误提示失败: ${err.message}`);
        }
        return;
      }
      
      // 检查是否在白名单中
      if (!normalizedAllowFrom.includes(normalizedSenderId)) {
        log?.warn?.(`DM 被拦截: senderId=${senderId} (${senderName}) 不在白名单中`);
        
        try {
          await sendProactive(config, { userId: senderId }, '抱歉，您暂无权限使用此机器人。如需开通权限，请联系管理员。', {
            msgType: 'text',
            useAICard: false,
            fallbackToNormal: true,
            log,
          });
        } catch (err: any) {
          log?.error?.(`发送 DM 拦截提示失败: ${err.message}`);
        }
        return;
      }
    }
  }

  // ===== 群聊 Policy 检查 =====
  if (!isDirect) {
    const groupPolicy = config.groupPolicy || 'open';
    const conversationId = data.conversationId;
    const groupAllowFrom: (string | number)[] = config.groupAllowFrom || [];

    // 处理 disabled 策略
    if (groupPolicy === 'disabled') {
      log?.warn?.(`群聊被拦截: groupPolicy=disabled`);
      
      try {
        await sendProactive(config, { openConversationId: conversationId }, '抱歉，此机器人暂不支持群聊功能。', {
          msgType: 'text',
          useAICard: false,
          fallbackToNormal: true,
          log,
        });
      } catch (err: any) {
        log?.error?.(`发送群聊 disabled 提示失败: ${err.message}`);
      }
      return;
    }

    // 处理 allowlist 策略
    if (groupPolicy === 'allowlist') {
      if (!conversationId) {
        log?.warn?.(`群聊被拦截: conversationId 为空`);
        return;
      }
      
      // 规范化 conversationId 和 groupAllowFrom 进行比较（支持 string 和 number 类型）
      const normalizedConversationId = String(conversationId);
      const normalizedGroupAllowFrom = groupAllowFrom.map(id => String(id));
      
      // 白名单为空时拦截所有（虽然 Schema 验证会阻止这种情况，但代码层面也要防御）
      if (normalizedGroupAllowFrom.length === 0) {
        log?.warn?.(`群聊被拦截: groupAllowFrom 白名单为空，拒绝所有请求`);
        
        try {
          await sendProactive(config, { openConversationId: conversationId }, '抱歉，此机器人的群组访问白名单配置有误。请联系管理员检查配置。', {
            msgType: 'text',
            useAICard: false,
            fallbackToNormal: true,
            log,
          });
        } catch (err: any) {
          log?.error?.(`发送群聊配置错误提示失败: ${err.message}`);
        }
        return;
      }
      
      // 检查是否在白名单中
      if (!normalizedGroupAllowFrom.includes(normalizedConversationId)) {
        log?.warn?.(`群聊被拦截: conversationId=${conversationId} 不在 groupAllowFrom 白名单中`);
        
        try {
          await sendProactive(config, { openConversationId: conversationId }, '抱歉，此群组暂无权限使用此机器人。如需开通权限，请联系管理员。', {
            msgType: 'text',
            useAICard: false,
            fallbackToNormal: true,
            log,
          });
        } catch (err: any) {
          log?.error?.(`发送群聊 allowlist 提示失败: ${err.message}`);
        }
        return;
      }
    }
  }

  // 构建会话上下文
  const sessionContext = buildSessionContext({
    accountId,
    senderId,
    senderName,
    conversationType: data.conversationType,
    conversationId: data.conversationId,
    groupSubject: data.conversationTitle,
    separateSessionByConversation: config.separateSessionByConversation,
    groupSessionScope: config.groupSessionScope,
    sharedMemoryAcrossConversations: config.sharedMemoryAcrossConversations,
  });


  // 构建消息内容
  // ✅ 使用 normalizeSlashCommand 归一化新会话命令
  const rawText = content.text || '';
  
  // 归一化命令（将 /reset、/clear、新会话 等别名统一为 /new）
  const normalizedText = normalizeSlashCommand(rawText);
  let userContent = normalizedText || (content.imageUrls.length > 0 ? '请描述这张图片' : '');

  // ===== 图片下载到本地文件 =====
  const imageLocalPaths: string[] = [];
  
  log?.info?.(`处理消息: accountId=${accountId}, sender=${senderName}, text=${content.text.slice(0, 50)}...`);
  
  // 处理 imageUrls（来自富文本消息）
  for (let i = 0; i < content.imageUrls.length; i++) {
    const url = content.imageUrls[i];
    try {
      log?.info?.(`处理图片 ${i + 1}/${content.imageUrls.length}: ${url.slice(0, 50)}...`);
      
      if (url.startsWith('downloadCode:')) {
        const code = url.slice('downloadCode:'.length);
        const localPath = await downloadMediaByCode(code, config, agentWorkspaceDir, log);
        if (localPath) {
          imageLocalPaths.push(localPath);
          log?.info?.(`图片下载成功 ${i + 1}/${content.imageUrls.length}`);
        } else {
          log?.warn?.(`图片下载失败 ${i + 1}/${content.imageUrls.length}`);
        }
      } else {
        const localPath = await downloadImageToFile(url, agentWorkspaceDir, log);
        if (localPath) {
          imageLocalPaths.push(localPath);
          log?.info?.(`图片下载成功 ${i + 1}/${content.imageUrls.length}`);
        } else {
          log?.warn?.(`图片下载失败 ${i + 1}/${content.imageUrls.length}`);
        }
      }
    } catch (err: any) {
      log?.error?.(`图片下载异常 ${i + 1}/${content.imageUrls.length}: ${err.message}`);
    }
  }

  // 处理 downloadCodes（来自 picture 消息，fileNames 为空的是图片）
  for (let i = 0; i < content.downloadCodes.length; i++) {
    const code = content.downloadCodes[i];
    const fileName = content.fileNames[i];
    if (!fileName) {
      try {
        log?.info?.(`处理 downloadCode 图片 ${i + 1}/${content.downloadCodes.length}`);
        const localPath = await downloadMediaByCode(code, config, agentWorkspaceDir, log);
        if (localPath) {
          imageLocalPaths.push(localPath);
          log?.info?.(`downloadCode 图片下载成功 ${i + 1}/${content.downloadCodes.length}`);
        } else {
          log?.warn?.(`downloadCode 图片下载失败 ${i + 1}/${content.downloadCodes.length}`);
        }
      } catch (err: any) {
        log?.error?.(`downloadCode 图片下载异常 ${i + 1}/${content.downloadCodes.length}: ${err.message}`);
      }
    }
  }
  
  log?.info?.(`图片下载完成: 成功=${imageLocalPaths.length}, 总数=${content.imageUrls.length + content.downloadCodes.filter((_, i) => !content.fileNames[i]).length}`);



  // ===== 文件附件处理：自动下载并解析内容 =====
  const fileContentParts: string[] = [];
  for (let i = 0; i < content.downloadCodes.length; i++) {
    const code = content.downloadCodes[i];
    const fileName = content.fileNames[i];
    if (!fileName) continue;

    try {
      log?.info?.(`处理文件附件 ${i + 1}/${content.downloadCodes.length}: ${fileName}`);
      
      // 获取下载链接
      const downloadUrl = await getFileDownloadUrl(code, fileName, config, log);
      if (!downloadUrl) {
        fileContentParts.push(`⚠️ 文件获取失败: ${fileName}`);
        continue;
      }

      // 下载文件到本地
      const localPath = await downloadFileToLocal(downloadUrl, fileName, agentWorkspaceDir, log);
      if (!localPath) {
        fileContentParts.push(`⚠️ 文件下载失败: ${fileName}\n🔗 [点击下载](${downloadUrl})`);
        continue;
      }

      // 识别文件类型
      const ext = path.extname(fileName).toLowerCase();
      let fileType = '文件';
      
      if (['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm'].includes(ext)) {
        fileType = '视频';
      } else if (['.mp3', '.wav', '.aac', '.ogg', '.m4a', '.flac', '.wma'].includes(ext)) {
        fileType = '音频';
      } else if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
        fileType = '图片';
      } else if (['.txt', '.md', '.json', '.xml', '.yaml', '.yml', '.csv', '.log', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.sh', '.bat'].includes(ext)) {
        fileType = '文本文件';
      } else if (['.docx', '.doc'].includes(ext)) {
        fileType = 'Word 文档';
      } else if (ext === '.pdf') {
        fileType = 'PDF 文档';
      } else if (['.xlsx', '.xls'].includes(ext)) {
        fileType = 'Excel 表格';
      } else if (['.pptx', '.ppt'].includes(ext)) {
        fileType = 'PPT 演示文稿';
      } else if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) {
        fileType = '压缩包';
      }

      // 解析文件内容
      const parseResult = await parseFileContent(localPath, fileName, log);
      
      if (parseResult.type === 'text' && parseResult.content) {
        // 文本类文件：将内容注入到上下文（即使解析成功也给出文件路径）
        const contentPreview = parseResult.content.length > 200 
          ? parseResult.content.slice(0, 200) + '...' 
          : parseResult.content;
        
        fileContentParts.push(
          `📄 **${fileType}**: ${fileName}\n` +
          `✅ 已解析文件内容（${parseResult.content.length} 字符）\n` +
          `💾 已保存到本地: ${localPath}\n` +
          `📝 内容预览:\n\`\`\`\n${contentPreview}\n\`\`\`\n\n` +
          `📋 完整内容:\n${parseResult.content}`
        );
        log?.info?.(`文件解析成功: ${fileName}, 内容长度=${parseResult.content.length}`);
      } else if (parseResult.type === 'text' && !parseResult.content) {
        // 文本类文件但解析失败
        fileContentParts.push(
          `📄 **${fileType}**: ${fileName}\n` +
          `⚠️ 文件解析失败，已保存到本地\n` +
          `💾 本地路径: ${localPath}\n` +
          `🔗 [点击下载](${downloadUrl})`
        );
        log?.warn?.(`文件解析失败: ${fileName}`);
      } else {
        // 二进制文件：只保存到磁盘
        // 特殊处理音频文件的语音识别文本
        if (fileType === '音频' && content.text && content.text !== '[语音消息]') {
          fileContentParts.push(
            `🎤 **${fileType}**: ${fileName}\n` +
            `📝 语音识别: ${content.text}\n` +
            `💾 已保存到本地: ${localPath}\n` +
            `🔗 [点击下载](${downloadUrl})`
          );
        } else {
          fileContentParts.push(
            `📎 **${fileType}**: ${fileName}\n` +
            `💾 已保存到本地: ${localPath}\n` +
            `🔗 [点击下载](${downloadUrl})`
          );
        }
        log?.info?.(`二进制文件已保存: ${fileName}, path=${localPath}`);
      }
    } catch (err: any) {
      log?.error?.(`文件处理异常: ${fileName}, error=${err.message}`);
      fileContentParts.push(`⚠️ 文件处理失败: ${fileName}`);
    }
  }

  if (fileContentParts.length > 0) {
    const fileText = fileContentParts.join('\n\n');
    userContent = userContent ? `${userContent}\n\n${fileText}` : fileText;
  }

  if (!userContent && imageLocalPaths.length === 0) return;

  // ===== 贴处理中表情 =====
  addEmotionReply(config, data, log).catch(err => {
    log?.warn?.(`贴表情失败: ${err.message}`);
  });

  // ===== 异步模式：立即回执 + 后台执行 + 主动推送结果 =====
  const asyncMode = config.asyncMode === true;
  log?.info?.(`asyncMode 检测: config.asyncMode=${config.asyncMode}, asyncMode=${asyncMode}`);
  
  const proactiveTarget = isDirect
    ? { userId: senderId }
    : { openConversationId: data.conversationId };

  if (asyncMode) {
    log?.info?.(`进入异步模式分支`);
    const ackText = config.ackText || '🫡 任务已接收，处理中...';
    try {
      await sendProactive(config, proactiveTarget, ackText, {
        msgType: 'text',
        useAICard: false,
        fallbackToNormal: true,
        log,
      });
    } catch (ackErr: any) {
      log?.warn?.(`Failed to send acknowledgment: ${ackErr?.message || ackErr}`);
    }
  }

  // ===== 使用 SDK 的 dispatchReplyFromConfig =====
  try {
    const core = getDingtalkRuntime();
    
    // 构建消息体（添加图片）
    let finalContent = userContent;
    if (imageLocalPaths.length > 0) {
      const imageMarkdown = imageLocalPaths.map(p => `![image](file://${p})`).join('\n');
      finalContent = finalContent ? `${finalContent}\n\n${imageMarkdown}` : imageMarkdown;
    }

    // 构建 envelope 格式的消息
    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
    const envelopeFrom = isDirect ? senderId : `${data.conversationId}:${senderId}`;
    
    const body = core.channel.reply.formatAgentEnvelope({
      channel: "DingTalk",
      from: envelopeFrom,
      timestamp: new Date(),
      envelope: envelopeOptions,
      body: finalContent,
    });

    // 手动实现路由匹配（支持通配符 *）
    const chatType = isDirect ? "direct" : "group";
    const peerId = isDirect ? senderId : data.conversationId;
    
    // 手动匹配 bindings（支持通配符 *）
    let matchedAgentId: string | null = null;
    let matchedBy = 'default';
    
    if (cfg.bindings && cfg.bindings.length > 0) {
      for (const binding of cfg.bindings) {
        const match = binding.match;
        
        // 检查 channel
        if (match.channel && match.channel !== "dingtalk-connector") {
          continue;
        }
        
        // 检查 accountId
        if (match.accountId && match.accountId !== accountId) {
          continue;
        }
        
        // 检查 peer
        if (match.peer) {
          // 检查 peer.kind
          if (match.peer.kind && match.peer.kind !== sessionContext.chatType) {
            continue;
          }
          
          // ✅ 使用 sessionContext.peerId 进行匹配（支持通配符 *）
          if (match.peer.id && match.peer.id !== '*' && match.peer.id !== sessionContext.peerId) {
            continue;
          }
        }
        
        // 匹配成功
        matchedAgentId = binding.agentId;
        matchedBy = 'binding';
        break;
      }
    }
    
    // 如果没有匹配到，使用默认 agent
    if (!matchedAgentId) {
      matchedAgentId = cfg.defaultAgent || 'main';
      log?.info?.(`未匹配到 binding，使用默认 agent: ${matchedAgentId}`);
    }
    
    // ✅ 使用 SDK 标准方法构建 sessionKey，符合 OpenClaw 规范
    // 格式：agent:{agentId}:{channel}:{peerKind}:{peerId}
    // ✅ 修复：使用 sessionContext.peerId，确保会话隔离配置生效
    // ✅ 关键修复：传递 dmScope 参数，让 SDK 使用配置文件中的 session.dmScope 设置
    const dmScope = cfg.session?.dmScope || 'per-channel-peer';
    log?.info?.(`🔍 构建 sessionKey 前的参数: agentId=${matchedAgentId}, channel=dingtalk-connector, accountId=${accountId}, chatType=${sessionContext.chatType}, peerId=${sessionContext.peerId}, dmScope=${dmScope}`);
    const sessionKey = core.channel.routing.buildAgentSessionKey({
      agentId: matchedAgentId,
      channel: 'dingtalk-connector',  // ✅ 使用 'dingtalk-connector' 而不是 'dingtalk'
      accountId: accountId,
      peer: {
        kind: sessionContext.chatType,  // ✅ 使用 sessionContext.chatType
        id: sessionContext.peerId,      // ✅ 使用 sessionContext.peerId（包含会话隔离逻辑）
      },
      dmScope: dmScope,  // ✅ 传递 dmScope 参数，确保生成完整格式的 sessionKey
    });
    log?.info?.(`路由解析完成: agentId=${matchedAgentId}, sessionKey=${sessionKey}, matchedBy=${matchedBy}`);
    
    // 构建 inbound context，使用解析后的 sessionKey
    log?.info?.(`开始构建 inbound context...`);
    
    // ✅ 计算正确的 To 字段
    const toField = isDirect ? senderId : data.conversationId;
    log?.info?.(`构建 inbound context: isDirect=${isDirect}, senderId=${senderId}, conversationId=${data.conversationId}, To=${toField}`);

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: body,
      BodyForAgent: finalContent,
      RawBody: userContent,
      CommandBody: userContent,
      From: senderId,
      To: toField,  // ✅ 修复：单聊用 senderId，群聊用 conversationId
      SessionKey: sessionKey,  // ✅ 使用手动匹配的 sessionKey
      AccountId: accountId,
      ChatType: chatType,
      GroupSubject: isDirect ? undefined : data.conversationId,
      SenderName: senderId,
      SenderId: senderId,
      Provider: "dingtalk-connector" as const,
      Surface: "dingtalk-connector" as const,
      MessageSid: data.msgId,
      Timestamp: Date.now(),
      CommandAuthorized: true,
      OriginatingChannel: "dingtalk-connector" as const,
      OriginatingTo: toField,  // ✅ 修复：应该使用 toField，而不是 accountId
    });

    // 创建 reply dispatcher，使用解析后的 agentId
    const { dispatcher, replyOptions, markDispatchIdle, getAsyncModeResponse } = createDingtalkReplyDispatcher({
      cfg,
      agentId: matchedAgentId,  // ✅ 使用手动匹配的 agentId
      runtime: runtime as RuntimeEnv,
      conversationId: data.conversationId,
      senderId,
      isDirect,
      accountId,
      messageCreateTimeMs: Date.now(),
      sessionWebhook: data.sessionWebhook,
      asyncMode,
    });

    // 使用 SDK 的 dispatchReplyFromConfig
    log?.info?.(`调用 withReplyDispatcher，asyncMode=${asyncMode}`);
    log?.info?.(`准备调用 withReplyDispatcher...`);
    
    let dispatchResult;
    try {
      dispatchResult = await core.channel.reply.withReplyDispatcher({
        dispatcher,
        onSettled: () => {
          log?.info?.(`onSettled 被调用`);
          markDispatchIdle();
        },
        run: async () => {
          log?.info?.(`run 被调用，开始 dispatchReplyFromConfig`);
          log?.info?.(`ctxPayload.SessionKey=${ctxPayload.SessionKey}`);
          log?.info?.(`ctxPayload.Body 长度=${ctxPayload.Body?.length || 0}`);
          log?.info?.(`replyOptions keys=${Object.keys(replyOptions).join(',')}`);
          
          const result = await core.channel.reply.dispatchReplyFromConfig({
            ctx: ctxPayload,
            cfg,
            dispatcher,
            replyOptions,
          });
          
          log?.info?.(`dispatchReplyFromConfig 返回: queuedFinal=${result.queuedFinal}, counts=${JSON.stringify(result.counts)}`);
          return result;
        },
      });
      log?.info?.(`withReplyDispatcher 返回成功`);
    } catch (dispatchErr: any) {
      log?.error?.(`withReplyDispatcher 抛出异常: ${dispatchErr?.message || dispatchErr}`);
      log?.error?.(`异常堆栈: ${dispatchErr?.stack || 'no stack'}`);
      log?.error?.(`消息处理异常，但不阻塞后续消息: ${dispatchErr?.message || dispatchErr}`);

      // ⚠️ 不要直接 throw，避免阻塞后续消息处理
      // 记录错误后继续执行，确保后续消息能正常处理
      dispatchResult = { queuedFinal: false, counts: { final: 0, partial: 0, tool: 0 } };
    }
    
    const { queuedFinal, counts } = dispatchResult;
    log?.info?.(`SDK dispatch 完成: queuedFinal=${queuedFinal}, replies=${counts.final}, asyncMode=${asyncMode}`);

    // ===== 异步模式：主动推送最终结果 =====
    if (asyncMode) {
      try {
        const fullResponse = getAsyncModeResponse();
        const oapiToken = await getOapiAccessToken(config);
        let finalText = fullResponse;

        if (oapiToken) {
          finalText = await processLocalImages(finalText, oapiToken, log);

          const mediaTarget: AICardTarget = isDirect
            ? { type: 'user', userId: senderId }
            : { type: 'group', openConversationId: data.conversationId };
          
          // ✅ 处理 Markdown 标记格式的媒体文件
          finalText = await processVideoMarkers(
            finalText,
            '',
            config,
            oapiToken,
            log,
            true,  // ✅ 使用主动 API 模式
            mediaTarget
          );
          finalText = await processAudioMarkers(
            finalText,
            '',
            config,
            oapiToken,
            log,
            true,  // ✅ 使用主动 API 模式
            mediaTarget
          );
          finalText = await processFileMarkers(
            finalText,
            '',
            config,
            oapiToken,
            log,
            true,  // ✅ 使用主动 API 模式
            mediaTarget
          );

          // ✅ 处理裸露的本地文件路径（绕过 OpenClaw SDK 的 bug）
          const { processRawMediaPaths } = await import('../services/media.js');
          finalText = await processRawMediaPaths(
            finalText,
            config,
            oapiToken,
            log,
            mediaTarget
          );
        }

        const textToSend = finalText.trim() || '✅ 任务执行完成（无文本输出）';
        const title =
          textToSend.split('\n')[0]?.replace(/^[#*\s\->]+/, '').trim() || '消息';
        await sendProactive(config, proactiveTarget, textToSend, {
          msgType: 'markdown',
          title,
          useAICard: false,
          fallbackToNormal: true,
          log,
        });
      } catch (asyncErr: any) {
        const errMsg = `⚠️ 任务执行失败: ${asyncErr?.message || asyncErr}`;
        try {
          await sendProactive(config, proactiveTarget, errMsg, {
            msgType: 'text',
            useAICard: false,
            fallbackToNormal: true,
            log,
          });
        } catch (sendErr: any) {
          log?.error?.(`错误通知发送失败: ${sendErr?.message || sendErr}`);
        }
      }
    }

  } catch (err: any) {
    log?.error?.(`SDK dispatch 失败: ${err.message}`);
    
    // 降级：发送错误消息
    try {
      const token = await getAccessToken(config);
      const body: any = { 
        msgtype: 'text', 
        text: { content: `抱歉，处理请求时出错: ${err.message}` } 
      };
      if (!isDirect) body.at = { atUserIds: [senderId], isAtAll: false };
      
      await dingtalkHttp.post(sessionWebhook, body, {
        headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
      });
    } catch (fallbackErr: any) {
      log?.error?.(`错误消息发送也失败: ${fallbackErr.message}`);
    }
  }

  // ===== 撤回处理中表情 =====
  // 使用 await 确保表情撤销完成后再结束函数
  try {
    await recallEmotionReply(config, data, log);
  } catch (err: any) {
    log?.warn?.(`撤回表情异常: ${err.message}`);
  }
}

/**
 * 消息处理入口函数（带队列管理）
 * 确保同一会话+agent的消息按顺序处理，避免并发冲突
 */
export async function handleDingTalkMessage(params: HandleMessageParams): Promise<void> {
  const { accountId, data, log, cfg } = params;

  // 构建会话标识（与会话上下文保持一致）
  const isDirect = data.conversationType === '1';
  const senderId = data.senderStaffId || data.senderId;
  const conversationId = data.conversationId;
  const baseSessionId = isDirect ? senderId : conversationId;

  if (!baseSessionId) {
    log?.warn?.('无法构建会话标识，跳过队列管理');
    return handleDingTalkMessageInternal(params);
  }
  
  // 解析 agentId（与消息处理逻辑保持一致）
  const chatType = isDirect ? "direct" : "group";
  const peerId = isDirect ? senderId : conversationId;

  let matchedAgentId: string | null = null;
  if (cfg.bindings && cfg.bindings.length > 0) {
    for (const binding of cfg.bindings) {
      const match = binding.match;
      if (match.channel && match.channel !== "dingtalk-connector") continue;
      if (match.accountId && match.accountId !== accountId) continue;
      if (match.peer) {
        if (match.peer.kind && match.peer.kind !== chatType) continue;
        if (match.peer.id && match.peer.id !== '*' && match.peer.id !== peerId) continue;
      }
      matchedAgentId = binding.agentId;
      break;
    }
  }
  if (!matchedAgentId) {
    matchedAgentId = cfg.defaultAgent || 'main';
  }
  
  // 构建队列标识：会话 + agentId
  // 这样不同 agent 可以并发处理，同一 agent 的同一会话串行处理
  const queueKey = `${baseSessionId}:${matchedAgentId}`;

  try {

    // 更新会话活跃时间
    sessionLastActivity.set(queueKey, Date.now());

    // 获取该会话+agent的上一个处理任务
    const previousTask = sessionQueues.get(queueKey) || Promise.resolve();

    // 创建当前消息的处理任务
    const currentTask = previousTask
      .then(async () => {
        log?.info?.(`[队列] 开始处理消息，queueKey=${queueKey}`);
        await handleDingTalkMessageInternal(params);
        log?.info?.(`[队列] 消息处理完成，queueKey=${queueKey}`);
      })
      .catch((err: any) => {
        log?.error?.(`[队列] 消息处理异常，queueKey=${queueKey}, error=${err.message}`);
        // 不抛出错误，避免阻塞后续消息
      })
      .finally(() => {
        // 如果当前任务是队列中的最后一个任务，清理队列
        if (sessionQueues.get(queueKey) === currentTask) {
          sessionQueues.delete(queueKey);
          log?.info?.(`[队列] 队列已清空，queueKey=${queueKey}`);
        }
      });
    
    // 更新队列
    sessionQueues.set(queueKey, currentTask);

    // 等待当前任务完成
    await currentTask;
    console.log(`[DEBUG] 任务执行完成`);
  } catch (err: any) {
    console.error(`[DEBUG] 队列管理异常: ${err.message}`);
    console.error(`[DEBUG] 队列管理异常堆栈: ${err.stack}`);
    // 如果队列管理失败，直接调用内部处理函数
    return handleDingTalkMessageInternal(params);
  }
}

// handleDingTalkMessage 已在函数定义处直接导出
