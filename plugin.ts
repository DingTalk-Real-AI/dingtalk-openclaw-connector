/**
 * DingTalk Channel Plugin for Moltbot
 *
 * 通过钉钉 Stream 模式连接，支持 AI Card 流式响应。
 * 完整接入 Moltbot 消息处理管道。
 */

import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ClawdbotPluginApi, PluginRuntime, ClawdbotConfig } from 'clawdbot/plugin-sdk';
import { createSocketManager, addToPendingAckQueue, removeFromPendingAckQueue, clearPendingAckQueue } from './src/socket-manager';

// ============ 常量 ============

export const id = 'dingtalk-connector';

/** 默认账号 ID，用于标记单账号模式（无 accounts 配置）时的内部标识，映射到 'main' agent */
const DEFAULT_ACCOUNT_ID = '__default__';

let runtime: PluginRuntime | null = null;

function getRuntime(): PluginRuntime {
  if (!runtime) throw new Error('DingTalk runtime not initialized');
  return runtime;
}

// ============ Session 管理 ============

/** 用户会话状态：记录最后活跃时间和当前 session 标识 */
interface UserSession {
  lastActivity: number;
  sessionId: string;  // 格式: dingtalk-connector:<senderId> 或 dingtalk-connector:<senderId>:<timestamp>
}

/** 用户会话缓存 Map<senderId, UserSession> */
const userSessions = new Map<string, UserSession>();

/** 消息去重缓存 Map<messageId, timestamp> - 防止同一消息被重复处理 */
const processedMessages = new Map<string, number>();

/** 消息去重缓存过期时间（5分钟） */
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
  // 定期清理（每处理100条消息清理一次）
  if (processedMessages.size >= 100) {
    cleanupProcessedMessages();
  }
}

/** 新会话触发命令 */
const NEW_SESSION_COMMANDS = ['/new', '/reset', '/clear', '新会话', '重新开始', '清空对话'];

/** 检查消息是否是新会话命令 */
function normalizeSlashCommand(text: string): string {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (NEW_SESSION_COMMANDS.some(cmd => lower === cmd.toLowerCase())) {
    return '/new';
  }
  return text;
}

/**
 * OpenClaw 标准会话上下文
 * 遵循 OpenClaw session.dmScope 机制，让 Gateway 根据配置自动处理会话隔离
 */
interface SessionContext {
  channel: 'dingtalk-connector';
  accountId: string;
  chatType: 'direct' | 'group';
  peerId: string;
  conversationId?: string;
  senderName?: string;
  groupSubject?: string;
}

/**
 * 构建 OpenClaw 标准会话上下文
 * 遵循 OpenClaw session.dmScope 机制，让 Gateway 根据配置自动处理会话隔离
 *
 * @param separateSessionByConversation - 是否按单聊/群聊/群区分 session（默认 true）
 *   - true: 单聊、群聊、不同群各自拥有独立的 session
 *   - false: 按用户维度维护 session，不区分单聊/群聊（兼容旧行为）
 * @param groupSessionScope - 群聊会话隔离策略（仅当 separateSessionByConversation=true 时生效）
 *   - 'group': 整个群共享一个会话（默认）
 *   - 'group_sender': 群内每个用户独立会话
 */
function buildSessionContext(params: {
  accountId: string;
  senderId: string;
  senderName?: string;
  conversationType: string;
  conversationId?: string;
  groupSubject?: string;
  separateSessionByConversation?: boolean;
  groupSessionScope?: 'group' | 'group_sender';
}): SessionContext {
  const { accountId, senderId, senderName, conversationType, conversationId, groupSubject, separateSessionByConversation, groupSessionScope } = params;
  const isDirect = conversationType === '1';

  // separateSessionByConversation=false 时，不区分单聊/群聊，按用户维度维护 session
  if (separateSessionByConversation === false) {
    return {
      channel: 'dingtalk-connector',
      accountId,
      chatType: isDirect ? 'direct' : 'group',
      peerId: senderId, // 只用 senderId，不区分会话
      senderName,
    };
  }

  // 以下是 separateSessionByConversation=true（默认）的逻辑
  if (isDirect) {
    // 单聊：peerId 为发送者 ID，由 OpenClaw Gateway 根据 dmScope 配置处理
    return {
      channel: 'dingtalk-connector',
      accountId,
      chatType: 'direct',
      peerId: senderId,
      senderName,
    };
  }

  // 群聊：根据 groupSessionScope 配置决定会话隔离策略
  if (groupSessionScope === 'group_sender') {
    // 群内每个用户独立会话
    return {
      channel: 'dingtalk-connector',
      accountId,
      chatType: 'group',
      peerId: `${conversationId}:${senderId}`,
      conversationId,
      senderName,
      groupSubject,
    };
  }

  // 默认：整个群共享一个会话
  return {
    channel: 'dingtalk-connector',
    accountId,
    chatType: 'group',
    peerId: conversationId || senderId,
    conversationId,
    senderName,
    groupSubject,
  };
}

// ============ Access Token 缓存 ============

let accessToken: string | null = null;
let accessTokenExpiry = 0;

async function getAccessToken(config: any): Promise<string> {
  const now = Date.now();
  if (accessToken && accessTokenExpiry > now + 60_000) {
    return accessToken;
  }

  const response = await axios.post('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    appKey: config.clientId,
    appSecret: config.clientSecret,
  });

  accessToken = response.data.accessToken;
  accessTokenExpiry = now + (response.data.expireIn * 1000);
  return accessToken!;
}

// ============ 配置工具 ============

function getConfig(cfg: ClawdbotConfig) {
  return (cfg?.channels as any)?.['dingtalk-connector'] || {};
}

function isConfigured(cfg: ClawdbotConfig): boolean {
  const config = getConfig(cfg);
  return Boolean(config.clientId && config.clientSecret);
}

// ============ 钉钉图片上传 ============

async function getOapiAccessToken(config: any): Promise<string | null> {
  try {
    const resp = await axios.get('https://oapi.dingtalk.com/gettoken', {
      params: { appkey: config.clientId, appsecret: config.clientSecret },
    });
    if (resp.data?.errcode === 0) return resp.data.access_token;
    return null;
  } catch {
    return null;
  }
}

/** staffId → unionId 缓存 */
const unionIdCache = new Map<string, string>();

/**
 * 通过 oapi 旧版接口将 staffId 转换为 unionId
 */
async function getUnionId(staffId: string, config: any, log?: any): Promise<string | null> {
  const cached = unionIdCache.get(staffId);
  if (cached) return cached;

  try {
    const token = await getOapiAccessToken(config);
    if (!token) {
      log?.error?.('[DingTalk] getUnionId: 无法获取 oapi access_token');
      return null;
    }
    const resp = await axios.get(`${DINGTALK_OAPI}/user/get`, {
      params: { access_token: token, userid: staffId },
      timeout: 10_000,
    });
    const unionId = resp.data?.unionid;
    if (unionId) {
      unionIdCache.set(staffId, unionId);
      log?.info?.(`[DingTalk] getUnionId: ${staffId} → ${unionId}`);
      return unionId;
    }
    log?.error?.(`[DingTalk] getUnionId: 响应中无 unionid 字段: ${JSON.stringify(resp.data)}`);
    return null;
  } catch (err: any) {
    log?.error?.(`[DingTalk] getUnionId 失败: ${err.message}`);
    return null;
  }
}

function buildMediaSystemPrompt(): string {
  return `## 钉钉图片和文件显示规则

你正在钉钉中与用户对话。

### 一、图片显示

显示图片时，直接使用本地文件路径，系统会自动上传处理。

**正确方式**：
\`\`\`markdown
![描述](file:///path/to/image.jpg)
![描述](/tmp/screenshot.png)
![描述](/Users/xxx/photo.jpg)
\`\`\`

**禁止**：
- 不要自己执行 curl 上传
- 不要猜测或构造 URL
- **不要对路径进行转义（如使用反斜杠 \\ ）**

直接输出本地路径即可，系统会自动上传到钉钉。

### 二、视频分享

**何时分享视频**：
- ✅ 用户明确要求**分享、发送、上传**视频时
- ❌ 仅生成视频保存到本地时，**不需要**分享

**视频标记格式**：
当需要分享视频时，在回复**末尾**添加：

\`\`\`
[DINGTALK_VIDEO]{"path":"<本地视频路径>"}[/DINGTALK_VIDEO]
\`\`\`

**支持格式**：mp4（最大 20MB）

**重要**：
- 视频大小不得超过 20MB，超过限制时告知用户
- 仅支持 mp4 格式
- 系统会自动提取视频时长、分辨率并生成封面

### 三、音频分享

**何时分享音频**：
- ✅ 用户明确要求**分享、发送、上传**音频/语音文件时
- ❌ 仅生成音频保存到本地时，**不需要**分享

**音频标记格式**：
当需要分享音频时，在回复**末尾**添加：

\`\`\`
[DINGTALK_AUDIO]{"path":"<本地音频路径>"}[/DINGTALK_AUDIO]
\`\`\`

**支持格式**：ogg、amr（最大 20MB）

**重要**：
- 音频大小不得超过 20MB，超过限制时告知用户
- 系统会自动提取音频时长

### 四、文件分享

**何时分享文件**：
- ✅ 用户明确要求**分享、发送、上传**文件时
- ❌ 仅生成文件保存到本地时，**不需要**分享

**文件标记格式**：
当需要分享文件时，在回复**末尾**添加：

\`\`\`
[DINGTALK_FILE]{"path":"<本地文件路径>","fileName":"<文件名>","fileType":"<扩展名>"}[/DINGTALK_FILE]
\`\`\`

**支持的文件类型**：几乎所有常见格式

**重要**：文件大小不得超过 20MB，超过限制时告知用户文件过大。`;
}

// ============ 图片后处理：自动上传本地图片到钉钉 ============

/**
 * 匹配 markdown 图片中的本地文件路径（跨平台）：
 * - ![alt](file:///path/to/image.jpg)
 * - ![alt](MEDIA:/var/folders/xxx.jpg)
 * - ![alt](attachment:///path.jpg)
 * macOS:
 * - ![alt](/tmp/xxx.jpg)
 * - ![alt](/var/folders/xxx.jpg)
 * - ![alt](/Users/xxx/photo.jpg)
 * Linux:
 * - ![alt](/home/user/photo.jpg)
 * - ![alt](/root/photo.jpg)
 * Windows:
 * - ![alt](C:\Users\xxx\photo.jpg)
 * - ![alt](C:/Users/xxx/photo.jpg)
 */
const LOCAL_IMAGE_RE = /!\[([^\]]*)\]\(((?:file:\/\/\/|MEDIA:|attachment:\/\/\/)[^)]+|\/(?:tmp|var|private|Users|home|root)[^)]+|[A-Za-z]:[\\/ ][^)]+)\)/g;

/** 图片文件扩展名 */
const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|bmp|webp|tiff|svg)$/i;

/**
 * 匹配纯文本中的本地图片路径（不在 markdown 图片语法中，跨平台）：
 * macOS:
 * - `/var/folders/.../screenshot.png`
 * - `/tmp/image.jpg`
 * - `/Users/xxx/photo.png`
 * Linux:
 * - `/home/user/photo.png`
 * - `/root/photo.png`
 * Windows:
 * - `C:\Users\xxx\photo.png`
 * - `C:/temp/image.jpg`
 * 支持 backtick 包裹: `path`
 */
const BARE_IMAGE_PATH_RE = /`?((?:\/(?:tmp|var|private|Users|home|root)\/[^\s`'",)]+|[A-Za-z]:[\\/][^\s`'",)]+)\.(?:png|jpg|jpeg|gif|bmp|webp))`?/gi;

/** 去掉 file:// / MEDIA: / attachment:// 前缀，得到实际的绝对路径 */
function toLocalPath(raw: string): string {
  let path = raw;
  if (path.startsWith('file://')) path = path.replace('file://', '');
  else if (path.startsWith('MEDIA:')) path = path.replace('MEDIA:', '');
  else if (path.startsWith('attachment://')) path = path.replace('attachment://', '');

  // 解码 URL 编码的路径（如中文字符 %E5%9B%BE → 图）
  try {
    path = decodeURIComponent(path);
  } catch {
    // 解码失败则保持原样
  }
  return path;
}

/**
 * 通用媒体文件上传函数
 * @param filePath 文件路径
 * @param mediaType 媒体类型：image, file, video, voice
 * @param oapiToken 钉钉 access_token
 * @param maxSize 最大文件大小（字节），默认 20MB
 * @param log 日志对象
 * @returns media_id 或 null
 */
async function uploadMediaToDingTalk(
  filePath: string,
  mediaType: 'image' | 'file' | 'video' | 'voice',
  oapiToken: string,
  maxSize: number = 20 * 1024 * 1024,
  log?: any,
): Promise<string | null> {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const FormData = (await import('form-data')).default;

    const absPath = toLocalPath(filePath);
    if (!fs.existsSync(absPath)) {
      log?.warn?.(`[DingTalk][${mediaType}] 文件不存在: ${absPath}`);
      return null;
    }

    // 检查文件大小
    const stats = fs.statSync(absPath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    if (stats.size > maxSize) {
      const maxSizeMB = (maxSize / (1024 * 1024)).toFixed(0);
      log?.warn?.(`[DingTalk][${mediaType}] 文件过大: ${absPath}, 大小: ${fileSizeMB}MB, 超过限制 ${maxSizeMB}MB`);
      return null;
    }

    const form = new FormData();
    form.append('media', fs.createReadStream(absPath), {
      filename: path.basename(absPath),
      contentType: mediaType === 'image' ? 'image/jpeg' : 'application/octet-stream',
    });

    log?.info?.(`[DingTalk][${mediaType}] 上传文件: ${absPath} (${fileSizeMB}MB)`);
    const resp = await axios.post(
      `https://oapi.dingtalk.com/media/upload?access_token=${oapiToken}&type=${mediaType}`,
      form,
      { headers: form.getHeaders(), timeout: 60_000 },
    );

    const mediaId = resp.data?.media_id;
    if (mediaId) {
      log?.info?.(`[DingTalk][${mediaType}] 上传成功: media_id=${mediaId}`);
      return mediaId;
    }
    log?.warn?.(`[DingTalk][${mediaType}] 上传返回无 media_id: ${JSON.stringify(resp.data)}`);
    return null;
  } catch (err: any) {
    log?.error?.(`[DingTalk][${mediaType}] 上传失败: ${err.message}`);
    return null;
  }
}

/** 扫描内容中的本地图片路径，上传到钉钉并替换为 media_id */
async function processLocalImages(
  content: string,
  oapiToken: string | null,
  log?: any,
): Promise<string> {
  if (!oapiToken) {
    log?.warn?.(`[DingTalk][Media] 无 oapiToken，跳过图片后处理`);
    return content;
  }

  let result = content;

  // 第一步：匹配 markdown 图片语法 ![alt](path)
  const mdMatches = [...content.matchAll(LOCAL_IMAGE_RE)];
  if (mdMatches.length > 0) {
    log?.info?.(`[DingTalk][Media] 检测到 ${mdMatches.length} 个 markdown 图片，开始上传...`);
    for (const match of mdMatches) {
      const [fullMatch, alt, rawPath] = match;
      // 清理转义字符（AI 可能会对含空格的路径添加 \ ）
      const cleanPath = rawPath.replace(/\\ /g, ' ');
      const mediaId = await uploadMediaToDingTalk(cleanPath, 'image', oapiToken, 20 * 1024 * 1024, log);
      if (mediaId) {
        result = result.replace(fullMatch, `![${alt}](${mediaId})`);
      }
    }
  }

  // 第二步：匹配纯文本中的本地图片路径（如 `/var/folders/.../xxx.png`）
  // 排除已被 markdown 图片语法包裹的路径
  const bareMatches = [...result.matchAll(BARE_IMAGE_PATH_RE)];
  const newBareMatches = bareMatches.filter(m => {
    // 检查这个路径是否已经在 ![...](...) 中
    const idx = m.index!;
    const before = result.slice(Math.max(0, idx - 10), idx);
    return !before.includes('](');
  });

  if (newBareMatches.length > 0) {
    log?.info?.(`[DingTalk][Media] 检测到 ${newBareMatches.length} 个纯文本图片路径，开始上传...`);
    // 从后往前替换，避免 index 偏移
    for (const match of newBareMatches.reverse()) {
      const [fullMatch, rawPath] = match;
      log?.info?.(`[DingTalk][Media] 纯文本图片: "${fullMatch}" -> path="${rawPath}"`);
      const mediaId = await uploadMediaToDingTalk(rawPath, 'image', oapiToken, 20 * 1024 * 1024, log);
      if (mediaId) {
        const replacement = `![](${mediaId})`;
        result = result.slice(0, match.index!) + result.slice(match.index!).replace(fullMatch, replacement);
        log?.info?.(`[DingTalk][Media] 替换纯文本路径为图片: ${replacement}`);
      }
    }
  }

  if (mdMatches.length === 0 && newBareMatches.length === 0) {
    log?.info?.(`[DingTalk][Media] 未检测到本地图片路径`);
  }

  return result;
}

// ============ 文件后处理：提取文件标记并发送独立消息 ============

/**
 * 文件标记正则：[DINGTALK_FILE]{"path":"...","fileName":"...","fileType":"..."}[/DINGTALK_FILE]
 */
const FILE_MARKER_PATTERN = /\[DINGTALK_FILE\]({.*?})\[\/DINGTALK_FILE\]/g;

/** 视频大小限制：20MB */
const MAX_VIDEO_SIZE = 20 * 1024 * 1024;

// ============ 视频后处理：提取视频标记并发送视频消息 ============

/**
 * 视频标记正则：[DINGTALK_VIDEO]{"path":"..."}[/DINGTALK_VIDEO]
 */
const VIDEO_MARKER_PATTERN = /\[DINGTALK_VIDEO\]({.*?})\[\/DINGTALK_VIDEO\]/g;

/**
 * 音频标记正则：[DINGTALK_AUDIO]{"path":"..."}[/DINGTALK_AUDIO]
 */
const AUDIO_MARKER_PATTERN = /\[DINGTALK_AUDIO\]({.*?})\[\/DINGTALK_AUDIO\]/g;

/** 视频信息接口 */
interface VideoInfo {
  path: string;
}

/** 视频元数据接口 */
interface VideoMetadata {
  duration: number;
  width: number;
  height: number;
}

/**
 * 提取视频元数据（时长、分辨率）
 */
async function extractVideoMetadata(
  filePath: string,
  log?: any,
): Promise<VideoMetadata | null> {
  try {
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    ffmpeg.setFfmpegPath(ffmpegPath);

    return new Promise((resolve) => {
      ffmpeg.ffprobe(filePath, (err: any, metadata: any) => {
        if (err) {
          log?.error?.(`[DingTalk][Video] 提取元数据失败: ${err.message}`);
          return resolve({ duration: 0, width: 0, height: 0 });
        }

        const videoStream = metadata.streams.find((s: any) => s.codec_type === 'video');
        if (!videoStream) {
          log?.warn?.(`[DingTalk][Video] 未找到视频流`);
          return resolve({ duration: 0, width: 0, height: 0 });
        }

        const result = {
          duration: Math.floor(metadata.format.duration || 0),
          width: videoStream.width || 0,
          height: videoStream.height || 0,
        };

        log?.info?.(`[DingTalk][Video] 元数据: duration=${result.duration}s, ${result.width}x${result.height}`);
        resolve(result);
      });
    });
  } catch (err: any) {
    log?.error?.(`[DingTalk][Video] ffprobe 失败: ${err.message}`);
    return { duration: 0, width: 0, height: 0 };
  }
}

/**
 * 生成视频封面图（第1秒截图）
 */
async function extractVideoThumbnail(
  videoPath: string,
  outputPath: string,
  log?: any,
): Promise<string | null> {
  try {
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    const path = await import('path');
    ffmpeg.setFfmpegPath(ffmpegPath);

    return new Promise((resolve) => {
      ffmpeg(videoPath)
        .screenshots({
          count: 1,
          folder: path.dirname(outputPath),
          filename: path.basename(outputPath),
          timemarks: ['1'],
          size: '?x360',
        })
        .on('end', () => {
          log?.info?.(`[DingTalk][Video] 封面生成成功: ${outputPath}`);
          resolve(outputPath);
        })
        .on('error', (err: any) => {
          log?.error?.(`[DingTalk][Video] 封面生成失败: ${err.message}`);
          resolve(null);
        });
    });
  } catch (err: any) {
    log?.error?.(`[DingTalk][Video] ffmpeg 失败: ${err.message}`);
    return null;
  }
}

/**
 * 发送视频消息到钉钉
 */
async function sendVideoMessage(
  config: any,
  sessionWebhook: string,
  videoInfo: VideoInfo,
  videoMediaId: string,
  picMediaId: string,
  metadata: VideoMetadata,
  oapiToken: string,
  log?: any,
): Promise<void> {
  try {
    const path = await import('path');
    const fileName = path.basename(videoInfo.path);

    const payload = {
      msgtype: 'video',
      video: {
        duration: metadata.duration.toString(),
        videoMediaId: videoMediaId,
        videoType: 'mp4',
        picMediaId: picMediaId,
      },
    };

    log?.info?.(`[DingTalk][Video] 发送视频消息: ${fileName}, payload: ${JSON.stringify(payload)}`);
    const resp = await axios.post(sessionWebhook, payload, {
      headers: {
        'x-acs-dingtalk-access-token': oapiToken,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    if (resp.data?.success !== false) {
      log?.info?.(`[DingTalk][Video] 视频消息发送成功: ${fileName}`);
    } else {
      log?.error?.(`[DingTalk][Video] 视频消息发送失败: ${JSON.stringify(resp.data)}`);
    }
  } catch (err: any) {
    log?.error?.(`[DingTalk][Video] 发送失败: ${err.message}`);
  }
}

/**
 * 视频后处理主函数
 * 返回移除标记后的内容，并附带视频处理的状态提示
 * 
 * @param useProactiveApi 是否使用主动消息 API（用于 AI Card 场景）
 * @param target 主动 API 需要的目标信息（useProactiveApi=true 时必须提供）
 */
async function processVideoMarkers(
  content: string,
  sessionWebhook: string,
  config: any,
  oapiToken: string | null,
  log?: any,
  useProactiveApi: boolean = false,
  target?: AICardTarget,
): Promise<string> {
  const logPrefix = useProactiveApi ? '[DingTalk][Video][Proactive]' : '[DingTalk][Video]';

  if (!oapiToken) {
    log?.warn?.(`${logPrefix} 无 oapiToken，跳过视频处理`);
    return content;
  }

  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');

  // 提取视频标记
  const matches = [...content.matchAll(VIDEO_MARKER_PATTERN)];
  const videoInfos: VideoInfo[] = [];
  const invalidVideos: string[] = [];

  for (const match of matches) {
    try {
      const videoInfo = JSON.parse(match[1]) as VideoInfo;
      if (videoInfo.path && fs.existsSync(videoInfo.path)) {
        videoInfos.push(videoInfo);
        log?.info?.(`${logPrefix} 提取到视频: ${videoInfo.path}`);
      } else {
        invalidVideos.push(videoInfo.path || '未知路径');
        log?.warn?.(`${logPrefix} 视频文件不存在: ${videoInfo.path}`);
      }
    } catch (err: any) {
      log?.warn?.(`${logPrefix} 解析标记失败: ${err.message}`);
    }
  }

  if (videoInfos.length === 0 && invalidVideos.length === 0) {
    log?.info?.(`${logPrefix} 未检测到视频标记`);
    return content.replace(VIDEO_MARKER_PATTERN, '').trim();
  }

  // 先移除所有视频标记，保留其他文本内容
  let cleanedContent = content.replace(VIDEO_MARKER_PATTERN, '').trim();

  // 收集处理结果状态
  const statusMessages: string[] = [];

  // 处理无效视频
  for (const invalidPath of invalidVideos) {
    statusMessages.push(`⚠️ 视频文件不存在: ${path.basename(invalidPath)}`);
  }

  if (videoInfos.length > 0) {
    log?.info?.(`${logPrefix} 检测到 ${videoInfos.length} 个视频，开始处理...`);
  }

  // 逐个处理视频
  for (const videoInfo of videoInfos) {
    const fileName = path.basename(videoInfo.path);
    let thumbnailPath = '';
    try {
      // 1. 提取元数据
      const metadata = await extractVideoMetadata(videoInfo.path, log);
      if (!metadata) {
        log?.warn?.(`${logPrefix} 无法提取元数据: ${videoInfo.path}`);
        statusMessages.push(`⚠️ 视频处理失败: ${fileName}（无法读取视频信息，请检查 ffmpeg 是否已安装）`);
        continue;
      }

      // 2. 生成封面
      thumbnailPath = path.join(os.tmpdir(), `thumbnail_${Date.now()}.jpg`);
      const thumbnail = await extractVideoThumbnail(videoInfo.path, thumbnailPath, log);
      if (!thumbnail) {
        log?.warn?.(`${logPrefix} 无法生成封面: ${videoInfo.path}`);
        statusMessages.push(`⚠️ 视频处理失败: ${fileName}（无法生成封面）`);
        continue;
      }

      // 3. 上传视频
      const videoMediaId = await uploadMediaToDingTalk(videoInfo.path, 'video', oapiToken, MAX_VIDEO_SIZE, log);
      if (!videoMediaId) {
        log?.warn?.(`${logPrefix} 视频上传失败: ${videoInfo.path}`);
        statusMessages.push(`⚠️ 视频上传失败: ${fileName}（文件可能超过 20MB 限制）`);
        continue;
      }

      // 4. 上传封面
      const picMediaId = await uploadMediaToDingTalk(thumbnailPath, 'image', oapiToken, 20 * 1024 * 1024, log);
      if (!picMediaId) {
        log?.warn?.(`${logPrefix} 封面上传失败: ${thumbnailPath}`);
        statusMessages.push(`⚠️ 视频封面上传失败: ${fileName}`);
        continue;
      }

      // 5. 发送视频消息
      if (useProactiveApi && target) {
        await sendVideoProactive(config, target, videoMediaId, picMediaId, metadata, log);
      } else {
        await sendVideoMessage(config, sessionWebhook, videoInfo, videoMediaId, picMediaId, metadata, oapiToken, log);
      }

      log?.info?.(`${logPrefix} 视频处理完成: ${fileName}`);
      statusMessages.push(`✅ 视频已发送: ${fileName}`);
    } catch (err: any) {
      log?.error?.(`${logPrefix} 处理视频失败: ${err.message}`);
      statusMessages.push(`⚠️ 视频处理异常: ${fileName}（${err.message}）`);
    } finally {
      // 统一清理临时文件
      if (thumbnailPath) {
        try {
          fs.unlinkSync(thumbnailPath);
        } catch {
          // 文件可能不存在，忽略删除错误
        }
      }
    }
  }

  // 将状态信息附加到清理后的内容
  if (statusMessages.length > 0) {
    const statusText = statusMessages.join('\n');
    cleanedContent = cleanedContent
      ? `${cleanedContent}\n\n${statusText}`
      : statusText;
  }

  return cleanedContent;
}

/** 音频文件扩展名 */
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'amr', 'ogg', 'aac', 'flac', 'm4a'];


/** 判断是否为音频文件 */
function isAudioFile(fileType: string): boolean {
  return AUDIO_EXTENSIONS.includes(fileType.toLowerCase());
}

/** 文件大小限制：20MB（字节） */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** 文件信息接口 */
interface FileInfo {
  path: string;        // 本地文件路径
  fileName: string;    // 文件名
  fileType: string;    // 文件类型（扩展名）
}

/**
 * 从内容中提取文件标记
 * @returns { cleanedContent, fileInfos }
 */
function extractFileMarkers(content: string, log?: any): { cleanedContent: string; fileInfos: FileInfo[] } {
  const fileInfos: FileInfo[] = [];
  const matches = [...content.matchAll(FILE_MARKER_PATTERN)];

  for (const match of matches) {
    try {
      const fileInfo = JSON.parse(match[1]) as FileInfo;

      // 验证必需字段
      if (fileInfo.path && fileInfo.fileName) {
        fileInfos.push(fileInfo);
        log?.info?.(`[DingTalk][File] 提取到文件标记: ${fileInfo.fileName}`);
      }
    } catch (err: any) {
      log?.warn?.(`[DingTalk][File] 解析文件标记失败: ${match[1]}, 错误: ${err.message}`);
    }
  }

  // 移除文件标记，返回清理后的内容
  const cleanedContent = content.replace(FILE_MARKER_PATTERN, '').trim();
  return { cleanedContent, fileInfos };
}


/**
 * 发送文件消息到钉钉
 */
async function sendFileMessage(
  config: any,
  sessionWebhook: string,
  fileInfo: FileInfo,
  mediaId: string,
  oapiToken: string,
  log?: any,
): Promise<void> {
  try {
    const fileMessage = {
      msgtype: 'file',
      file: {
        mediaId: mediaId,
        fileName: fileInfo.fileName,
        fileType: fileInfo.fileType,
      },
    };

    log?.info?.(`[DingTalk][File] 发送文件消息: ${fileInfo.fileName}`);
    const resp = await axios.post(sessionWebhook, fileMessage, {
      headers: {
        'x-acs-dingtalk-access-token': oapiToken,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    if (resp.data?.success !== false) {
      log?.info?.(`[DingTalk][File] 文件消息发送成功: ${fileInfo.fileName}`);
    } else {
      log?.error?.(`[DingTalk][File] 文件消息发送失败: ${JSON.stringify(resp.data)}`);
    }
  } catch (err: any) {
    log?.error?.(`[DingTalk][File] 发送文件消息异常: ${fileInfo.fileName}, 错误: ${err.message}`);
  }
}

/**
 * 获取 ffprobe 可执行文件路径
 * 优先级: @ffprobe-installer/ffprobe > FFPROBE_PATH 环境变量 > 系统 PATH
 */
function getFfprobePath(): string {
  // 1. 尝试 @ffprobe-installer/ffprobe 包
  try {
    const ffprobePath = require('@ffprobe-installer/ffprobe').path;
    if (ffprobePath) return ffprobePath;
  } catch { /* 未安装，跳过 */ }

  // 2. 尝试环境变量
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;

  // 3. fallback 到系统 PATH
  return 'ffprobe';
}

/**
 * 提取音频文件时长（毫秒）
 * 使用 ffprobe CLI 直接获取，避免 fluent-ffmpeg 在部分运行环境中回调不触发的问题
 */
async function extractAudioDuration(
  filePath: string,
  log?: any,
): Promise<number | null> {
  try {
    const { execFile } = await import('child_process');
    const ffprobeBin = getFfprobePath();

    return new Promise((resolve) => {
      execFile(ffprobeBin, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        filePath,
      ], { timeout: 10_000 }, (err: any, stdout: string, stderr: string) => {
        if (err) {
          log?.error?.(`[DingTalk][Audio] ffprobe 执行失败 (${ffprobeBin}): ${err.message}`);
          return resolve(null);
        }

        try {
          const parsed = JSON.parse(stdout);
          const durationSec = parseFloat(parsed?.format?.duration);
          if (isNaN(durationSec)) {
            log?.warn?.(`[DingTalk][Audio] 无法解析音频时长，ffprobe 输出: ${stdout.slice(0, 200)}`);
            return resolve(null);
          }

          const durationMs = Math.floor(durationSec * 1000);
          log?.info?.(`[DingTalk][Audio] 音频时长: ${durationMs}ms (${durationSec}s)`);
          resolve(durationMs);
        } catch (parseErr: any) {
          log?.error?.(`[DingTalk][Audio] ffprobe 输出解析失败: ${parseErr.message}`);
          resolve(null);
        }
      });
    });
  } catch (err: any) {
    log?.error?.(`[DingTalk][Audio] extractAudioDuration 异常: ${err.message}`);
    return null;
  }
}

/**
 * 发送音频消息到钉钉（被动回复场景）
 */
async function sendAudioMessage(
  config: any,
  sessionWebhook: string,
  fileInfo: FileInfo,
  mediaId: string,
  oapiToken: string,
  log?: any,
  durationMs?: number,
): Promise<void> {
  try {
    // 钉钉语音消息格式
    const actualDuration = (durationMs && durationMs > 0) ? durationMs.toString() : '60000';
    const audioMessage = {
      msgtype: 'voice',
      voice: {
        mediaId: mediaId,
        duration: actualDuration,
      },
    };

    log?.info?.(`[DingTalk][Audio] 发送语音消息: ${fileInfo.fileName}`);
    const resp = await axios.post(sessionWebhook, audioMessage, {
      headers: {
        'x-acs-dingtalk-access-token': oapiToken,
        'Content-Type': 'application/json',
      },
      timeout: 10_000,
    });

    if (resp.data?.success !== false) {
      log?.info?.(`[DingTalk][Audio] 语音消息发送成功: ${fileInfo.fileName}`);
    } else {
      log?.error?.(`[DingTalk][Audio] 语音消息发送失败: ${JSON.stringify(resp.data)}`);
    }
  } catch (err: any) {
    log?.error?.(`[DingTalk][Audio] 发送语音消息异常: ${fileInfo.fileName}, 错误: ${err.message}`);
  }
}

/**
 * 处理文件标记：提取、上传、发送独立消息
 * 返回移除标记后的内容，并附带文件处理的状态提示
 * 
 * @param useProactiveApi 是否使用主动消息 API（用于 AI Card 场景，避免 sessionWebhook 失效问题）
 * @param target 主动 API 需要的目标信息（useProactiveApi=true 时必须提供）
 */
async function processFileMarkers(
  content: string,
  sessionWebhook: string,
  config: any,
  oapiToken: string | null,
  log?: any,
  useProactiveApi: boolean = false,
  target?: AICardTarget,
): Promise<string> {
  if (!oapiToken) {
    log?.warn?.(`[DingTalk][File] 无 oapiToken，跳过文件处理`);
    return content;
  }

  const { cleanedContent, fileInfos } = extractFileMarkers(content, log);

  if (fileInfos.length === 0) {
    log?.info?.(`[DingTalk][File] 未检测到文件标记`);
    return cleanedContent;
  }

  log?.info?.(`[DingTalk][File] 检测到 ${fileInfos.length} 个文件标记，开始处理... (useProactiveApi=${useProactiveApi})`);

  const statusMessages: string[] = [];

  const fs = await import('fs');

  // 逐个上传并发送文件消息
  for (const fileInfo of fileInfos) {
    // 预检查：文件是否存在、是否超限
    const absPath = toLocalPath(fileInfo.path);
    if (!fs.existsSync(absPath)) {
      statusMessages.push(`⚠️ 文件不存在: ${fileInfo.fileName}`);
      continue;
    }
    const stats = fs.statSync(absPath);
    if (stats.size > MAX_FILE_SIZE) {
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(1);
      const maxMB = (MAX_FILE_SIZE / (1024 * 1024)).toFixed(0);
      statusMessages.push(`⚠️ 文件过大无法发送: ${fileInfo.fileName}（${sizeMB}MB，限制 ${maxMB}MB）`);
      continue;
    }

    // 区分音频文件和普通文件
    if (isAudioFile(fileInfo.fileType)) {
      // 音频文件使用 voice 类型上传
      const mediaId = await uploadMediaToDingTalk(fileInfo.path, 'voice', oapiToken, MAX_FILE_SIZE, log);
      if (mediaId) {
        // 提取音频实际时长
        const audioDurationMs = await extractAudioDuration(fileInfo.path, log);
        if (useProactiveApi && target) {
          // 使用主动消息 API（适用于 AI Card 场景）
          await sendAudioProactive(config, target, fileInfo, mediaId, log, audioDurationMs ?? undefined);
        } else {
          // 使用 sessionWebhook（传统被动回复场景）
          await sendAudioMessage(config, sessionWebhook, fileInfo, mediaId, oapiToken, log, audioDurationMs ?? undefined);
        }
        statusMessages.push(`✅ 音频已发送: ${fileInfo.fileName}`);
      } else {
        log?.error?.(`[DingTalk][Audio] 音频上传失败，跳过发送: ${fileInfo.fileName}`);
        statusMessages.push(`⚠️ 音频上传失败: ${fileInfo.fileName}`);
      }
    } else {
      // 普通文件
      const mediaId = await uploadMediaToDingTalk(fileInfo.path, 'file', oapiToken, MAX_FILE_SIZE, log);
      if (mediaId) {
        if (useProactiveApi && target) {
          // 使用主动消息 API（适用于 AI Card 场景）
          await sendFileProactive(config, target, fileInfo, mediaId, log);
        } else {
          // 使用 sessionWebhook（传统被动回复场景）
          await sendFileMessage(config, sessionWebhook, fileInfo, mediaId, oapiToken, log);
        }
        statusMessages.push(`✅ 文件已发送: ${fileInfo.fileName}`);
      } else {
        log?.error?.(`[DingTalk][File] 文件上传失败，跳过发送: ${fileInfo.fileName}`);
        statusMessages.push(`⚠️ 文件上传失败: ${fileInfo.fileName}`);
      }
    }
  }

  // 将状态信息附加到清理后的内容
  if (statusMessages.length > 0) {
    const statusText = statusMessages.join('\n');
    return cleanedContent
      ? `${cleanedContent}\n\n${statusText}`
      : statusText;
  }

  return cleanedContent;
}

// ============ AI Card Streaming ============

const DINGTALK_API = 'https://api.dingtalk.com';
const DINGTALK_OAPI = 'https://oapi.dingtalk.com';
const AI_CARD_TEMPLATE_ID = '02fcf2f4-5e02-4a85-b672-46d1f715543e.schema';

// flowStatus 值与 Python SDK AICardStatus 一致（cardParamMap 的值必须是字符串）
const AICardStatus = {
  PROCESSING: '1',
  INPUTING: '2',
  FINISHED: '3',
  EXECUTING: '4',
  FAILED: '5',
} as const;

interface AICardInstance {
  cardInstanceId: string;
  accessToken: string;
  inputingStarted: boolean;
}

/**
 * 创建 AI Card 实例（被动回复场景）
 * 从钉钉回调 data 中提取目标信息，委托给通用函数
 */
async function createAICard(
  config: any,
  data: any,
  log?: any,
): Promise<AICardInstance | null> {
  const isGroup = data.conversationType === '2';

  log?.info?.(`[DingTalk][AICard] conversationType=${data.conversationType}, conversationId=${data.conversationId}, senderStaffId=${data.senderStaffId}, senderId=${data.senderId}`);

  // 构建通用目标
  const target: AICardTarget = isGroup
    ? { type: 'group', openConversationId: data.conversationId }
    : { type: 'user', userId: data.senderStaffId || data.senderId };

  return createAICardForTarget(config, target, log);
}

/**
 * 确保 Markdown 表格前有空行，否则钉钉无法正确渲染表格。
 *
 * 逐行向前看：当前行像表头（含 `|`）且下一行是分隔行时，
 * 若前一行非空且非表格行，则在表头前插入空行。
 * 支持缩进表格（行首有空白字符）。
 */
function ensureTableBlankLines(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];

  // 匹配表格分隔行 (例如 | --- | --- | 或 --- | ---)
  const tableDividerRegex = /^\s*\|?\s*:?-+:?\s*(\|?\s*:?-+:?\s*)+\|?\s*$/;
  // 匹配包含竖线的表格行
  const tableRowRegex = /^\s*\|?.*\|.*\|?\s*$/;

  const isDivider = (line: string) => line.includes('|') && tableDividerRegex.test(line);

  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i];
    const nextLine = lines[i + 1] ?? '';

    // 逻辑：
    // 1. 当前行看起来像表头（包含 |）
    // 2. 下一行是分隔行（---）
    // 3. 前一行不是空行且不是表格行
    if (
      tableRowRegex.test(currentLine) &&
      isDivider(nextLine) &&
      i > 0 && lines[i - 1].trim() !== '' && !tableRowRegex.test(lines[i - 1])
    ) {
      result.push('');
    }

    result.push(currentLine);
  }
  return result.join('\n');
}

// 流式更新 AI Card 内容
async function streamAICard(
  card: AICardInstance,
  content: string,
  finished: boolean = false,
  log?: any,
): Promise<void> {
  // 首次 streaming 前，先切换到 INPUTING 状态（与 Python SDK get_card_data(INPUTING) 一致）
  if (!card.inputingStarted) {
    const statusBody = {
      outTrackId: card.cardInstanceId,
      cardData: {
        cardParamMap: {
          flowStatus: AICardStatus.INPUTING,
          msgContent: content,
          staticMsgContent: '',
          sys_full_json_obj: JSON.stringify({
            order: ['msgContent'],  // 只声明实际使用的字段，避免部分客户端显示空占位
          }),
        },
      },
    };
    log?.info?.(`[DingTalk][AICard] PUT /v1.0/card/instances (INPUTING) outTrackId=${card.cardInstanceId}`);
    try {
      const statusResp = await axios.put(`${DINGTALK_API}/v1.0/card/instances`, statusBody, {
        headers: { 'x-acs-dingtalk-access-token': card.accessToken, 'Content-Type': 'application/json' },
      });
      log?.info?.(`[DingTalk][AICard] INPUTING 响应: status=${statusResp.status} data=${JSON.stringify(statusResp.data)}`);
    } catch (err: any) {
      log?.error?.(`[DingTalk][AICard] INPUTING 切换失败: ${err.message}, resp=${JSON.stringify(err.response?.data)}`);
      throw err;
    }
    card.inputingStarted = true;
  }

  // 调用 streaming API 更新内容
  const fixedContent = ensureTableBlankLines(content);
  const body = {
    outTrackId: card.cardInstanceId,
    guid: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    key: 'msgContent',
    content: fixedContent,
    isFull: true,  // 全量替换
    isFinalize: finished,
    isError: false,
  };

  log?.info?.(`[DingTalk][AICard] PUT /v1.0/card/streaming contentLen=${content.length} isFinalize=${finished} guid=${body.guid}`);
  try {
    const streamResp = await axios.put(`${DINGTALK_API}/v1.0/card/streaming`, body, {
      headers: { 'x-acs-dingtalk-access-token': card.accessToken, 'Content-Type': 'application/json' },
    });
    log?.info?.(`[DingTalk][AICard] streaming 响应: status=${streamResp.status}`);
  } catch (err: any) {
    log?.error?.(`[DingTalk][AICard] streaming 更新失败: ${err.message}, resp=${JSON.stringify(err.response?.data)}`);
    throw err;
  }
}

// 完成 AI Card：先 streaming isFinalize 关闭流式通道，再 put_card_data 更新 FINISHED 状态
async function finishAICard(
  card: AICardInstance,
  content: string,
  log?: any,
): Promise<void> {
  const fixedContent = ensureTableBlankLines(content);
  log?.info?.(`[DingTalk][AICard] 开始 finish，最终内容长度=${fixedContent.length}`);

  // 1. 先用最终内容关闭流式通道（isFinalize=true），确保卡片显示替换后的内容
  await streamAICard(card, fixedContent, true, log);

  // 2. 更新卡片状态为 FINISHED
  const body = {
    outTrackId: card.cardInstanceId,
    cardData: {
      cardParamMap: {
        flowStatus: AICardStatus.FINISHED,
        msgContent: fixedContent,
        staticMsgContent: '',
        sys_full_json_obj: JSON.stringify({
          order: ['msgContent'],  // 只声明实际使用的字段，避免部分客户端显示空占位
        }),
      },
    },
    cardUpdateOptions: { updateCardDataByKey: true },
  };

  log?.info?.(`[DingTalk][AICard] PUT /v1.0/card/instances (FINISHED) outTrackId=${card.cardInstanceId}`);
  try {
    const finishResp = await axios.put(`${DINGTALK_API}/v1.0/card/instances`, body, {
      headers: { 'x-acs-dingtalk-access-token': card.accessToken, 'Content-Type': 'application/json' },
    });
    log?.info?.(`[DingTalk][AICard] FINISHED 响应: status=${finishResp.status} data=${JSON.stringify(finishResp.data)}`);
  } catch (err: any) {
    log?.error?.(`[DingTalk][AICard] FINISHED 更新失败: ${err.message}, resp=${JSON.stringify(err.response?.data)}`);
  }
}

// ============ Gateway SSE Streaming ============

// ============ Bindings 匹配逻辑 ============

interface BindingMatch {
  channel?: string;
  accountId?: string;
  peer?: {
    kind?: 'direct' | 'group';
    id?: string;
  };
}

interface Binding {
  agentId: string;
  match?: BindingMatch;
}

/**
 * 根据 OpenClaw bindings 配置解析 agentId
 *
 * 匹配优先级（从高到低）：
 * 1. peer.kind + peer.id 精确匹配（非 '*'）
 * 2. peer.kind + peer.id='*' 通配匹配
 * 3. peer.kind 匹配（无 peer.id）
 * 4. accountId 匹配
 * 5. channel 匹配
 * 6. 默认 fallback
 *
 * @param accountId 账号 ID
 * @param peerKind 会话类型：'direct'（单聊）或 'group'（群聊）
 * @param peerId 发送者 ID（单聊）或会话 ID（群聊）
 * @param log 日志对象
 * @returns 匹配到的 agentId
 */
function resolveAgentIdByBindings(
  accountId: string,
  peerKind: 'direct' | 'group',
  peerId: string,
  log?: any,
): string {
  const rt = getRuntime();
  const defaultAgentId = accountId === DEFAULT_ACCOUNT_ID ? 'main' : accountId;

  // 读取 OpenClaw 配置
  let bindings: Binding[] = [];
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(configContent);
      bindings = config.bindings || [];
    }
  } catch (err: any) {
    log?.warn?.(`[DingTalk][Bindings] 读取 OpenClaw 配置失败: ${err.message}`);
    return defaultAgentId;
  }

  if (bindings.length === 0) {
    log?.info?.(`[DingTalk][Bindings] 无 bindings 配置，使用默认 agentId=${defaultAgentId}`);
    return defaultAgentId;
  }

  // 筛选 channel='dingtalk-connector' 的 bindings
  const channelBindings = bindings.filter(b =>
    !b.match?.channel || b.match.channel === 'dingtalk-connector'
  );

  if (channelBindings.length === 0) {
    log?.info?.(`[DingTalk][Bindings] 无匹配 channel 的 bindings，使用默认 agentId=${defaultAgentId}`);
    return defaultAgentId;
  }

  log?.info?.(`[DingTalk][Bindings] 开始匹配: accountId=${accountId}, peerKind=${peerKind}, peerId=${peerId}, bindings数量=${channelBindings.length}`);

  // 按优先级匹配
  // 优先级1: peer.kind + peer.id 精确匹配
  for (const binding of channelBindings) {
    const match = binding.match || {};
    if (match.peer?.kind === peerKind &&
        match.peer?.id &&
        match.peer.id !== '*' &&
        match.peer.id === peerId) {
      // 还需检查 accountId 是否匹配（如果指定了）
      if (match.accountId && match.accountId !== accountId) continue;
      log?.info?.(`[DingTalk][Bindings] 精确匹配 peer.id: agentId=${binding.agentId}`);
      return binding.agentId || defaultAgentId;
    }
  }

  // 优先级2: peer.kind + peer.id='*' 通配匹配
  for (const binding of channelBindings) {
    const match = binding.match || {};
    if (match.peer?.kind === peerKind && match.peer?.id === '*') {
      if (match.accountId && match.accountId !== accountId) continue;
      log?.info?.(`[DingTalk][Bindings] 通配匹配 peer.kind=${peerKind}, peer.id=*: agentId=${binding.agentId}`);
      return binding.agentId || defaultAgentId;
    }
  }

  // 优先级3: 仅 peer.kind 匹配（无 peer.id）
  for (const binding of channelBindings) {
    const match = binding.match || {};
    if (match.peer?.kind === peerKind && !match.peer?.id) {
      if (match.accountId && match.accountId !== accountId) continue;
      log?.info?.(`[DingTalk][Bindings] 匹配 peer.kind=${peerKind}: agentId=${binding.agentId}`);
      return binding.agentId || defaultAgentId;
    }
  }

  // 优先级4: accountId 匹配（无 peer 配置）
  for (const binding of channelBindings) {
    const match = binding.match || {};
    if (!match.peer && match.accountId === accountId) {
      log?.info?.(`[DingTalk][Bindings] 匹配 accountId=${accountId}: agentId=${binding.agentId}`);
      return binding.agentId || defaultAgentId;
    }
  }

  // 优先级5: 仅 channel 匹配（无 peer 和 accountId）
  for (const binding of channelBindings) {
    const match = binding.match || {};
    if (!match.peer && !match.accountId) {
      log?.info?.(`[DingTalk][Bindings] 匹配 channel=dingtalk-connector: agentId=${binding.agentId}`);
      return binding.agentId || defaultAgentId;
    }
  }

  log?.info?.(`[DingTalk][Bindings] 无匹配，使用默认 agentId=${defaultAgentId}`);
  return defaultAgentId;
}

interface GatewayOptions {
  userContent: string;
  systemPrompts: string[];
  sessionContext: SessionContext;
  gatewayAuth?: string;  // token 或 password，都用 Bearer 格式
  /** 记忆归属用户标识，用于 Gateway 区分记忆；sharedMemoryAcrossConversations=true 时传 accountId，false 时传 sessionContext JSON */
  memoryUser?: string;
  /** 本地图片文件路径列表，用于 OpenClaw AgentMediaPayload */
  imageLocalPaths?: string[];
  /** 自定义 Gateway URL（如通过 Nginx 代理），用于 TLS 等场景 */
  gatewayBaseUrl?: string;
  /** 会话类型：'direct'（单聊）或 'group'（群聊），用于 bindings 匹配 */
  peerKind?: 'direct' | 'group';
  /** 发送者 ID，用于 bindings 匹配 */
  peerId?: string;
  gatewayPort?: number;
  log?: any;
}

async function* streamFromGateway(options: GatewayOptions, accountId: string): AsyncGenerator<string, void, unknown> {
  // 支持自定义 Gateway URL（如通过 Nginx 代理），用于 TLS 等场景
  const { userContent, systemPrompts, sessionKey, gatewayAuth, gatewayBaseUrl, memoryUser, imageLocalPaths, peerKind, peerId, gatewayPort, log } = options;
  const rt = getRuntime();
  const port = gatewayPort || rt.gateway?.port || 18789;
  const gatewayUrl = gatewayBaseUrl
    ? `${gatewayBaseUrl}/v1/chat/completions`
    : `http://127.0.0.1:${port}/v1/chat/completions`;

  const messages: any[] = [];
  for (const prompt of systemPrompts) {
    messages.push({ role: 'system', content: prompt });
  }

  // 如果有图片，在文本中嵌入本地文件路径（OpenClaw AgentMediaPayload 格式）
  let finalContent = userContent;
  if (imageLocalPaths && imageLocalPaths.length > 0) {
    const imageMarkdown = imageLocalPaths.map(p => `![image](file://${p})`).join('\n');
    finalContent = finalContent ? `${finalContent}\n\n${imageMarkdown}` : imageMarkdown;
    log?.info?.(`[DingTalk][Gateway] 附加 ${imageLocalPaths.length} 张本地图片路径`);
  }
  messages.push({ role: 'user', content: finalContent });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (gatewayAuth) {
    headers['Authorization'] = `Bearer ${gatewayAuth}`;
  }
  // 使用 bindings 配置解析 agentId，支持基于 peer.kind（单聊/群聊）的路由
  // 如果没有提供 peerKind/peerId，则回退到原有逻辑
  const agentId = (peerKind && peerId)
    ? resolveAgentIdByBindings(accountId, peerKind, peerId, log)
    : (accountId === DEFAULT_ACCOUNT_ID ? 'main' : accountId);
  headers['X-OpenClaw-Agent-Id'] = agentId;
  if (memoryUser) {
    // 使用 Base64 编码处理可能包含中文字符的 memoryUser
    // HTTP Header 只能包含 ASCII 字符，中文字符会导致 ByteString 编码错误
    headers['X-OpenClaw-Memory-User'] = Buffer.from(memoryUser, 'utf-8').toString('base64');
  }

  log?.info?.(`[DingTalk][Gateway] POST ${gatewayUrl}, session=${sessionKey}, accountId=${accountId}, agentId=${agentId}, peerKind=${peerKind}, messages=${messages.length}`);

  // 【TLS 模式修复】保存原始 TLS 设置，用于 finally 块中恢复
  const originalRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  
  try {
    // TLS 模式：如果是 HTTPS URL，临时禁用证书验证（用于自签名证书场景）
    if (gatewayUrl.startsWith('https://')) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
      log?.debug?.(`[DingTalk][Gateway] TLS 模式：已临时禁用证书验证`);
    }

    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'main',
        messages,
        stream: true,
        user: sessionKey,  // 用于 session 持久化
      }),
    });

    log?.info?.(`[DingTalk][Gateway] 响应 status=${response.status}, ok=${response.ok}, hasBody=${!!response.body}`);

    if (!response.ok || !response.body) {
      const errText = response.body ? await response.text() : '(no body)';
      log?.error?.(`[DingTalk][Gateway] 错误响应：${errText}`);
      throw new Error(`Gateway error: ${response.status} - ${errText}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;

        try {
          const chunk = JSON.parse(data);
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {}
      }
    }
  } finally {
    // 【TLS 模式修复】恢复原始 TLS 证书验证设置，避免影响其他 HTTPS 请求
    if (gatewayUrl.startsWith('https://')) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalRejectUnauthorized;
      log?.debug?.(`[DingTalk][Gateway] TLS 模式：已恢复证书验证设置`);
    }
  }
}

// ============ 图片下载到本地文件 ============

/**
 * 下载钉钉图片到本地临时文件
 * 返回本地文件路径，用于 OpenClaw AgentMediaPayload
 */
async function downloadImageToFile(
  downloadUrl: string,
  log?: any,
): Promise<string | null> {
  try {
    log?.info?.(`[DingTalk][Image] 开始下载图片: ${downloadUrl.slice(0, 100)}...`);
    const resp = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 30_000,
    });

    const buffer = Buffer.from(resp.data);
    const contentType = resp.headers['content-type'] || 'image/jpeg';
    const ext = contentType.includes('png') ? '.png' : contentType.includes('gif') ? '.gif' : contentType.includes('webp') ? '.webp' : '.jpg';
    const mediaDir = path.join(os.homedir(), '.openclaw', 'workspace', 'media', 'inbound');
    fs.mkdirSync(mediaDir, { recursive: true });
    const tmpFile = path.join(mediaDir, `openclaw-media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    fs.writeFileSync(tmpFile, buffer);

    log?.info?.(`[DingTalk][Image] 图片下载成功: size=${buffer.length} bytes, type=${contentType}, path=${tmpFile}`);
    return tmpFile;
  } catch (err: any) {
    log?.error?.(`[DingTalk][Image] 图片下载失败: ${err.message}`);
    return null;
  }
}

/**
 * 通过钉钉 API 下载媒体文件（需要 access_token）
 * 适用于 picture/file 类型的 downloadCode
 */
async function downloadMediaByCode(
  downloadCode: string,
  config: any,
  log?: any,
): Promise<string | null> {
  try {
    const token = await getAccessToken(config);
    log?.info?.(`[DingTalk][Image] 通过 downloadCode 下载媒体: ${downloadCode.slice(0, 30)}...`);

    const resp = await axios.post(
      `${DINGTALK_API}/v1.0/robot/messageFiles/download`,
      { downloadCode, robotCode: config.clientId },
      {
        headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
        timeout: 30_000,
      },
    );

    const downloadUrl = resp.data?.downloadUrl;
    if (!downloadUrl) {
      log?.warn?.(`[DingTalk][Image] downloadCode 换取 downloadUrl 失败: ${JSON.stringify(resp.data)}`);
      return null;
    }

    return downloadImageToFile(downloadUrl, log);
  } catch (err: any) {
    log?.error?.(`[DingTalk][Image] downloadCode 下载失败: ${err.message}`);
    return null;
  }
}

/**
 * 通过钉钉 API 下载文件附件（需要 access_token）
 * 与 downloadMediaByCode 不同，此函数保留原始文件名
 */
async function downloadFileByCode(
  downloadCode: string,
  fileName: string,
  config: any,
  log?: any,
): Promise<string | null> {
  try {
    const token = await getAccessToken(config);
    log?.info?.(`[DingTalk][File] 通过 downloadCode 下载文件: ${fileName}`);

    const resp = await axios.post(
      `${DINGTALK_API}/v1.0/robot/messageFiles/download`,
      { downloadCode, robotCode: config.clientId },
      {
        headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
        timeout: 30_000,
      },
    );

    const downloadUrl = resp.data?.downloadUrl;
    if (!downloadUrl) {
      log?.warn?.(`[DingTalk][File] downloadCode 换取 downloadUrl 失败: ${JSON.stringify(resp.data)}`);
      return null;
    }

    // 下载文件内容
    const fileResp = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 60_000,
    });

    const buffer = Buffer.from(fileResp.data);
    const mediaDir = path.join(os.homedir(), '.openclaw', 'workspace', 'media', 'inbound');
    fs.mkdirSync(mediaDir, { recursive: true });

    // 用时间戳前缀避免文件名冲突，保留原始文件名
    const safeFileName = fileName.replace(/[/\\:*?"<>|]/g, '_');
    const localPath = path.join(mediaDir, `${Date.now()}-${safeFileName}`);
    fs.writeFileSync(localPath, buffer);

    log?.info?.(`[DingTalk][File] 文件下载成功: size=${buffer.length} bytes, path=${localPath}`);
    return localPath;
  } catch (err: any) {
    log?.error?.(`[DingTalk][File] 文件下载失败: ${err.message}`);
    return null;
  }
}

/** 可直接读取内容的文本类文件扩展名 */
const TEXT_FILE_EXTENSIONS = new Set(['.txt', '.md', '.csv', '.json', '.xml', '.yaml', '.yml', '.html', '.htm', '.log', '.conf', '.ini', '.sh', '.py', '.js', '.ts', '.css', '.sql']);

/** 需要保存但无法直接读取的 Office/二进制文件扩展名 */
const OFFICE_FILE_EXTENSIONS = new Set(['.docx', '.xlsx', '.pptx', '.pdf', '.doc', '.xls', '.ppt', '.zip', '.rar', '.7z']);

// ============ 消息处理 ============

/** 消息内容提取结果 */
interface ExtractedMessage {
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

function extractMessageContent(data: any): ExtractedMessage {
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

      for (const part of parts) {
        if (part.text) {
          textParts.push(part.text);
        }
        if (part.pictureUrl) {
          imageUrls.push(part.pictureUrl);
        }
        if (part.type === 'picture' && part.downloadCode) {
          // 有些 richText 图片通过 downloadCode 获取
          imageUrls.push(`downloadCode:${part.downloadCode}`);
        }
      }

      const text = textParts.join('') || (imageUrls.length > 0 ? '[图片]' : '[富文本消息]');
      return { text, messageType: 'richText', imageUrls, downloadCodes: [], fileNames: [], atDingtalkIds: [], atMobiles: [] };
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
    case 'audio':
      return { text: data.content?.recognition || '[语音消息]', messageType: 'audio', imageUrls: [], downloadCodes: [], fileNames: [], atDingtalkIds: [], atMobiles: [] };
    case 'video':
      return { text: '[视频]', messageType: 'video', imageUrls: [], downloadCodes: [], fileNames: [], atDingtalkIds: [], atMobiles: [] };
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
    default:
      return { text: data.text?.content?.trim() || `[${msgtype}消息]`, messageType: msgtype, imageUrls: [], downloadCodes: [], fileNames: [], atDingtalkIds: [], atMobiles: [] };
  }
}

// 发送 Markdown 消息
async function sendMarkdownMessage(
  config: any,
  sessionWebhook: string,
  title: string,
  markdown: string,
  options: any = {},
): Promise<any> {
  const token = await getAccessToken(config);
  let text = ensureTableBlankLines(markdown);
  if (options.atUserId) text = `${text} @${options.atUserId}`;

  const body: any = {
    msgtype: 'markdown',
    markdown: { title: title || 'Moltbot', text },
  };
  if (options.atUserId) body.at = { atUserIds: [options.atUserId], isAtAll: false };

  return (await axios.post(sessionWebhook, body, {
    headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
  })).data;
}

// 发送文本消息
async function sendTextMessage(
  config: any,
  sessionWebhook: string,
  text: string,
  options: any = {},
): Promise<any> {
  const token = await getAccessToken(config);
  const body: any = { msgtype: 'text', text: { content: text } };
  if (options.atUserId) body.at = { atUserIds: [options.atUserId], isAtAll: false };

  return (await axios.post(sessionWebhook, body, {
    headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
  })).data;
}

// 智能选择 text / markdown
async function sendMessage(
  config: any,
  sessionWebhook: string,
  text: string,
  options: any = {},
): Promise<any> {
  const hasMarkdown = /^[#*>-]|[*_`#\[\]]/.test(text) || text.includes('\n');
  const useMarkdown = options.useMarkdown !== false && (options.useMarkdown || hasMarkdown);

  if (useMarkdown) {
    const title = options.title
      || text.split('\n')[0].replace(/^[#*\s\->]+/, '').slice(0, 20)
      || 'Moltbot';
    return sendMarkdownMessage(config, sessionWebhook, title, text, options);
  }
  return sendTextMessage(config, sessionWebhook, text, options);
}

// ============ 主动发送消息 API ============

/** 消息类型枚举 */
type DingTalkMsgType = 'text' | 'markdown' | 'link' | 'actionCard' | 'image';

/** 主动发送消息的结果 */
interface SendResult {
  ok: boolean;
  processQueryKey?: string;
  cardInstanceId?: string;  // AI Card 成功时返回
  error?: string;
  usedAICard?: boolean;  // 是否使用了 AI Card
}

/** 主动发送选项 */
interface ProactiveSendOptions {
  msgType?: DingTalkMsgType;
  title?: string;
  log?: any;
  useAICard?: boolean;  // 是否使用 AI Card，默认 true
  fallbackToNormal?: boolean;  // AI Card 失败时是否降级到普通消息，默认 true
}

/** AI Card 投放目标类型 */
type AICardTarget =
  | { type: 'user'; userId: string }
  | { type: 'group'; openConversationId: string };

/**
 * 构建卡片投放请求体（提取公共逻辑）
 */
function buildDeliverBody(
  cardInstanceId: string,
  target: AICardTarget,
  robotCode: string,
): any {
  const base = { outTrackId: cardInstanceId, userIdType: 1 };

  if (target.type === 'group') {
    return {
      ...base,
      openSpaceId: `dtv1.card//IM_GROUP.${target.openConversationId}`,
      imGroupOpenDeliverModel: {
        robotCode,
        extension: {
          dynamicSummary: 'true',
        },
      },
    };
  }

  return {
    ...base,
    openSpaceId: `dtv1.card//IM_ROBOT.${target.userId}`,
    imRobotOpenDeliverModel: {
      spaceType: 'IM_ROBOT',
      robotCode,
      extension: {
        dynamicSummary: 'true',
      },
    },
  };
}

/**
 * 通用 AI Card 创建函数
 * 支持被动回复和主动发送两种场景
 */
async function createAICardForTarget(
  config: any,
  target: AICardTarget,
  log?: any,
): Promise<AICardInstance | null> {
  const targetDesc = target.type === 'group'
    ? `群聊 ${target.openConversationId}`
    : `用户 ${target.userId}`;

  try {
    const token = await getAccessToken(config);
    const cardInstanceId = `card_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    log?.info?.(`[DingTalk][AICard] 开始创建卡片: ${targetDesc}, outTrackId=${cardInstanceId}`);

    // 1. 创建卡片实例
    const createBody = {
      cardTemplateId: AI_CARD_TEMPLATE_ID,
      outTrackId: cardInstanceId,
      cardData: {
        cardParamMap: {
          config: JSON.stringify({ autoLayout: true }),  // 启用宽屏模式
        },
      },
      callbackType: 'STREAM',
      imGroupOpenSpaceModel: { supportForward: true },
      imRobotOpenSpaceModel: { supportForward: true },
    };

    log?.info?.(`[DingTalk][AICard] POST /v1.0/card/instances`);
    const createResp = await axios.post(`${DINGTALK_API}/v1.0/card/instances`, createBody, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
    });
    log?.info?.(`[DingTalk][AICard] 创建卡片响应: status=${createResp.status}`);

    // 2. 投放卡片
    const deliverBody = buildDeliverBody(cardInstanceId, target, config.clientId);

    log?.info?.(`[DingTalk][AICard] POST /v1.0/card/instances/deliver body=${JSON.stringify(deliverBody)}`);
    const deliverResp = await axios.post(`${DINGTALK_API}/v1.0/card/instances/deliver`, deliverBody, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
    });
    log?.info?.(`[DingTalk][AICard] 投放卡片响应: status=${deliverResp.status}`);

    return { cardInstanceId, accessToken: token, inputingStarted: false };
  } catch (err: any) {
    log?.error?.(`[DingTalk][AICard] 创建卡片失败 (${targetDesc}): ${err.message}`);
    if (err.response) {
      log?.error?.(`[DingTalk][AICard] 错误响应: status=${err.response.status} data=${JSON.stringify(err.response.data)}`);
    }
    return null;
  }
}

/**
 * 主动发送文件消息（使用普通消息 API）
 */
async function sendFileProactive(
  config: any,
  target: AICardTarget,
  fileInfo: FileInfo,
  mediaId: string,
  log?: any,
): Promise<void> {
  try {
    const token = await getAccessToken(config);

    // 钉钉普通消息 API 的文件消息格式
    const msgParam = {
      mediaId: mediaId,
      fileName: fileInfo.fileName,
      fileType: fileInfo.fileType,
    };

    const body: any = {
      robotCode: config.clientId,
      msgKey: 'sampleFile',
      msgParam: JSON.stringify(msgParam),
    };

    let endpoint: string;
    if (target.type === 'group') {
      body.openConversationId = target.openConversationId;
      endpoint = `${DINGTALK_API}/v1.0/robot/groupMessages/send`;
    } else {
      body.userIds = [target.userId];
      endpoint = `${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`;
    }

    log?.info?.(`[DingTalk][File][Proactive] 发送文件消息: ${fileInfo.fileName}`);
    const resp = await axios.post(endpoint, body, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
      timeout: 10_000,
    });

    if (resp.data?.processQueryKey) {
      log?.info?.(`[DingTalk][File][Proactive] 文件消息发送成功: ${fileInfo.fileName}`);
    } else {
      log?.warn?.(`[DingTalk][File][Proactive] 文件消息发送响应异常: ${JSON.stringify(resp.data)}`);
    }
  } catch (err: any) {
    log?.error?.(`[DingTalk][File][Proactive] 发送文件消息失败: ${fileInfo.fileName}, 错误: ${err.message}`);
  }
}

/**
 * 主动发送音频消息（使用普通消息 API）
 */
async function sendAudioProactive(
  config: any,
  target: AICardTarget,
  fileInfo: FileInfo,
  mediaId: string,
  log?: any,
  durationMs?: number,
): Promise<void> {
  try {
    const token = await getAccessToken(config);

    // 钉钉普通消息 API 的音频消息格式
    const actualDuration = (durationMs && durationMs > 0) ? durationMs.toString() : '60000';
    const msgParam = {
      mediaId: mediaId,
      duration: actualDuration,
    };

    const body: any = {
      robotCode: config.clientId,
      msgKey: 'sampleAudio',
      msgParam: JSON.stringify(msgParam),
    };

    let endpoint: string;
    if (target.type === 'group') {
      body.openConversationId = target.openConversationId;
      endpoint = `${DINGTALK_API}/v1.0/robot/groupMessages/send`;
    } else {
      body.userIds = [target.userId];
      endpoint = `${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`;
    }

    log?.info?.(`[DingTalk][Audio][Proactive] 发送音频消息: ${fileInfo.fileName}`);
    const resp = await axios.post(endpoint, body, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
      timeout: 10_000,
    });

    if (resp.data?.processQueryKey) {
      log?.info?.(`[DingTalk][Audio][Proactive] 音频消息发送成功: ${fileInfo.fileName}`);
    } else {
      log?.warn?.(`[DingTalk][Audio][Proactive] 音频消息发送响应异常: ${JSON.stringify(resp.data)}`);
    }
  } catch (err: any) {
    log?.error?.(`[DingTalk][Audio][Proactive] 发送音频消息失败: ${fileInfo.fileName}, 错误: ${err.message}`);
  }
}

/**
 * 主动发送视频消息（使用普通消息 API）
 */
async function sendVideoProactive(
  config: any,
  target: AICardTarget,
  videoMediaId: string,
  picMediaId: string,
  metadata: VideoMetadata,
  log?: any,
): Promise<void> {
  try {
    const token = await getAccessToken(config);

    // 钉钉普通消息 API 的视频消息格式
    const msgParam = {
      duration: metadata.duration.toString(),
      videoMediaId: videoMediaId,
      videoType: 'mp4',
      picMediaId: picMediaId,
    };

    const body: any = {
      robotCode: config.clientId,
      msgKey: 'sampleVideo',
      msgParam: JSON.stringify(msgParam),
    };

    let endpoint: string;
    if (target.type === 'group') {
      body.openConversationId = target.openConversationId;
      endpoint = `${DINGTALK_API}/v1.0/robot/groupMessages/send`;
    } else {
      body.userIds = [target.userId];
      endpoint = `${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`;
    }

    log?.info?.(`[DingTalk][Video][Proactive] 发送视频消息`);
    const resp = await axios.post(endpoint, body, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
      timeout: 10_000,
    });

    if (resp.data?.processQueryKey) {
      log?.info?.(`[DingTalk][Video][Proactive] 视频消息发送成功`);
    } else {
      log?.warn?.(`[DingTalk][Video][Proactive] 视频消息发送响应异常: ${JSON.stringify(resp.data)}`);
    }
  } catch (err: any) {
    log?.error?.(`[DingTalk][Video][Proactive] 发送视频消息失败: ${err.message}`);
  }
}

/** 音频信息接口 */
interface AudioInfo {
  path: string;
}

/**
 * 提取音频标记并发送音频消息
 * 解析 [DINGTALK_AUDIO]{"path":"..."}[/DINGTALK_AUDIO] 标记
 * 
 * @param useProactiveApi 是否使用主动消息 API（用于 AI Card 场景）
 * @param target 主动 API 需要的目标信息（useProactiveApi=true 时必须提供）
 */
async function processAudioMarkers(
  content: string,
  sessionWebhook: string,
  config: any,
  oapiToken: string | null,
  log?: any,
  useProactiveApi: boolean = false,
  target?: AICardTarget,
): Promise<string> {
  const logPrefix = useProactiveApi ? '[DingTalk][Audio][Proactive]' : '[DingTalk][Audio]';

  if (!oapiToken) {
    log?.warn?.(`${logPrefix} 无 oapiToken，跳过音频处理`);
    return content;
  }

  const fs = await import('fs');
  const path = await import('path');

  const matches = [...content.matchAll(AUDIO_MARKER_PATTERN)];
  const audioInfos: AudioInfo[] = [];
  const invalidAudios: string[] = [];

  for (const match of matches) {
    try {
      const audioInfo = JSON.parse(match[1]) as AudioInfo;
      if (audioInfo.path && fs.existsSync(audioInfo.path)) {
        audioInfos.push(audioInfo);
        log?.info?.(`${logPrefix} 提取到音频: ${audioInfo.path}`);
      } else {
        invalidAudios.push(audioInfo.path || '未知路径');
        log?.warn?.(`${logPrefix} 音频文件不存在: ${audioInfo.path}`);
      }
    } catch (err: any) {
      log?.warn?.(`${logPrefix} 解析标记失败: ${err.message}`);
    }
  }

  if (audioInfos.length === 0 && invalidAudios.length === 0) {
    log?.info?.(`${logPrefix} 未检测到音频标记`);
    return content.replace(AUDIO_MARKER_PATTERN, '').trim();
  }

  // 先移除所有音频标记
  let cleanedContent = content.replace(AUDIO_MARKER_PATTERN, '').trim();

  const statusMessages: string[] = [];

  for (const invalidPath of invalidAudios) {
    statusMessages.push(`⚠️ 音频文件不存在: ${path.basename(invalidPath)}`);
  }

  if (audioInfos.length > 0) {
    log?.info?.(`${logPrefix} 检测到 ${audioInfos.length} 个音频，开始处理...`);
  }

  for (const audioInfo of audioInfos) {
    const fileName = path.basename(audioInfo.path);
    try {
      const ext = path.extname(audioInfo.path).slice(1).toLowerCase();

      const fileInfo: FileInfo = {
        path: audioInfo.path,
        fileName: fileName,
        fileType: ext,
      };

      // 上传音频到钉钉
      const mediaId = await uploadMediaToDingTalk(audioInfo.path, 'voice', oapiToken, 20 * 1024 * 1024, log);
      if (!mediaId) {
        statusMessages.push(`⚠️ 音频上传失败: ${fileName}（文件可能超过 20MB 限制）`);
        continue;
      }

      // 提取音频实际时长
      const audioDurationMs = await extractAudioDuration(audioInfo.path, log);

      // 发送音频消息
      if (useProactiveApi && target) {
        await sendAudioProactive(config, target, fileInfo, mediaId, log, audioDurationMs ?? undefined);
      } else {
        await sendAudioMessage(config, sessionWebhook, fileInfo, mediaId, oapiToken, log, audioDurationMs ?? undefined);
      }
      statusMessages.push(`✅ 音频已发送: ${fileName}`);
      log?.info?.(`${logPrefix} 音频处理完成: ${fileName}`);
    } catch (err: any) {
      log?.error?.(`${logPrefix} 处理音频失败: ${err.message}`);
      statusMessages.push(`⚠️ 音频处理异常: ${fileName}（${err.message}）`);
    }
  }

  if (statusMessages.length > 0) {
    const statusText = statusMessages.join('\n');
    cleanedContent = cleanedContent
      ? `${cleanedContent}\n\n${statusText}`
      : statusText;
  }

  return cleanedContent;
}

/**
 * 主动创建并发送 AI Card（通用内部实现）
 * 复用 createAICardForTarget 并完整支持后处理
 * @param config 钉钉配置
 * @param target 投放目标（单聊或群聊）
 * @param content 消息内容
 * @param log 日志对象
 * @returns SendResult
 */
async function sendAICardInternal(
  config: any,
  target: AICardTarget,
  content: string,
  log?: any,
): Promise<SendResult> {
  const targetDesc = target.type === 'group'
    ? `群聊 ${target.openConversationId}`
    : `用户 ${target.userId}`;

  try {
    // 0. 获取 oapiToken 用于后处理
    const oapiToken = await getOapiAccessToken(config);

    // 1. 后处理01：上传本地图片到钉钉，替换路径为 media_id
    let processedContent = content;
    if (oapiToken) {
      log?.info?.(`[DingTalk][AICard][Proactive] 开始图片后处理`);
      processedContent = await processLocalImages(content, oapiToken, log);
    } else {
      log?.warn?.(`[DingTalk][AICard][Proactive] 无法获取 oapiToken，跳过媒体后处理`);
    }

    // 2. 后处理02：提取视频标记并发送视频消息
    log?.info?.(`[DingTalk][Video][Proactive] 开始视频后处理`);
    processedContent = await processVideoMarkers(processedContent, '', config, oapiToken, log, true, target);

    // 3. 后处理03：提取音频标记并发送音频消息（使用主动消息 API）
    log?.info?.(`[DingTalk][Audio][Proactive] 开始音频后处理`);
    processedContent = await processAudioMarkers(processedContent, '', config, oapiToken, log, true, target);

    // 4. 后处理04：提取文件标记并发送独立文件消息（使用主动消息 API）
    log?.info?.(`[DingTalk][File][Proactive] 开始文件后处理`);
    processedContent = await processFileMarkers(processedContent, '', config, oapiToken, log, true, target);

    // 5. 检查处理后的内容是否为空（纯文件/视频/音频消息场景）
    //    如果内容只包含文件/视频/音频标记，处理后会变成空字符串，此时跳过创建空白 AI Card
    const trimmedContent = processedContent.trim();
    if (!trimmedContent) {
      log?.info?.(`[DingTalk][AICard][Proactive] 处理后内容为空（纯文件/视频消息），跳过创建 AI Card`);
      return { ok: true, usedAICard: false };
    }

    // 5. 创建卡片（复用通用函数）
    const card = await createAICardForTarget(config, target, log);
    if (!card) {
      return { ok: false, error: 'Failed to create AI Card', usedAICard: false };
    }

    // 6. 使用 finishAICard 设置内容
    await finishAICard(card, processedContent, log);

    log?.info?.(`[DingTalk][AICard][Proactive] AI Card 发送成功: ${targetDesc}, cardInstanceId=${card.cardInstanceId}`);
    return { ok: true, cardInstanceId: card.cardInstanceId, usedAICard: true };

  } catch (err: any) {
    log?.error?.(`[DingTalk][AICard][Proactive] AI Card 发送失败 (${targetDesc}): ${err.message}`);
    if (err.response) {
      log?.error?.(`[DingTalk][AICard][Proactive] 错误响应: status=${err.response.status} data=${JSON.stringify(err.response.data)}`);
    }
    return { ok: false, error: err.response?.data?.message || err.message, usedAICard: false };
  }
}

/**
 * 主动发送 AI Card 到单聊用户
 */
async function sendAICardToUser(
  config: any,
  userId: string,
  content: string,
  log?: any,
): Promise<SendResult> {
  return sendAICardInternal(config, { type: 'user', userId }, content, log);
}

/**
 * 主动发送 AI Card 到群聊
 */
async function sendAICardToGroup(
  config: any,
  openConversationId: string,
  content: string,
  log?: any,
): Promise<SendResult> {
  return sendAICardInternal(config, { type: 'group', openConversationId }, content, log);
}

/**
 * 构建普通消息的 msgKey 和 msgParam
 * 提取公共逻辑，供 sendNormalToUser 和 sendNormalToGroup 复用
 */
function buildMsgPayload(
  msgType: DingTalkMsgType,
  content: string,
  title?: string,
): { msgKey: string; msgParam: Record<string, any> } | { error: string } {
  switch (msgType) {
    case 'markdown':
      return {
        msgKey: 'sampleMarkdown',
        msgParam: {
          title: title || content.split('\n')[0].replace(/^[#*\s\->]+/, '').slice(0, 20) || 'Message',
          text: ensureTableBlankLines(content),
        },
      };
    case 'link':
      try {
        return {
          msgKey: 'sampleLink',
          msgParam: typeof content === 'string' ? JSON.parse(content) : content,
        };
      } catch {
        return { error: 'Invalid link message format, expected JSON' };
      }
    case 'actionCard':
      try {
        return {
          msgKey: 'sampleActionCard',
          msgParam: typeof content === 'string' ? JSON.parse(content) : content,
        };
      } catch {
        return { error: 'Invalid actionCard message format, expected JSON' };
      }
    case 'image':
      return {
        msgKey: 'sampleImageMsg',
        msgParam: { photoURL: content },
      };
    case 'text':
    default:
      return {
        msgKey: 'sampleText',
        msgParam: { content },
      };
  }
}

/**
 * 使用普通消息 API 发送单聊消息（降级方案）
 */
async function sendNormalToUser(
  config: any,
  userIds: string | string[],
  content: string,
  options: { msgType?: DingTalkMsgType; title?: string; log?: any } = {},
): Promise<SendResult> {
  const { msgType = 'text', title, log } = options;
  const userIdArray = Array.isArray(userIds) ? userIds : [userIds];

  // 构建消息参数
  const payload = buildMsgPayload(msgType, content, title);
  if ('error' in payload) {
    return { ok: false, error: payload.error, usedAICard: false };
  }

  try {
    const token = await getAccessToken(config);
    const body = {
      robotCode: config.clientId,
      userIds: userIdArray,
      msgKey: payload.msgKey,
      msgParam: JSON.stringify(payload.msgParam),
    };

    log?.info?.(`[DingTalk][Normal] 发送单聊消息: userIds=${userIdArray.join(',')}, msgType=${msgType}`);

    const resp = await axios.post(`${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`, body, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
      timeout: 10_000,
    });

    if (resp.data?.processQueryKey) {
      log?.info?.(`[DingTalk][Normal] 发送成功: processQueryKey=${resp.data.processQueryKey}`);
      return { ok: true, processQueryKey: resp.data.processQueryKey, usedAICard: false };
    }

    log?.warn?.(`[DingTalk][Normal] 发送响应异常: ${JSON.stringify(resp.data)}`);
    return { ok: false, error: resp.data?.message || 'Unknown error', usedAICard: false };
  } catch (err: any) {
    const errMsg = err.response?.data?.message || err.message;
    log?.error?.(`[DingTalk][Normal] 发送失败: ${errMsg}`);
    return { ok: false, error: errMsg, usedAICard: false };
  }
}

/**
 * 使用普通消息 API 发送群聊消息（降级方案）
 */
async function sendNormalToGroup(
  config: any,
  openConversationId: string,
  content: string,
  options: { msgType?: DingTalkMsgType; title?: string; log?: any } = {},
): Promise<SendResult> {
  const { msgType = 'text', title, log } = options;

  // 构建消息参数
  const payload = buildMsgPayload(msgType, content, title);
  if ('error' in payload) {
    return { ok: false, error: payload.error, usedAICard: false };
  }

  try {
    const token = await getAccessToken(config);
    const body = {
      robotCode: config.clientId,
      openConversationId,
      msgKey: payload.msgKey,
      msgParam: JSON.stringify(payload.msgParam),
    };

    log?.info?.(`[DingTalk][Normal] 发送群聊消息: openConversationId=${openConversationId}, msgType=${msgType}`);

    const resp = await axios.post(`${DINGTALK_API}/v1.0/robot/groupMessages/send`, body, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
      timeout: 10_000,
    });

    if (resp.data?.processQueryKey) {
      log?.info?.(`[DingTalk][Normal] 发送成功: processQueryKey=${resp.data.processQueryKey}`);
      return { ok: true, processQueryKey: resp.data.processQueryKey, usedAICard: false };
    }

    log?.warn?.(`[DingTalk][Normal] 发送响应异常: ${JSON.stringify(resp.data)}`);
    return { ok: false, error: resp.data?.message || 'Unknown error', usedAICard: false };
  } catch (err: any) {
    const errMsg = err.response?.data?.message || err.message;
    log?.error?.(`[DingTalk][Normal] 发送失败: ${errMsg}`);
    return { ok: false, error: errMsg, usedAICard: false };
  }
}

/**
 * 主动发送单聊消息给指定用户
 * 默认使用 AI Card，失败时降级到普通消息
 * @param config 钉钉配置（需包含 clientId 和 clientSecret）
 * @param userIds 用户 ID 数组（staffId 或 unionId）
 * @param content 消息内容
 * @param options 可选配置
 */
async function sendToUser(
  config: any,
  userIds: string | string[],
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  const { log, useAICard = true, fallbackToNormal = true } = options;

  if (!config.clientId || !config.clientSecret) {
    return { ok: false, error: 'Missing clientId or clientSecret', usedAICard: false };
  }

  const userIdArray = (Array.isArray(userIds) ? userIds : [userIds]).filter((id) => Boolean(id));
  if (userIdArray.length === 0) {
    return { ok: false, error: 'userIds cannot be empty', usedAICard: false };
  }

  // AI Card 只支持单个用户
  if (useAICard && userIdArray.length === 1) {
    log?.info?.(`[DingTalk][SendToUser] 尝试使用 AI Card 发送: userId=${userIdArray[0]}`);
    const cardResult = await sendAICardToUser(config, userIdArray[0], content, log);

    if (cardResult.ok) {
      return cardResult;
    }

    // AI Card 失败
    log?.warn?.(`[DingTalk][SendToUser] AI Card 发送失败: ${cardResult.error}`);

    if (!fallbackToNormal) {
      log?.error?.(`[DingTalk][SendToUser] 不降级到普通消息，返回错误`);
      return cardResult;
    }

    log?.info?.(`[DingTalk][SendToUser] 降级到普通消息发送`);
  } else if (useAICard && userIdArray.length > 1) {
    log?.info?.(`[DingTalk][SendToUser] 多用户发送不支持 AI Card，使用普通消息`);
  }

  // 使用普通消息
  return sendNormalToUser(config, userIdArray, content, options);
}

/**
 * 主动发送群聊消息到指定群
 * 默认使用 AI Card，失败时降级到普通消息
 * @param config 钉钉配置（需包含 clientId 和 clientSecret）
 * @param openConversationId 群会话 ID
 * @param content 消息内容
 * @param options 可选配置
 */
async function sendToGroup(
  config: any,
  openConversationId: string,
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  const { log, useAICard = true, fallbackToNormal = true } = options;

  if (!config.clientId || !config.clientSecret) {
    return { ok: false, error: 'Missing clientId or clientSecret', usedAICard: false };
  }

  if (!openConversationId) {
    return { ok: false, error: 'openConversationId cannot be empty', usedAICard: false };
  }

  // 尝试使用 AI Card
  if (useAICard) {
    log?.info?.(`[DingTalk][SendToGroup] 尝试使用 AI Card 发送: openConversationId=${openConversationId}`);
    const cardResult = await sendAICardToGroup(config, openConversationId, content, log);

    if (cardResult.ok) {
      return cardResult;
    }

    // AI Card 失败
    log?.warn?.(`[DingTalk][SendToGroup] AI Card 发送失败: ${cardResult.error}`);

    if (!fallbackToNormal) {
      log?.error?.(`[DingTalk][SendToGroup] 不降级到普通消息，返回错误`);
      return cardResult;
    }

    log?.info?.(`[DingTalk][SendToGroup] 降级到普通消息发送`);
  }

  // 使用普通消息
  return sendNormalToGroup(config, openConversationId, content, options);
}

/**
 * 智能发送消息
 * 默认使用 AI Card，失败时降级到普通消息
 * @param config 钉钉配置
 * @param target 目标：{ userId } 或 { openConversationId }
 * @param content 消息内容
 * @param options 可选配置
 */
async function sendProactive(
  config: any,
  target: { userId?: string; userIds?: string[]; openConversationId?: string },
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  // 自动检测是否使用 markdown（用于降级时）
  if (!options.msgType) {
    const hasMarkdown = /^[#*>-]|[*_`#\[\]]/.test(content) || content.includes('\n');
    if (hasMarkdown) {
      options.msgType = 'markdown';
    }
  }

  // 发送到用户
  if (target.userId || target.userIds) {
    const userIds = target.userIds || [target.userId!];
    return sendToUser(config, userIds, content, options);
  }

  // 发送到群
  if (target.openConversationId) {
    return sendToGroup(config, target.openConversationId, content, options);
  }

  return { ok: false, error: 'Must specify userId, userIds, or openConversationId', usedAICard: false };
}

// ============ 消息处理中表情 ============

/** 在用户消息上贴 🤔思考中 表情，表示正在处理 */
async function addEmotionReply(config: any, data: any, log?: any): Promise<void> {
  if (!data.msgId || !data.conversationId) return;
  try {
    const token = await getAccessToken(config);
    await axios.post(`${DINGTALK_API}/v1.0/robot/emotion/reply`, {
      robotCode: data.robotCode ?? config.clientId,
      openMsgId: data.msgId,
      openConversationId: data.conversationId,
      emotionType: 2,
      emotionName: '🤔思考中',
      textEmotion: {
        emotionId: '2659900',
        emotionName: '🤔思考中',
        text: '🤔思考中',
        backgroundId: 'im_bg_1',
      },
    }, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
      timeout: 5_000,
    });
    log?.info?.(`[DingTalk][Emotion] 贴表情成功: msgId=${data.msgId}`);
  } catch (err: any) {
    log?.warn?.(`[DingTalk][Emotion] 贴表情失败（不影响主流程）: ${err.message}`);
  }
}

/** 撤回用户消息上的 🤔思考中 表情 */
async function recallEmotionReply(config: any, data: any, log?: any): Promise<void> {
  if (!data.msgId || !data.conversationId) return;
  try {
    const token = await getAccessToken(config);
    await axios.post(`${DINGTALK_API}/v1.0/robot/emotion/recall`, {
      robotCode: data.robotCode ?? config.clientId,
      openMsgId: data.msgId,
      openConversationId: data.conversationId,
      emotionType: 2,
      emotionName: '🤔思考中',
      textEmotion: {
        emotionId: '2659900',
        emotionName: '🤔思考中',
        text: '🤔思考中',
        backgroundId: 'im_bg_1',
      },
    }, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
      timeout: 5_000,
    });
    log?.info?.(`[DingTalk][Emotion] 撤回表情成功: msgId=${data.msgId}`);
  } catch (err: any) {
    log?.warn?.(`[DingTalk][Emotion] 撤回表情失败（不影响主流程）: ${err.message}`);
  }
}

// ============ 核心消息处理 (AI Card Streaming) ============

async function handleDingTalkMessage(params: {
  cfg: ClawdbotConfig;
  accountId: string;
  data: any;
  sessionWebhook: string;
  log?: any;
  dingtalkConfig: any;
}): Promise<void> {
  const { cfg, accountId, data, sessionWebhook, log, dingtalkConfig } = params;

  const content = extractMessageContent(data);
  if (!content.text && content.imageUrls.length === 0 && content.downloadCodes.length === 0) return;

  const isDirect = data.conversationType === '1';
  const senderId = data.senderStaffId || data.senderId;
  const senderName = data.senderNick || 'Unknown';

  log?.info?.(`[DingTalk] 收到消息: from=${senderName} type=${content.messageType} text="${content.text.slice(0, 50)}..." images=${content.imageUrls.length} downloadCodes=${content.downloadCodes.length}`);

  // ===== DM Policy 检查 =====
  if (isDirect) {
    const dmPolicy = dingtalkConfig.dmPolicy || 'open';
    const allowFrom: string[] = dingtalkConfig.allowFrom || [];
    if (dmPolicy === 'allowlist' && allowFrom.length > 0 && !allowFrom.includes(senderId)) {
      log?.warn?.(`[DingTalk] DM 被拦截: senderId=${senderId} 不在 allowFrom 白名单中`);
      return;
    }
  }

  // 构建 OpenClaw 标准会话上下文
  // 兼容旧配置：sessionTimeout 已废弃，打印警告
  if (dingtalkConfig.sessionTimeout !== undefined) {
    log?.warn?.(`[DingTalk][Deprecation] 'sessionTimeout' 配置已废弃，会话超时由 OpenClaw Gateway 的 session.reset 配置控制`);
  }
  const separateSessionByConversation = dingtalkConfig.separateSessionByConversation as boolean | undefined;
  const groupSessionScope = dingtalkConfig.groupSessionScope as 'group' | 'group_sender' | undefined;
  const sessionContext = buildSessionContext({
    accountId,
    senderId,
    senderName,
    conversationType: data.conversationType,
    conversationId: data.conversationId,
    groupSubject: data.conversationTitle,
    separateSessionByConversation,
    groupSessionScope,
  });
  const sessionContextJson = JSON.stringify(sessionContext);
  log?.info?.(`[DingTalk][Session] context=${sessionContextJson}`);

  // memoryUser 用于 Gateway 区分记忆归属
  // 使用 peerId（不包含中文）作为标识符，避免 HTTP Header 编码问题
  const memoryUser = dingtalkConfig.sharedMemoryAcrossConversations === true
    ? accountId
    : `${sessionContext.channel}:${sessionContext.accountId}:${sessionContext.peerId}`;

  // Gateway 认证：优先使用 token，其次 password
  const gatewayAuth = dingtalkConfig.gatewayToken || dingtalkConfig.gatewayPassword || '';

  // 构建 system prompts & 获取 oapi token（用于图片和文件后处理）
  const systemPrompts: string[] = [];
  let oapiToken: string | null = null;

  if (dingtalkConfig.enableMediaUpload !== false) {
    // 添加图片和文件使用提示（告诉 LLM 直接输出本地路径或文件标记）
    systemPrompts.push(buildMediaSystemPrompt());
    // 获取 token 用于后处理上传
    oapiToken = await getOapiAccessToken(dingtalkConfig);
    log?.info?.(`[DingTalk][Media] oapiToken 获取${oapiToken ? '成功' : '失败'}`);
  } else {
    log?.info?.(`[DingTalk][Media] enableMediaUpload=false，跳过`);
  }

  // 自定义 system prompt
  if (dingtalkConfig.systemPrompt) {
    systemPrompts.push(dingtalkConfig.systemPrompt);
  }

  // ===== 图片下载到本地文件（用于 OpenClaw AgentMediaPayload） =====
  const imageLocalPaths: string[] = [];

  // 处理直接图片 URL（来自 richText 的 pictureUrl）
  for (const url of content.imageUrls) {
    if (url.startsWith('downloadCode:')) {
      // 通过 downloadCode 下载
      const code = url.slice('downloadCode:'.length);
      const localPath = await downloadMediaByCode(code, dingtalkConfig, log);
      if (localPath) imageLocalPaths.push(localPath);
    } else {
      // 直接 URL 下载
      const localPath = await downloadImageToFile(url, log);
      if (localPath) imageLocalPaths.push(localPath);
    }
  }

  // 处理 downloadCode（来自 picture 消息，fileNames 为空的是图片）
  for (let i = 0; i < content.downloadCodes.length; i++) {
    const code = content.downloadCodes[i];
    const fileName = content.fileNames[i]; // 有 fileName 说明是文件，否则是图片
    if (!fileName) {
      const localPath = await downloadMediaByCode(code, dingtalkConfig, log);
      if (localPath) imageLocalPaths.push(localPath);
    }
  }

  if (imageLocalPaths.length > 0) {
    log?.info?.(`[DingTalk][Image] 成功下载 ${imageLocalPaths.length} 张图片到本地`);
  }

  // ===== 文件附件下载与内容提取 =====
  const fileContentParts: string[] = [];
  for (let i = 0; i < content.downloadCodes.length; i++) {
    const code = content.downloadCodes[i];
    const fileName = content.fileNames[i];
    if (!fileName) continue; // 图片已在上面处理

    const ext = path.extname(fileName).toLowerCase();
    const localPath = await downloadFileByCode(code, fileName, dingtalkConfig, log);

    if (!localPath) {
      fileContentParts.push(`[文件下载失败: ${fileName}]`);
      continue;
    }

    if (TEXT_FILE_EXTENSIONS.has(ext)) {
      // 文本类文件：读取内容追加到消息
      try {
        const fileContent = fs.readFileSync(localPath, 'utf-8');
        const maxLen = 50_000; // 限制最大读取长度
        const truncated = fileContent.length > maxLen ? fileContent.slice(0, maxLen) + '\n...(内容过长，已截断)' : fileContent;
        fileContentParts.push(`[文件: ${fileName}]\n\`\`\`\n${truncated}\n\`\`\``);
        log?.info?.(`[DingTalk][File] 文本文件已读取: ${fileName}, size=${fileContent.length}`);
      } catch (err: any) {
        log?.error?.(`[DingTalk][File] 读取文本文件失败: ${err.message}`);
        fileContentParts.push(`[文件已保存: ${localPath}，但读取内容失败]`);
      }
    } else if (ext === '.docx') {
      // Word 文档：用 mammoth 提取纯文本
      try {
        const mammoth = await import('mammoth');
        const result = await mammoth.default.extractRawText({ path: localPath });
        const fileContent = result.value;
        const maxLen = 50_000;
        const truncated = fileContent.length > maxLen ? fileContent.slice(0, maxLen) + '\n...(内容过长，已截断)' : fileContent;
        fileContentParts.push(`[文件: ${fileName}]\n\`\`\`\n${truncated}\n\`\`\``);
        log?.info?.(`[DingTalk][File] Word 文档已提取文本: ${fileName}, size=${fileContent.length}`);
      } catch (err: any) {
        log?.error?.(`[DingTalk][File] Word 文档文本提取失败: ${err.message}`);
        fileContentParts.push(`[文件已保存: ${localPath}，但提取文本失败]`);
      }
    } else if (ext === '.pdf') {
      // PDF 文档：用 pdf-parse 提取纯文本
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const dataBuffer = fs.readFileSync(localPath);
        const pdfData = await pdfParse(dataBuffer);
        const fileContent = pdfData.text;
        const maxLen = 50_000;
        const truncated = fileContent.length > maxLen ? fileContent.slice(0, maxLen) + '\n...(内容过长，已截断)' : fileContent;
        fileContentParts.push(`[文件: ${fileName}]\n\`\`\`\n${truncated}\n\`\`\``);
        log?.info?.(`[DingTalk][File] PDF 文档已提取文本: ${fileName}, size=${fileContent.length}`);
      } catch (err: any) {
        log?.error?.(`[DingTalk][File] PDF 文档文本提取失败: ${err.message}`);
        fileContentParts.push(`[文件已保存: ${localPath}，但提取文本失败]`);
      }
    } else {
      // Office/二进制文件：保存到本地，提示路径
      fileContentParts.push(`[文件已保存: ${localPath}，请基于文件名和上下文回答]`);
      log?.info?.(`[DingTalk][File] 文件已保存: ${fileName} -> ${localPath}`);
    }
  }

  // 对于纯图片消息（无文本），添加默认提示
  // 文本部分先经过 normalizeSlashCommand，统一将 /reset /clear 等别名指令转为 /new，再交由 Gateway 解析
  const rawText = content.text || '';
  let userContent = normalizeSlashCommand(rawText) || (imageLocalPaths.length > 0 ? '请描述这张图片' : '');
  // 追加文件内容
  if (fileContentParts.length > 0) {
    const fileText = fileContentParts.join('\n\n');
    userContent = userContent ? `${userContent}\n\n${fileText}` : fileText;
  }
  if (!userContent && imageLocalPaths.length === 0) return;

  // ===== 贴处理中表情 =====
  await addEmotionReply(dingtalkConfig, data, log);

  try {
  // ===== 异步模式：立即回执 + 后台执行 + 主动推送结果 =====
  const asyncMode = dingtalkConfig.asyncMode === true;
  const proactiveTarget = isDirect
    ? { userId: data.senderStaffId || data.senderId }
    : { openConversationId: data.conversationId };

  if (asyncMode) {
    const ackText = dingtalkConfig.ackText || '🫡 任务已接收，处理中...';
    try {
      await sendProactive(dingtalkConfig, proactiveTarget, ackText, {
        msgType: 'text',
        useAICard: false,
        fallbackToNormal: true,
        log,
      });
    } catch (ackErr: any) {
      log?.warn?.(`[DingTalk][Async] 回执发送失败: ${ackErr?.message || ackErr}`);
    }

    // 计算 peerKind 和 peerId 用于 bindings 匹配
    const peerKind: 'direct' | 'group' = isDirect ? 'direct' : 'group';
    const peerId = isDirect ? senderId : (data.conversationId || senderId);

    let fullResponse = '';
    try {
      for await (const chunk of streamFromGateway({
        userContent,
        systemPrompts,
        sessionKey: sessionContextJson,
        gatewayAuth,
        gatewayBaseUrl: dingtalkConfig.gatewayBaseUrl,
        memoryUser,
        imageLocalPaths: imageLocalPaths.length > 0 ? imageLocalPaths : undefined,
        peerKind,
        peerId,
        gatewayPort: cfg.gateway?.port,
        log,
      }, accountId)) {
        fullResponse += chunk;
      }

      log?.info?.(`[DingTalk][Async] Gateway 完成，原始长度=${fullResponse.length}`);

      // 后处理01：上传本地图片到钉钉，替换 file:// 路径为 media_id
      fullResponse = await processLocalImages(fullResponse, oapiToken, log);

      // 后处理02：提取视频标记并发送视频消息（主动 API）
      const proactiveMediaTarget: AICardTarget = isDirect
        ? { type: 'user', userId: data.senderStaffId || data.senderId }
        : { type: 'group', openConversationId: data.conversationId };
      fullResponse = await processVideoMarkers(fullResponse, '', dingtalkConfig, oapiToken, log, true, proactiveMediaTarget);

      // 后处理03：提取音频标记并发送音频消息（主动 API）
      fullResponse = await processAudioMarkers(fullResponse, '', dingtalkConfig, oapiToken, log, true, proactiveMediaTarget);

      // 后处理04：提取文件标记并发送独立文件消息（主动 API）
      fullResponse = await processFileMarkers(fullResponse, '', dingtalkConfig, oapiToken, log, true, proactiveMediaTarget);

      const finalText = fullResponse.trim() || '✅ 任务执行完成（无文本输出）';
      await sendProactive(dingtalkConfig, proactiveTarget, finalText, {
        msgType: 'markdown',
        useAICard: false,
        fallbackToNormal: true,
        log,
      });

      log?.info?.(`[DingTalk][Async] 结果已主动推送，长度=${finalText.length}`);
    } catch (err: any) {
      const errMsg = `⚠️ 任务执行失败: ${err?.message || err}`;
      log?.error?.(`[DingTalk][Async] ${errMsg}`);
      try {
        await sendProactive(dingtalkConfig, proactiveTarget, errMsg, {
          msgType: 'text',
          useAICard: false,
          fallbackToNormal: true,
          log,
        });
      } catch (sendErr: any) {
        log?.error?.(`[DingTalk][Async] 错误通知发送失败: ${sendErr?.message || sendErr}`);
      }
    }

    return;
  }

  // 计算 peerKind 和 peerId 用于 bindings 匹配（在 asyncMode 外部定义，供所有分支使用）
  const peerKind: 'direct' | 'group' = isDirect ? 'direct' : 'group';
  const peerId = isDirect ? senderId : (data.conversationId || senderId);

  // 尝试创建 AI Card
  const card = await createAICard(dingtalkConfig, data, log);

  if (card) {
    // ===== AI Card 流式模式 =====
    log?.info?.(`[DingTalk] AI Card 创建成功: ${card.cardInstanceId}`);

    let accumulated = '';
    let lastUpdateTime = 0;
    const updateInterval = 300; // 最小更新间隔 ms
    let chunkCount = 0;

    try {
      log?.info?.(`[DingTalk] 开始请求 Gateway 流式接口...`);
      for await (const chunk of streamFromGateway({
        userContent,
        systemPrompts,
        sessionKey: sessionContextJson,
        gatewayAuth,
        gatewayBaseUrl: dingtalkConfig.gatewayBaseUrl,
        memoryUser,
        imageLocalPaths: imageLocalPaths.length > 0 ? imageLocalPaths : undefined,
        peerKind,
        peerId,
        gatewayPort: cfg.gateway?.port,
        log,
      }, accountId)) {
        accumulated += chunk;
        chunkCount++;

        if (chunkCount <= 3) {
          log?.info?.(`[DingTalk] Gateway chunk #${chunkCount}: "${chunk.slice(0, 50)}..." (accumulated=${accumulated.length})`);
        }

        // 节流更新，避免过于频繁
        const now = Date.now();
        if (now - lastUpdateTime >= updateInterval) {
          // 实时清理文件、视频、音频标记（避免用户在流式过程中看到标记）
          const displayContent = accumulated
            .replace(FILE_MARKER_PATTERN, '')
            .replace(VIDEO_MARKER_PATTERN, '')
            .replace(AUDIO_MARKER_PATTERN, '')
            .trim();
          await streamAICard(card, displayContent, false, log);
          lastUpdateTime = now;
        }
      }

      log?.info?.(`[DingTalk] Gateway 流完成，共 ${chunkCount} chunks, ${accumulated.length} 字符`);

      // 后处理01：上传本地图片到钉钉，替换 file:// 路径为 media_id
      log?.info?.(`[DingTalk][Media] 开始图片后处理，内容片段="${accumulated.slice(0, 200)}..."`);
      accumulated = await processLocalImages(accumulated, oapiToken, log);

      // 【关键修复】AI Card 场景使用主动消息 API 发送文件/视频，避免 sessionWebhook 失效问题
      // 构建目标信息用于主动 API（isDirect 已在上面定义）
      const proactiveTarget: AICardTarget = isDirect
        ? { type: 'user', userId: data.senderStaffId || data.senderId }
        : { type: 'group', openConversationId: data.conversationId };

      // 后处理02：提取视频标记并发送视频消息（使用主动消息 API）
      log?.info?.(`[DingTalk][Video] 开始视频后处理 (使用主动API)`);
      accumulated = await processVideoMarkers(accumulated, '', dingtalkConfig, oapiToken, log, true, proactiveTarget);

      // 后处理03：提取音频标记并发送音频消息（使用主动消息 API）
      log?.info?.(`[DingTalk][Audio] 开始音频后处理 (使用主动API)`);
      accumulated = await processAudioMarkers(accumulated, '', dingtalkConfig, oapiToken, log, true, proactiveTarget);

      // 后处理04：提取文件标记并发送独立文件消息（使用主动消息 API）
      log?.info?.(`[DingTalk][File] 开始文件后处理 (使用主动API，目标=${JSON.stringify(proactiveTarget)})`);
      accumulated = await processFileMarkers(accumulated, sessionWebhook, dingtalkConfig, oapiToken, log, true, proactiveTarget);

      // 完成 AI Card（如果内容为空，说明是纯媒体消息，使用默认提示）
      const finalContent = accumulated.trim();
      if (finalContent.length === 0) {
        log?.info?.(`[DingTalk][AICard] 内容为空（纯媒体消息），使用默认提示`);
        await finishAICard(card, '当前没有可展示的回复内容', log);
      } else {
        await finishAICard(card, finalContent, log);
      }
      log?.info?.(`[DingTalk] 流式响应完成，共 ${finalContent.length} 字符`);

    } catch (err: any) {
      log?.error?.(`[DingTalk] Gateway 调用失败: ${err.message}`);
      log?.error?.(`[DingTalk] 错误详情: ${err.stack}`);
      accumulated += `\n\n⚠️ 响应中断: ${err.message}`;
      try {
        await finishAICard(card, accumulated, log);
      } catch (finishErr: any) {
        log?.error?.(`[DingTalk] 错误恢复 finish 也失败: ${finishErr.message}`);
      }
    }

  } else {
    // ===== 降级：普通消息模式 =====
    log?.warn?.(`[DingTalk] AI Card 创建失败，降级为普通消息`);

    let fullResponse = '';
    try {
      for await (const chunk of streamFromGateway({
        userContent,
        systemPrompts,
        sessionKey: sessionContextJson,
        gatewayAuth,
        gatewayBaseUrl: dingtalkConfig.gatewayBaseUrl,
        memoryUser,
        imageLocalPaths: imageLocalPaths.length > 0 ? imageLocalPaths : undefined,
        peerKind,
        peerId,
        gatewayPort: cfg.gateway?.port,
        log,
      }, accountId)) {
        fullResponse += chunk;
      }

      // 后处理01：上传本地图片到钉钉，替换 file:// 路径为 media_id
      log?.info?.(`[DingTalk][Media] (降级模式) 开始图片后处理，内容片段="${fullResponse.slice(0, 200)}..."`);
      fullResponse = await processLocalImages(fullResponse, oapiToken, log);

      // 后处理02：提取视频标记并发送视频消息
      log?.info?.(`[DingTalk][Video] (降级模式) 开始视频后处理`);
      fullResponse = await processVideoMarkers(fullResponse, sessionWebhook, dingtalkConfig, oapiToken, log);

      // 后处理03：提取音频标记并发送音频消息
      log?.info?.(`[DingTalk][Audio] (降级模式) 开始音频后处理`);
      fullResponse = await processAudioMarkers(fullResponse, sessionWebhook, dingtalkConfig, oapiToken, log);

      // 后处理04：提取文件标记并发送独立文件消息
      log?.info?.(`[DingTalk][File] (降级模式) 开始文件后处理`);
      fullResponse = await processFileMarkers(fullResponse, sessionWebhook, dingtalkConfig, oapiToken, log);

      await sendMessage(dingtalkConfig, sessionWebhook, fullResponse || '（无响应）', {
        atUserId: !isDirect ? senderId : null,
        useMarkdown: true,
      });
      log?.info?.(`[DingTalk] 普通消息回复完成，共 ${fullResponse.length} 字符`);

    } catch (err: any) {
      log?.error?.(`[DingTalk] Gateway 调用失败: ${err.message}`);
      await sendMessage(dingtalkConfig, sessionWebhook, `抱歉，处理请求时出错: ${err.message}`, {
        atUserId: !isDirect ? senderId : null,
      });
    }
  }
  } finally {
    // ===== 撤回处理中表情 =====
    await recallEmotionReply(dingtalkConfig, data, log);
  }
}

// ============ 钉钉文档 API ============

/** 文档信息接口 */
interface DocInfo {
  docId: string;
  title: string;
  docType: string;
  creatorId?: string;
  updatedAt?: string;
}

/** 文档内容块 */
interface DocBlock {
  blockId: string;
  blockType: string;
  text?: string;
  children?: DocBlock[];
}

/**
 * 钉钉文档客户端
 * 支持读写钉钉在线文档（文档、表格等）
 */
class DingtalkDocsClient {
  private config: any;
  private log?: any;

  constructor(config: any, log?: any) {
    this.config = config;
    this.log = log;
  }

  /** 获取带鉴权的请求头 */
  private async getHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken(this.config);
    return {
      'x-acs-dingtalk-access-token': token,
      'Content-Type': 'application/json',
    };
  }

  /**
   * 获取文档元信息
   * @param spaceId 空间 ID
   * @param docId 文档 ID
   */
  async getDocInfo(spaceId: string, docId: string): Promise<DocInfo | null> {
    try {
      const headers = await this.getHeaders();
      this.log?.info?.(`[DingTalk][Docs] 获取文档信息: spaceId=${spaceId}, docId=${docId}`);

      const resp = await axios.get(
        `${DINGTALK_API}/v1.0/doc/spaces/${spaceId}/docs/${docId}`,
        { headers, timeout: 10_000 },
      );

      const data = resp.data;
      this.log?.info?.(`[DingTalk][Docs] 文档信息获取成功: title=${data?.title}`);

      return {
        docId: data.docId || docId,
        title: data.title || '',
        docType: data.docType || 'unknown',
        creatorId: data.creatorId,
        updatedAt: data.updatedAt,
      };
    } catch (err: any) {
      this.log?.error?.(`[DingTalk][Docs] 获取文档信息失败: ${err.message}`);
      return null;
    }
  }

  /**
   * 读取文档内容（通过 v2.0/wiki 节点 API）
   * @param nodeId 知识库节点 ID
   * @param operatorId 操作者 unionId（必须）
   */
  async readDoc(nodeId: string, operatorId?: string): Promise<string | null> {
    try {
      const headers = await this.getHeaders();
      this.log?.info?.(`[DingTalk][Docs] 读取知识库节点: nodeId=${nodeId}, operatorId=${operatorId}`);

      if (!operatorId) {
        this.log?.error?.('[DingTalk][Docs] readDoc 需要 operatorId（unionId）');
        return null;
      }

      const resp = await axios.get(
        `${DINGTALK_API}/v2.0/wiki/nodes/${nodeId}`,
        { headers, params: { operatorId }, timeout: 15_000 },
      );

      const node = resp.data?.node || resp.data;
      const name = node.name || '未知文档';
      const category = node.category || 'unknown';
      const url = node.url || '';
      const workspaceId = node.workspaceId || '';

      const content = [
        `文档名: ${name}`,
        `类型: ${category}`,
        `URL: ${url}`,
        `工作区: ${workspaceId}`,
      ].join('\n');

      this.log?.info?.(`[DingTalk][Docs] 节点信息获取成功: name=${name}, category=${category}`);
      return content;
    } catch (err: any) {
      this.log?.error?.(`[DingTalk][Docs] 读取节点失败: ${err.message}`);
      if (err.response) {
        this.log?.error?.(`[DingTalk][Docs] 错误详情: status=${err.response.status} data=${JSON.stringify(err.response.data)}`);
      }
      return null;
    }
  }

  /**
   * 从 block 树中递归提取纯文本内容
   */
  private extractTextFromBlocks(blocks: DocBlock[]): string[] {
    const result: string[] = [];
    for (const block of blocks) {
      if (block.text) {
        result.push(block.text);
      }
      if (block.children && block.children.length > 0) {
        result.push(...this.extractTextFromBlocks(block.children));
      }
    }
    return result;
  }

  /**
   * 向文档追加内容
   * @param docId 文档 ID
   * @param content 要追加的文本内容
   * @param index 插入位置（-1 表示末尾）
   */
  async appendToDoc(
    docId: string,
    content: string,
    index: number = -1,
  ): Promise<boolean> {
    try {
      const headers = await this.getHeaders();
      this.log?.info?.(`[DingTalk][Docs] 向文档追加内容: docId=${docId}, contentLen=${content.length}`);

      const body = {
        blockType: 'PARAGRAPH',
        body: {
          text: content,
        },
        index,
      };

      await axios.post(
        `${DINGTALK_API}/v1.0/doc/documents/${docId}/blocks/root/children`,
        body,
        { headers, timeout: 10_000 },
      );

      this.log?.info?.(`[DingTalk][Docs] 内容追加成功`);
      return true;
    } catch (err: any) {
      this.log?.error?.(`[DingTalk][Docs] 追加内容失败: ${err.message}`);
      if (err.response) {
        this.log?.error?.(`[DingTalk][Docs] 错误详情: status=${err.response.status} data=${JSON.stringify(err.response.data)}`);
      }
      return false;
    }
  }

  /**
   * 创建新文档
   * @param spaceId 空间 ID
   * @param title 文档标题
   * @param content 初始内容（可选）
   */
  async createDoc(
    spaceId: string,
    title: string,
    content?: string,
  ): Promise<DocInfo | null> {
    try {
      const headers = await this.getHeaders();
      this.log?.info?.(`[DingTalk][Docs] 创建文档: spaceId=${spaceId}, title=${title}`);

      const body: any = {
        spaceId,
        parentDentryId: '',
        name: title,
        docType: 'alidoc',
      };

      const resp = await axios.post(
        `${DINGTALK_API}/v1.0/doc/spaces/${spaceId}/docs`,
        body,
        { headers, timeout: 10_000 },
      );

      const data = resp.data;
      this.log?.info?.(`[DingTalk][Docs] 文档创建成功: docId=${data?.docId}`);

      const docInfo: DocInfo = {
        docId: data.docId || data.dentryUuid || '',
        title: title,
        docType: data.docType || 'alidoc',
      };

      // 如果有初始内容，追加到文档
      if (content && docInfo.docId) {
        await this.appendToDoc(docInfo.docId, content);
      }

      return docInfo;
    } catch (err: any) {
      this.log?.error?.(`[DingTalk][Docs] 创建文档失败: ${err.message}`);
      if (err.response) {
        this.log?.error?.(`[DingTalk][Docs] 错误详情: status=${err.response.status} data=${JSON.stringify(err.response.data)}`);
      }
      return null;
    }
  }

  /**
   * 搜索文档
   * @param keyword 搜索关键词
   * @param spaceId 空间 ID（可选，不填则搜索所有空间）
   */
  async searchDocs(
    keyword: string,
    spaceId?: string,
  ): Promise<DocInfo[]> {
    try {
      const headers = await this.getHeaders();
      this.log?.info?.(`[DingTalk][Docs] 搜索文档: keyword=${keyword}, spaceId=${spaceId || '全部'}`);

      const body: any = { keyword, maxResults: 20 };
      if (spaceId) body.spaceId = spaceId;

      const resp = await axios.post(
        `${DINGTALK_API}/v1.0/doc/docs/search`,
        body,
        { headers, timeout: 10_000 },
      );

      const items = resp.data?.items || [];
      const docs: DocInfo[] = items.map((item: any) => ({
        docId: item.docId || item.dentryUuid || '',
        title: item.name || item.title || '',
        docType: item.docType || 'unknown',
        creatorId: item.creatorId,
        updatedAt: item.updatedAt,
      }));

      this.log?.info?.(`[DingTalk][Docs] 搜索到 ${docs.length} 个文档`);
      return docs;
    } catch (err: any) {
      this.log?.error?.(`[DingTalk][Docs] 搜索文档失败: ${err.message}`);
      return [];
    }
  }

  /**
   * 列出空间下的文档
   * @param spaceId 空间 ID
   * @param parentId 父目录 ID（可选，不填则列出根目录）
   */
  async listDocs(
    spaceId: string,
    parentId?: string,
  ): Promise<DocInfo[]> {
    try {
      const headers = await this.getHeaders();
      this.log?.info?.(`[DingTalk][Docs] 列出文档: spaceId=${spaceId}, parentId=${parentId || '根目录'}`);

      const params: any = { maxResults: 50 };
      if (parentId) params.parentDentryId = parentId;

      const resp = await axios.get(
        `${DINGTALK_API}/v1.0/doc/spaces/${spaceId}/dentries`,
        { headers, params, timeout: 10_000 },
      );

      const items = resp.data?.items || [];
      const docs: DocInfo[] = items.map((item: any) => ({
        docId: item.dentryUuid || item.docId || '',
        title: item.name || '',
        docType: item.docType || item.dentryType || 'unknown',
        creatorId: item.creatorId,
        updatedAt: item.updatedAt,
      }));

      this.log?.info?.(`[DingTalk][Docs] 列出 ${docs.length} 个文档/目录`);
      return docs;
    } catch (err: any) {
      this.log?.error?.(`[DingTalk][Docs] 列出文档失败: ${err.message}`);
      return [];
    }
  }
}

// ============ 插件定义 ============

const meta = {
  id: 'dingtalk-connector',
  label: 'DingTalk',
  selectionLabel: 'DingTalk (钉钉)',
  docsPath: '/channels/dingtalk-connector',
  docsLabel: 'dingtalk-connector',
  blurb: '钉钉企业内部机器人，使用 Stream 模式，无需公网 IP，支持 AI Card 流式响应。',
  order: 70,
  aliases: ['dd', 'ding'],
};

const dingtalkPlugin = {
  id: 'dingtalk-connector',
  meta,
  capabilities: {
    chatTypes: ['direct', 'group'],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: false,
  },
  reload: { configPrefixes: ['channels.dingtalk-connector'] },
  configSchema: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean', default: true },
        clientId: { type: 'string', description: 'DingTalk App Key (Client ID)' },
        clientSecret: { type: 'string', description: 'DingTalk App Secret (Client Secret)' },
        enableMediaUpload: { type: 'boolean', default: true, description: 'Enable media upload prompt injection' },
        systemPrompt: { type: 'string', default: '', description: 'Custom system prompt' },
        dmPolicy: { type: 'string', enum: ['open', 'pairing', 'allowlist'], default: 'open' },
        allowFrom: { type: 'array', items: { type: 'string' }, description: 'Allowed sender IDs' },
        groupPolicy: { type: 'string', enum: ['open', 'allowlist'], default: 'open' },
        gatewayToken: { type: 'string', default: '', description: 'Gateway auth token (Bearer)' },
        gatewayPassword: { type: 'string', default: '', description: 'Gateway auth password (alternative to token)' },
        gatewayBaseUrl: { type: 'string', default: '', description: 'Custom Gateway URL (e.g., http://127.0.0.1:18788 for Nginx proxy to TLS Gateway)' },
        sessionTimeout: { type: 'number', default: 1800000, description: 'Session timeout in ms (default 30min)' },
        separateSessionByConversation: { type: 'boolean', default: true, description: '是否按单聊/群聊/群区分 session' },
        sharedMemoryAcrossConversations: { type: 'boolean', default: false, description: '单 agent 场景下是否共享记忆；false 时不同群聊、群聊与私聊记忆隔离' },
        asyncMode: { type: 'boolean', default: false, description: 'Send immediate ack and push final result as a second message' },
        ackText: { type: 'string', default: '🫡 任务已接收，处理中...', description: 'Ack text when asyncMode is enabled' },
        debug: { type: 'boolean', default: false },
      },
      required: ['clientId', 'clientSecret'],
    },
    uiHints: {
      enabled: { label: 'Enable DingTalk' },
      clientId: { label: 'App Key', sensitive: false },
      clientSecret: { label: 'App Secret', sensitive: true },
      dmPolicy: { label: 'DM Policy' },
      groupPolicy: { label: 'Group Policy' },
    },
  },
  config: {
    listAccountIds: (cfg: ClawdbotConfig) => {
      const config = getConfig(cfg);
      // __default__ 是内部标记，表示使用顶层配置（单账号模式）
      return config.accounts
        ? Object.keys(config.accounts)
        : (isConfigured(cfg) ? ['__default__'] : []);
    },
    resolveAccount: (cfg: ClawdbotConfig, accountId?: string) => {
      const config = getConfig(cfg);
      const id = accountId || DEFAULT_ACCOUNT_ID;
      if (config.accounts?.[id]) {
        // 合并 channel 级别配置（如 gatewayBaseUrl）到 account 配置
        const { accounts, ...channelConfig } = config;
        const mergedConfig = { ...channelConfig, ...config.accounts[id] };
        return { accountId: id, config: mergedConfig, enabled: config.accounts[id].enabled !== false };
      }
      // 没有 accounts 配置或找不到指定账号时，使用顶层配置
      return { accountId: DEFAULT_ACCOUNT_ID, config, enabled: config.enabled !== false };
    },
    defaultAccountId: () => '__default__',
    isConfigured: (account: any) => Boolean(account.config?.clientId && account.config?.clientSecret),
    describeAccount: (account: any) => ({
      accountId: account.accountId,
      name: account.config?.name || 'DingTalk',
      enabled: account.enabled,
      configured: Boolean(account.config?.clientId),
    }),
  },
  security: {
    resolveDmPolicy: ({ account }: any) => ({
      policy: account.config?.dmPolicy || 'open',
      allowFrom: account.config?.allowFrom || [],
      policyPath: 'channels.dingtalk-connector.dmPolicy',
      allowFromPath: 'channels.dingtalk-connector.allowFrom',
      approveHint: '使用 /allow dingtalk-connector:<userId> 批准用户',
      normalizeEntry: (raw: string) => raw.replace(/^(dingtalk-connector|dingtalk|dd|ding):/i, ''),
    }),
  },
  groups: {
    resolveRequireMention: ({ cfg }: any) => getConfig(cfg).groupPolicy !== 'open',
  },
  messaging: {
    // 注意：normalizeTarget 接收字符串，返回字符串（保持大小写，因为 openConversationId 是 base64 编码）
    normalizeTarget: (raw: string) => {
      if (!raw) return undefined;
      // 去掉渠道前缀，但保持原始大小写
      return raw.trim().replace(/^(dingtalk-connector|dingtalk|dd|ding):/i, '');
    },
    targetResolver: {
      // 支持普通 ID、Base64 编码的 conversationId，以及 user:/group: 前缀格式
      looksLikeId: (id: string) => /^(user:|group:)?[\w+/=-]+$/.test(id),
      hint: 'user:<userId> 或 group:<conversationId>',
    },
  },
  outbound: {
    deliveryMode: 'direct' as const,
    textChunkLimit: 4000,
    /**
     * 主动发送文本消息
     * @param ctx.to 目标格式：user:<userId> 或 group:<openConversationId>
     * @param ctx.text 消息内容
     * @param ctx.accountId 账号 ID
     */
    sendText: async (ctx: any) => {
      const { cfg, to, text, accountId, log } = ctx;
      const account = dingtalkPlugin.config.resolveAccount(cfg, accountId);
      const config = account?.config;

      if (!config?.clientId || !config?.clientSecret) {
        throw new Error('DingTalk not configured');
      }

      if (!to) {
        throw new Error('Target is required. Format: user:<userId> or group:<openConversationId>');
      }

      // 解析目标：user:<userId> 或 group:<openConversationId>
      const targetStr = String(to);
      let result: SendResult;

      log?.info?.(`[DingTalk][outbound.sendText] 解析目标: targetStr="${targetStr}"`);

      if (targetStr.startsWith('user:')) {
        const userId = targetStr.slice(5);
        log?.info?.(`[DingTalk][outbound.sendText] 发送给用户: userId="${userId}"`);
        result = await sendToUser(config, userId, text, { log });
      } else if (targetStr.startsWith('group:')) {
        const openConversationId = targetStr.slice(6);
        log?.info?.(`[DingTalk][outbound.sendText] 发送到群: openConversationId="${openConversationId}"`);
        result = await sendToGroup(config, openConversationId, text, { log });
      } else {
        // 默认当作 userId 处理
        log?.info?.(`[DingTalk][outbound.sendText] 默认发送给用户: userId="${targetStr}"`);
        result = await sendToUser(config, targetStr, text, { log });
      }

      if (result.ok) {
        return { channel: 'dingtalk-connector', messageId: result.processQueryKey || 'unknown' };
      }
      throw new Error(result.error || 'Failed to send message');
    },
    /**
     * 主动发送媒体消息（图片）
     * @param ctx.to 目标格式：user:<userId> 或 group:<openConversationId>
     * @param ctx.text 消息文本/标题
     * @param ctx.mediaUrl 媒体 URL（钉钉仅支持图片 URL）
     * @param ctx.accountId 账号 ID
     */
    sendMedia: async (ctx: any) => {
      const { cfg, to, text, mediaUrl, accountId, log } = ctx;
      const account = dingtalkPlugin.config.resolveAccount(cfg, accountId);
      const config = account?.config;

      if (!config?.clientId || !config?.clientSecret) {
        throw new Error('DingTalk not configured');
      }

      if (!to) {
        throw new Error('Target is required. Format: user:<userId> or group:<openConversationId>');
      }

      // 解析目标
      const targetStr = String(to);
      let result: SendResult;

      // 如果有媒体 URL，发送图片消息
      if (mediaUrl) {
        if (targetStr.startsWith('user:')) {
          const userId = targetStr.slice(5);
          result = await sendToUser(config, userId, mediaUrl, { msgType: 'image', log });
        } else if (targetStr.startsWith('group:')) {
          const openConversationId = targetStr.slice(6);
          result = await sendToGroup(config, openConversationId, mediaUrl, { msgType: 'image', log });
        } else {
          result = await sendToUser(config, targetStr, mediaUrl, { msgType: 'image', log });
        }
      } else {
        // 无媒体，发送文本
        if (targetStr.startsWith('user:')) {
          const userId = targetStr.slice(5);
          result = await sendToUser(config, userId, text || '', { log });
        } else if (targetStr.startsWith('group:')) {
          const openConversationId = targetStr.slice(6);
          result = await sendToGroup(config, openConversationId, text || '', { log });
        } else {
          result = await sendToUser(config, targetStr, text || '', { log });
        }
      }

      if (result.ok) {
        return { channel: 'dingtalk-connector', messageId: result.processQueryKey || 'unknown' };
      }
      throw new Error(result.error || 'Failed to send media');
    },
  },
  gateway: {
    startAccount: async (ctx: any) => {
      const { account, cfg, abortSignal } = ctx;
      const config = account.config;

      if (!config.clientId || !config.clientSecret) {
        throw new Error('DingTalk clientId and clientSecret are required');
      }

      ctx.log?.info(`[${account.accountId}] 启动钉钉 Stream 客户端...`);
      ctx.log?.info(`[${account.accountId}] 配置信息：clientId=${config.clientId}, endpoint=${config.endpoint || '默认'}`);

      // 配置 DWClient：关闭 SDK 内置的 keepAlive 和 autoReconnect，使用应用层自定义心跳和重连
      // - autoReconnect: false（关闭 SDK 的自动重连，避免与应用层重连冲突）
      // - keepAlive: false（关闭 SDK 的激进心跳检测，避免 8 秒超时强制终止连接）
      // - endpoint: 可选，自定义钉钉 API 网关地址，默认使用 SDK 内置的 https://api.dingtalk.com/v1.0/gateway/connections/open
      const client = new DWClient({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        debug: config.debug || false,
        autoReconnect: false,  // ← 关闭 SDK 的自动重连，使用应用层重连
        keepAlive: false,
        // ← 可选：自定义 endpoint，如使用内网代理或测试环境。如果不配置或配置错误，使用 SDK 默认值
        ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      } as any);

      ctx.log?.info(`[${account.accountId}] DWClient 初始化完成，endpoint=${client.getConfig()?.endpoint || '默认'}`);

      client.registerCallbackListener(TOPIC_ROBOT, async (res: any) => {
        const messageId = res.headers?.messageId;
        ctx.log?.info?.(`[DingTalk] 收到 Stream 回调, messageId=${messageId}, headers=${JSON.stringify(res.headers)}`);

        // 【关键修复】检查 WebSocket 状态后再确认回调，避免在 CONNECTING 状态下发送失败
        if (messageId) {
          if (client.socket?.readyState === 1) {  // 1 = OPEN
            client.socketCallBackResponse(messageId, { success: true });
            ctx.log?.info?.(`[DingTalk] 已立即确认回调：messageId=${messageId}`);
          } else {
            ctx.log?.warn?.(`[DingTalk] WebSocket 未就绪 (readyState=${client.socket?.readyState})，延迟确认回调：messageId=${messageId}`);
            // 【关键修复】将消息 ID 加入待确认队列，等待 WebSocket 打开后批量确认
            pendingAckQueue.add(messageId);
            // 等待 WebSocket 打开后再确认（兼容旧逻辑，但主要依赖 open 事件）
            setTimeout(() => {
              if (client.socket?.readyState === 1) {
                client.socketCallBackResponse(messageId, { success: true });
                pendingAckQueue.delete(messageId);  // 确认成功后从队列移除
                ctx.log?.info?.(`[DingTalk] 延迟确认回调成功：messageId=${messageId}`);
              } else {
                ctx.log?.warn?.(`[DingTalk] 延迟确认回调失败：WebSocket 仍未就绪，messageId=${messageId}，将在 open 事件中批量确认`);
                // 不再从队列移除，等待 open 事件处理
              }
            }, 500);  // 【关键修复】增加延迟时间到 500ms，确保 WebSocket 有足够时间打开
          }
        }

        // 【消息去重】检查是否已处理过该消息
        if (messageId && isMessageProcessed(messageId)) {
          ctx.log?.warn?.(`[DingTalk][${account.accountId}] 检测到重复消息，跳过处理: messageId=${messageId}`);
          return;
        }

        // 标记消息为已处理
        if (messageId) {
          markMessageProcessed(messageId);
        }

        // 异步处理消息（不阻塞回调确认）
        try {
          ctx.log?.info?.(`[DingTalk] 原始 data: ${typeof res.data === 'string' ? res.data.slice(0, 500) : JSON.stringify(res.data).slice(0, 500)}`);
          const data = JSON.parse(res.data);

          await handleDingTalkMessage({
            cfg,
            accountId: account.accountId,
            data,
            sessionWebhook: data.sessionWebhook,
            log: ctx.log,
            dingtalkConfig: config,
          });
        } catch (error: any) {
          ctx.log?.error?.(`[DingTalk] 处理消息异常: ${error.message}`);
          // 注意：即使处理失败，也不需要再次响应（已经提前确认了）
        }
      });

      await client.connect();
      
      // 【关键修复】等待 WebSocket 完全打开后再继续
      // 避免 Gateway 重启后 WebSocket 还在 CONNECTING 状态就开始处理消息
      if (client.socket) {
        if (client.socket.readyState !== 1) {  // 1 = OPEN
          ctx.log?.info?.(`[${account.accountId}] 等待 WebSocket 打开...`);
          await new Promise((resolve) => {
            client.socket!.once('open', resolve);
            setTimeout(resolve, 5000);  // 最多等 5 秒
          });
        }
      }
      
      ctx.log?.info(`[${account.accountId}] 钉钉 Stream 客户端已连接`);

      const rt = getRuntime();
      rt.channel.activity.record('dingtalk-connector', account.accountId, 'start');

      let stopped = false;
      
      // 【关键修复】待确认消息队列：重连期间暂存需要确认的消息 ID
      const pendingAckQueue = new Set<string>();
      
      // 【使用 SocketManager 统一管理 WebSocket 连接、心跳、重连】
      const debugMode = config.debug || false;
      const socketManager = createSocketManager(client, {
        accountId: account.accountId,
        log: ctx.log,
        stopped: () => stopped,
        onReconnect: () => {
          // 重连成功后的回调（如果需要）
        },
        pendingAckQueue,
        client,
        debug: debugMode,
      });
      
      // 启动 keepAlive 机制
      const stopKeepAlive = socketManager.startKeepAlive();
      
      // 统一的停止逻辑
      const doStop = (reason: string) => {
        if (stopped) return;
        stopped = true;
        ctx.log?.info(`[${account.accountId}] 停止钉钉 Stream 客户端 (${reason})...`);
        
        // 清理 keepAlive 定时器
        if (typeof stopKeepAlive === 'function') {
          stopKeepAlive();
        }
        
        // 清理 SocketManager
        socketManager.stop();
        
        try {
          // 【关键】调用 disconnect() 正确关闭 WebSocket 连接
          client.disconnect();
        } catch (err: any) {
          ctx.log?.warn?.(`[${account.accountId}] 断开连接时出错：${err.message}`);
        }
        rt.channel.activity.record('dingtalk-connector', account.accountId, 'stop');
      };

      // 【关键修复】返回一个 Promise 并保持 pending 状态直到 abortSignal 触发
      // 这样框架不会认为账号已退出，避免触发 auto-restart
      // 参考：OpenClaw changelog - "keep startAccount pending until abort to prevent restart-loop storms"
      return new Promise((resolve) => {
        if (abortSignal) {
          abortSignal.addEventListener('abort', () => {
            doStop('abortSignal');
            resolve({
              stop: () => doStop('manual'),
              isHealthy: () => !stopped,
            });
          });
        }
      });
    },
  },
  status: {
    defaultRuntime: { accountId: DEFAULT_ACCOUNT_ID, running: false, lastStartAt: null, lastStopAt: null, lastError: null },
    probe: async ({ cfg }: any) => {
      if (!isConfigured(cfg)) return { ok: false, error: 'Not configured' };
      try {
        const config = getConfig(cfg);
        await getAccessToken(config);
        return { ok: true, details: { clientId: config.clientId } };
      } catch (error: any) {
        return { ok: false, error: error.message };
      }
    },
    buildChannelSummary: ({ snapshot }: any) => ({
      configured: snapshot?.configured ?? false,
      running: snapshot?.running ?? false,
      lastStartAt: snapshot?.lastStartAt ?? null,
      lastStopAt: snapshot?.lastStopAt ?? null,
      lastError: snapshot?.lastError ?? null,
    }),
  },
};

// ============ 插件注册 ============

const plugin = {
  id: 'dingtalk-connector',
  name: 'DingTalk Channel',
  description: 'DingTalk (钉钉) messaging channel via Stream mode with AI Card streaming',
  configSchema: {
    type: 'object',
    additionalProperties: true,
    properties: { enabled: { type: 'boolean', default: true } },
  },
  register(api: ClawdbotPluginApi) {
    runtime = api.runtime;
    api.registerChannel({ plugin: dingtalkPlugin });

    // ===== Gateway Methods =====

    api.registerGatewayMethod('dingtalk-connector.status', async ({ respond, cfg }: any) => {
      const result = await dingtalkPlugin.status.probe({ cfg });
      respond(true, result);
    });

    api.registerGatewayMethod('dingtalk-connector.probe', async ({ respond, cfg }: any) => {
      const result = await dingtalkPlugin.status.probe({ cfg });
      respond(result.ok, result);
    });

    /**
     * 主动发送单聊消息
     * 参数：
     *   - userId / userIds: 目标用户 ID（支持单个或数组）
     *   - content: 消息内容
     *   - msgType?: 'text' | 'markdown' | 'link' | 'actionCard' | 'image'（降级时使用，默认 text）
     *   - title?: markdown 消息标题
     *   - useAICard?: 是否使用 AI Card（默认 true）
     *   - fallbackToNormal?: AI Card 失败时是否降级到普通消息（默认 true）
     *   - accountId?: 使用的账号 ID（可选，不传则使用默认配置）
     */
    api.registerGatewayMethod('dingtalk-connector.sendToUser', async ({ respond, cfg, params, log }: any) => {
      const { userId, userIds, content, msgType, title, useAICard, fallbackToNormal, accountId } = params || {};
      const account = dingtalkPlugin.config.resolveAccount(cfg, accountId);

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }

      const targetUserIds = userIds || (userId ? [userId] : []);
      if (targetUserIds.length === 0) {
        return respond(false, { error: 'userId or userIds is required' });
      }

      if (!content) {
        return respond(false, { error: 'content is required' });
      }

      const result = await sendToUser(account.config, targetUserIds, content, {
        msgType,
        title,
        log,
        useAICard: useAICard !== false,  // 默认 true
        fallbackToNormal: fallbackToNormal !== false,  // 默认 true
      });
      respond(result.ok, result);
    });

    /**
     * 主动发送群聊消息
     * 参数：
     *   - openConversationId: 群会话 ID
     *   - content: 消息内容
     *   - msgType?: 'text' | 'markdown' | 'link' | 'actionCard' | 'image'（降级时使用，默认 text）
     *   - title?: markdown 消息标题
     *   - useAICard?: 是否使用 AI Card（默认 true）
     *   - fallbackToNormal?: AI Card 失败时是否降级到普通消息（默认 true）
     *   - accountId?: 使用的账号 ID（可选，不传则使用默认配置）
     */
    api.registerGatewayMethod('dingtalk-connector.sendToGroup', async ({ respond, cfg, params, log }: any) => {
      const { openConversationId, content, msgType, title, useAICard, fallbackToNormal, accountId } = params || {};
      const account = dingtalkPlugin.config.resolveAccount(cfg, accountId);

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }

      if (!openConversationId) {
        return respond(false, { error: 'openConversationId is required' });
      }

      if (!content) {
        return respond(false, { error: 'content is required' });
      }

      const result = await sendToGroup(account.config, openConversationId, content, {
        msgType,
        title,
        log,
        useAICard: useAICard !== false,  // 默认 true
        fallbackToNormal: fallbackToNormal !== false,
      });
      respond(result.ok, result);
    });

    /**
     * 智能发送消息（自动检测目标类型和消息格式）
     * 参数：
     *   - target: 目标（user:<userId> 或 group:<openConversationId>）
     *   - content: 消息内容
     *   - msgType?: 消息类型（降级时使用，可选，不指定则自动检测）
     *   - title?: 标题（用于 markdown）
     *   - useAICard?: 是否使用 AI Card（默认 true）
     *   - fallbackToNormal?: AI Card 失败时是否降级到普通消息（默认 true）
     *   - accountId?: 账号 ID
     */
    api.registerGatewayMethod('dingtalk-connector.send', async ({ respond, cfg, params, log }: any) => {
      const { target, content, message, msgType, title, useAICard, fallbackToNormal, accountId } = params || {};
      const actualContent = content || message;  // 兼容 message 字段
      const account = dingtalkPlugin.config.resolveAccount(cfg, accountId);

      log?.info?.(`[DingTalk][Send] 收到请求: params=${JSON.stringify(params)}`);

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }

      if (!target) {
        return respond(false, { error: 'target is required (format: user:<userId> or group:<openConversationId>)' });
      }

      if (!actualContent) {
        return respond(false, { error: 'content is required' });
      }

      const targetStr = String(target);
      let sendTarget: { userId?: string; openConversationId?: string };

      if (targetStr.startsWith('user:')) {
        sendTarget = { userId: targetStr.slice(5) };
      } else if (targetStr.startsWith('group:')) {
        sendTarget = { openConversationId: targetStr.slice(6) };
      } else {
        // 默认当作 userId
        sendTarget = { userId: targetStr };
      }

      log?.info?.(`[DingTalk][Send] 解析后目标: sendTarget=${JSON.stringify(sendTarget)}`);

      const result = await sendProactive(account.config, sendTarget, actualContent, {
        msgType,
        title,
        log,
        useAICard: useAICard !== false,  // 默认 true
        fallbackToNormal: fallbackToNormal !== false,
      });
      respond(result.ok, result);
    });

    // ===== 文档 API Methods =====

    /**
     * 读取钉钉知识库文档节点信息
     * 参数：
     *   - docId: 知识库节点 ID
     *   - operatorId: 操作者 unionId 或 staffId（会自动转换为 unionId）
     *   - accountId?: 账号 ID
     */
    api.registerGatewayMethod('dingtalk-connector.docs.read', async ({ respond, cfg, params, log }: any) => {
      const { docId, operatorId: rawOperatorId, accountId } = params || {};
      const account = dingtalkPlugin.config.resolveAccount(cfg, accountId);

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }
      if (!docId) {
        return respond(false, { error: 'docId is required' });
      }
      if (!rawOperatorId) {
        return respond(false, { error: 'operatorId (unionId or staffId) is required' });
      }

      // 如果 operatorId 不像 unionId（通常以字母数字开头且较长），尝试将 staffId 转为 unionId
      let operatorId = rawOperatorId;
      if (!rawOperatorId.includes('$')) {
        // 可能已经是 unionId，直接使用；否则尝试转换
        const resolved = await getUnionId(rawOperatorId, account.config, log);
        if (resolved) operatorId = resolved;
      }

      const client = new DingtalkDocsClient(account.config, log);
      const content = await client.readDoc(docId, operatorId);

      if (content !== null) {
        respond(true, { content });
      } else {
        respond(false, { error: 'Failed to read document node' });
      }
    });

    /**
     * 创建钉钉文档
     * 参数：
     *   - spaceId: 空间 ID
     *   - title: 文档标题
     *   - content?: 初始内容
     *   - accountId?: 账号 ID
     */
    api.registerGatewayMethod('dingtalk-connector.docs.create', async ({ respond, cfg, params, log }: any) => {
      const { spaceId, title, content, accountId } = params || {};
      const account = dingtalkPlugin.config.resolveAccount(cfg, accountId);

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }
      if (!spaceId || !title) {
        return respond(false, { error: 'spaceId and title are required' });
      }

      const client = new DingtalkDocsClient(account.config, log);
      const doc = await client.createDoc(spaceId, title, content);

      if (doc) {
        respond(true, doc);
      } else {
        respond(false, { error: 'Failed to create document' });
      }
    });

    /**
     * 向钉钉文档追加内容
     * 参数：
     *   - docId: 文档 ID
     *   - content: 要追加的内容
     *   - accountId?: 账号 ID
     */
    api.registerGatewayMethod('dingtalk-connector.docs.append', async ({ respond, cfg, params, log }: any) => {
      const { docId, content, accountId } = params || {};
      const account = dingtalkPlugin.config.resolveAccount(cfg, accountId);

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }
      if (!docId || !content) {
        return respond(false, { error: 'docId and content are required' });
      }

      const client = new DingtalkDocsClient(account.config, log);
      const ok = await client.appendToDoc(docId, content);
      respond(ok, ok ? { success: true } : { error: 'Failed to append to document' });
    });

    /**
     * 搜索钉钉文档
     * 参数：
     *   - keyword: 搜索关键词
     *   - spaceId?: 空间 ID（可选）
     *   - accountId?: 账号 ID
     */
    api.registerGatewayMethod('dingtalk-connector.docs.search', async ({ respond, cfg, params, log }: any) => {
      const { keyword, spaceId, accountId } = params || {};
      const account = dingtalkPlugin.config.resolveAccount(cfg, accountId);

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }
      if (!keyword) {
        return respond(false, { error: 'keyword is required' });
      }

      const client = new DingtalkDocsClient(account.config, log);
      const docs = await client.searchDocs(keyword, spaceId);
      respond(true, { docs });
    });

    /**
     * 列出空间下的文档
     * 参数：
     *   - spaceId: 空间 ID
     *   - parentId?: 父目录 ID（可选）
     *   - accountId?: 账号 ID
     */
    api.registerGatewayMethod('dingtalk-connector.docs.list', async ({ respond, cfg, params, log }: any) => {
      const { spaceId, parentId, accountId } = params || {};
      const account = dingtalkPlugin.config.resolveAccount(cfg, accountId);

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }
      if (!spaceId) {
        return respond(false, { error: 'spaceId is required' });
      }

      const client = new DingtalkDocsClient(account.config, log);
      const docs = await client.listDocs(spaceId, parentId);
      respond(true, { docs });
    });

  },
};

export default plugin;
export {
  dingtalkPlugin,
  // 回复消息（需要 sessionWebhook）
  sendMessage,
  sendTextMessage,
  sendMarkdownMessage,
  // 主动发送消息（无需 sessionWebhook）
  sendToUser,
  sendToGroup,
  sendProactive,
  // 钉钉文档客户端
  DingtalkDocsClient,
};

// ============ 测试辅助导出 ============
// 仅用于单元测试，避免在业务代码中直接依赖内部实现细节
export const __testables = {
  // Markdown 修正
  ensureTableBlankLines,
  // 会话 & 去重
  normalizeSlashCommand,
  buildSessionContext,
  isMessageProcessed,
  markMessageProcessed,
  cleanupProcessedMessages,
  // 配置 & Token
  getConfig,
  isConfigured,
  getAccessToken,
  getOapiAccessToken,
  getUnionId,
  // 媒体处理
  toLocalPath,
  processLocalImages,
  uploadMediaToDingTalk,
  downloadImageToFile,
  downloadMediaByCode,
  downloadFileByCode,
  // 视频处理
  extractVideoMetadata,
  extractVideoThumbnail,
  processVideoMarkers,
  sendVideoMessage,
  // 音频处理
  getFfprobePath,
  extractAudioDuration,
  sendAudioMessage,
  processAudioMarkers,
  isAudioFile,
  // 文件处理
  extractFileMarkers,
  sendFileMessage,
  processFileMarkers,
  // 消息内容提取
  extractMessageContent,
  // 消息发送
  sendMarkdownMessage,
  sendTextMessage,
  sendMessage,
  // 提示词与消息体
  buildMediaSystemPrompt,
  buildDeliverBody,
  buildMsgPayload,
  // AI Card
  createAICard,
  streamAICard,
  finishAICard,
  createAICardForTarget,
  sendFileProactive,
  sendAudioProactive,
  sendVideoProactive,
  sendAICardInternal,
  sendAICardToUser,
  sendAICardToGroup,
  // 主动消息
  sendNormalToUser,
  sendNormalToGroup,
  sendToUser,
  sendToGroup,
  sendProactive,
  // 入站消息主流程
  handleDingTalkMessage,
  // Bindings 解析（测试时需 mock getRuntime/fs/path/os）
  resolveAgentIdByBindings,
  /** 仅测试用：注入 runtime 使 resolveAgentIdByBindings 不抛错 */
  setRuntimeForTest(r: PluginRuntime | null) {
    runtime = r;
  },
};
