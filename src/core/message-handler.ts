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
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============ 常量 ============

const AI_CARD_TEMPLATE_ID = '02fcf2f4-5e02-4a85-b672-46d1f715543e.schema';

const AICardStatus = {
  PROCESSING: '1',
  INPUTING: '2',
  FINISHED: '3',
  EXECUTING: '4',
  FAILED: '5',
} as const;

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
    case 'audio': {
      const audioDownloadCode = data.content?.downloadCode || '';
      const audioFileName = data.content?.fileName || 'audio';
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
    default:
      return { text: data.text?.content?.trim() || `[${msgtype}消息]`, messageType: msgtype, imageUrls: [], downloadCodes: [], fileNames: [], atDingtalkIds: [], atMobiles: [] };
  }
}

// ============ 图片下载 ============

async function downloadImageToFile(
  downloadUrl: string,
  log?: any,
): Promise<string | null> {
  try {
    log?.info?.(`开始下载图片: ${downloadUrl.slice(0, 100)}...`);
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

    log?.info?.(`图片下载成功: size=${buffer.length} bytes, type=${contentType}, path=${tmpFile}`);
    return tmpFile;
  } catch (err: any) {
    log?.error?.(`图片下载失败: ${err.message}`);
    return null;
  }
}

async function downloadMediaByCode(
  downloadCode: string,
  config: DingtalkConfig,
  log?: any,
): Promise<string | null> {
  try {
    const token = await getAccessToken(config);
    log?.info?.(`通过 downloadCode 下载媒体: ${downloadCode.slice(0, 30)}...`);

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
      log?.warn?.(`downloadCode 换取 downloadUrl 失败: ${JSON.stringify(resp.data)}`);
      return null;
    }

    return downloadImageToFile(downloadUrl, log);
  } catch (err: any) {
    log?.error?.(`downloadCode 下载失败: ${err.message}`);
    return null;
  }
}

async function getFileDownloadUrl(
  downloadCode: string,
  fileName: string,
  config: DingtalkConfig,
  log?: any,
): Promise<string | null> {
  try {
    const token = await getAccessToken(config);
    log?.info?.(`获取文件下载链接: ${fileName}`);

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

export async function handleDingTalkMessage(params: HandleMessageParams): Promise<void> {
  const { accountId, config, data, sessionWebhook, runtime, log, cfg } = params;

  const content = extractMessageContent(data);
  if (!content.text && content.imageUrls.length === 0 && content.downloadCodes.length === 0) return;

  const isDirect = data.conversationType === '1';
  const senderId = data.senderStaffId || data.senderId;
  const senderName = data.senderNick || 'Unknown';



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
        const localPath = await downloadMediaByCode(code, config, log);
        if (localPath) {
          imageLocalPaths.push(localPath);
          log?.info?.(`图片下载成功 ${i + 1}/${content.imageUrls.length}`);
        } else {
          log?.warn?.(`图片下载失败 ${i + 1}/${content.imageUrls.length}`);
        }
      } else {
        const localPath = await downloadImageToFile(url, log);
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
        const localPath = await downloadMediaByCode(code, config, log);
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



  // ===== 文件附件处理：展示下载链接 =====
  const fileContentParts: string[] = [];
  for (let i = 0; i < content.downloadCodes.length; i++) {
    const code = content.downloadCodes[i];
    const fileName = content.fileNames[i];
    if (!fileName) continue;

    const downloadUrl = await getFileDownloadUrl(code, fileName, config, log);

    if (!downloadUrl) {
      fileContentParts.push(`⚠️ 文件获取失败: ${fileName}`);
      continue;
    }

    // 所有文件统一展示下载链接
    const ext = path.extname(fileName).toLowerCase();
    let fileType = '文件';

    if (['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm'].includes(ext)) {
      fileType = '视频';
    } else if (['.mp3', '.wav', '.aac', '.ogg', '.m4a', '.flac', '.wma'].includes(ext)) {
      fileType = '音频';
      // 如果有语音识别文本，一并显示
      if (content.text && content.text !== '[语音消息]') {
        fileContentParts.push(`🎤 **${fileType}**: ${fileName}\n📝 语音识别: ${content.text}\n🔗 [点击下载](${downloadUrl})`);
        continue;
      }
    } else if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext)) {
      fileType = '图片';
    } else if (['.txt', '.md', '.json', '.xml', '.yaml', '.yml', '.csv', '.log'].includes(ext)) {
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

    fileContentParts.push(`📎 **${fileType}**: ${fileName}\n🔗 [点击下载](${downloadUrl})`);
    log?.info?.(`文件下载链接已生成: ${fileName}`);
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
          if (match.peer.kind && match.peer.kind !== chatType) {
            continue;
          }
          
          // 检查 peer.id（支持通配符 *）
          if (match.peer.id && match.peer.id !== '*' && match.peer.id !== peerId) {
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
    const sessionKey = core.channel.routing.buildAgentSessionKey({
      agentId: matchedAgentId,
      channel: 'dingtalk',  // ✅ 使用 'dingtalk' 而不是 'dingtalk-connector'
      accountId: accountId,
      peer: {
        kind: isDirect ? 'direct' : 'group',
        id: peerId,
      },
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
      Provider: "dingtalk" as const,
      Surface: "dingtalk" as const,
      MessageSid: data.msgId,
      Timestamp: Date.now(),
      CommandAuthorized: true,
      OriginatingChannel: "dingtalk" as const,
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
          log?.info?.(`onSettled 被调用`);
          markDispatchIdle();
        },
        run: async () => {
          log?.info?.(`run 被调用，开始 dispatchReplyFromConfig`);
          log?.info?.(`run 被调用`);
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
    log?.info?.(`SDK dispatch 完成: queuedFinal=${queuedFinal}, replies=${counts.final}`);

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
      
      await axios.post(sessionWebhook, body, {
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

// handleDingTalkMessage 已在函数定义处直接导出
