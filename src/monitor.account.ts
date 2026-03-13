import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream';
import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import type { ResolvedDingtalkAccount, DingtalkConfig } from "./types";
import { 
  isMessageProcessed, 
  markMessageProcessed, 
  buildSessionContext,
  normalizeSlashCommand,
  getAccessToken,
  getOapiAccessToken,
  DINGTALK_API,
  DINGTALK_OAPI
} from "./utils";
import { 
  createAICardForTarget, 
  streamAICard, 
  finishAICard,
  type AICardTarget 
} from "./messaging";
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
} from "./media";
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============ Bindings 类型定义 ============

interface Binding {
  agentId?: string;
  match?: {
    channel?: string;
    accountId?: string;
    peer?: {
      kind?: 'direct' | 'group';
      id?: string;
    };
  };
}


// ============ 常量 ============

const AI_CARD_TEMPLATE_ID = '382e4302-551d-4880-bf29-a30acfab2e71.schema';

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

/**
 * 根据 bindings 配置解析 agentId
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
  const defaultAgentId = accountId === '__default__' ? 'main' : accountId;

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
      log?.info?.(`[DingTalk][Bindings] 通配匹配 peer.kind: agentId=${binding.agentId}`);
      return binding.agentId || defaultAgentId;
    }
  }

  // 优先级3: 仅 accountId 匹配（无 peer）
  for (const binding of channelBindings) {
    const match = binding.match || {};
    if (!match.peer && match.accountId === accountId) {
      log?.info?.(`[DingTalk][Bindings] 匹配 accountId: agentId=${binding.agentId}`);
      return binding.agentId || defaultAgentId;
    }
  }

  // 优先级4: 仅 peer.kind 匹配（无 accountId 和 peer.id）
  for (const binding of channelBindings) {
    const match = binding.match || {};
    if (match.peer?.kind === peerKind && !match.peer?.id && !match.accountId) {
      log?.info?.(`[DingTalk][Bindings] 匹配 peer.kind（无 accountId）: agentId=${binding.agentId}`);
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

// ============ 图片下载 ============

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

async function downloadMediaByCode(
  downloadCode: string,
  config: DingtalkConfig,
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

async function downloadFileByCode(
  downloadCode: string,
  fileName: string,
  config: DingtalkConfig,
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

    const fileResp = await axios.get(downloadUrl, {
      responseType: 'arraybuffer',
      timeout: 60_000,
    });

    const buffer = Buffer.from(fileResp.data);
    const mediaDir = path.join(os.homedir(), '.openclaw', 'workspace', 'media', 'inbound');
    fs.mkdirSync(mediaDir, { recursive: true });

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

// ============ 消息处理 ============

interface HandleMessageParams {
  accountId: string;
  config: DingtalkConfig;
  data: any;
  sessionWebhook: string;
  runtime?: RuntimeEnv;
  log?: any;
}

async function handleDingTalkMessage(params: HandleMessageParams): Promise<void> {
  const { accountId, config, data, sessionWebhook, runtime, log } = params;

  const content = extractMessageContent(data);
  if (!content.text && content.imageUrls.length === 0 && content.downloadCodes.length === 0) return;

  const isDirect = data.conversationType === '1';
  const senderId = data.senderStaffId || data.senderId;
  const senderName = data.senderNick || 'Unknown';

  log?.info?.(`[DingTalk] 收到消息: from=${senderName} type=${content.messageType} text="${content.text.slice(0, 50)}..." images=${content.imageUrls.length} downloadCodes=${content.downloadCodes.length}`);

  // ===== DM Policy 检查 =====
  if (isDirect) {
    const dmPolicy = config.dmPolicy || 'open';
    const allowFrom: string[] = config.allowFrom || [];
    if (dmPolicy === 'allowlist' && allowFrom.length > 0 && !allowFrom.includes(senderId)) {
      log?.warn?.(`[DingTalk] DM 被拦截: senderId=${senderId} 不在 allowFrom 白名单中`);
      return;
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
  const sessionContextJson = JSON.stringify(sessionContext);
  log?.info?.(`[DingTalk][Session] context=${sessionContextJson}`);

  // 构建消息内容
  const rawText = content.text || '';
  let userContent = normalizeSlashCommand(rawText) || (content.imageUrls.length > 0 ? '请描述这张图片' : '');

  // ===== 图片下载到本地文件 =====
  const imageLocalPaths: string[] = [];
  for (const url of content.imageUrls) {
    if (url.startsWith('downloadCode:')) {
      const code = url.slice('downloadCode:'.length);
      const localPath = await downloadMediaByCode(code, config, log);
      if (localPath) imageLocalPaths.push(localPath);
    } else {
      const localPath = await downloadImageToFile(url, log);
      if (localPath) imageLocalPaths.push(localPath);
    }
  }

  for (let i = 0; i < content.downloadCodes.length; i++) {
    const code = content.downloadCodes[i];
    const fileName = content.fileNames[i];
    if (!fileName) {
      const localPath = await downloadMediaByCode(code, config, log);
      if (localPath) imageLocalPaths.push(localPath);
    }
  }

  if (imageLocalPaths.length > 0) {
    log?.info?.(`[DingTalk][Image] 成功下载 ${imageLocalPaths.length} 张图片到本地`);
  }

  // ===== 文件附件下载与内容提取 =====
  const TEXT_FILE_EXTENSIONS = new Set(['.txt', '.md', '.json', '.xml', '.yaml', '.yml', '.csv', '.log', '.ts', '.js', '.py', '.java', '.go', '.rs', '.c', '.cpp', '.h', '.hpp', '.css', '.html', '.sql', '.sh', '.bat']);
  const OFFICE_FILE_EXTENSIONS = new Set(['.docx', '.pdf']);

  const fileContentParts: string[] = [];
  for (let i = 0; i < content.downloadCodes.length; i++) {
    const code = content.downloadCodes[i];
    const fileName = content.fileNames[i];
    if (!fileName) continue;

    const ext = path.extname(fileName).toLowerCase();
    const localPath = await downloadFileByCode(code, fileName, config, log);

    if (!localPath) {
      fileContentParts.push(`[文件下载失败: ${fileName}]`);
      continue;
    }

    if (TEXT_FILE_EXTENSIONS.has(ext)) {
      try {
        const fileContent = fs.readFileSync(localPath, 'utf-8');
        const maxLen = 50_000;
        const truncated = fileContent.length > maxLen ? fileContent.slice(0, maxLen) + '\n...(内容过长，已截断)' : fileContent;
        fileContentParts.push(`[文件: ${fileName}]\n\`\`\`\n${truncated}\n\`\`\``);
        log?.info?.(`[DingTalk][File] 文本文件已读取: ${fileName}, size=${fileContent.length}`);
      } catch (err: any) {
        log?.error?.(`[DingTalk][File] 读取文本文件失败: ${err.message}`);
        fileContentParts.push(`[文件已保存: ${localPath}，但读取内容失败]`);
      }
    } else if (ext === '.docx') {
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
      fileContentParts.push(`[文件已保存: ${localPath}，请基于文件名和上下文回答]`);
      log?.info?.(`[DingTalk][File] 文件已保存: ${fileName} -> ${localPath}`);
    }
  }

  if (fileContentParts.length > 0) {
    const fileText = fileContentParts.join('\n\n');
    userContent = userContent ? `${userContent}\n\n${fileText}` : fileText;
  }

  if (!userContent && imageLocalPaths.length === 0) return;

  // 获取 oapi token
  const oapiToken = await getOapiAccessToken(config);
  log?.info?.(`[DingTalk][Media] oapiToken 获取${oapiToken ? '成功' : '失败'}`);

  // 尝试创建 AI Card
  const target: AICardTarget = isDirect
    ? { type: 'user', userId: senderId }
    : { type: 'group', openConversationId: data.conversationId };

  const card = await createAICardForTarget(config, target, log);

  if (card) {
    // ===== AI Card 流式模式 =====
    log?.info?.(`[DingTalk] AI Card 创建成功: ${card.cardInstanceId}`);

    let accumulated = '';
    let lastUpdateTime = 0;
    const updateInterval = 300;
    let chunkCount = 0;

    try {
      // 调用 Gateway 流式接口
      const gatewayUrl = `http://127.0.0.1:${runtime?.gateway?.port || 18789}/v1/chat/completions`;
      const messages: any[] = [];
      
      // 添加系统提示词
      if (config.systemPrompt) {
        messages.push({ role: 'system', content: config.systemPrompt });
      }

      // 添加图片路径
      let finalContent = userContent;
      if (imageLocalPaths.length > 0) {
        const imageMarkdown = imageLocalPaths.map(p => `![image](file://${p})`).join('\n');
        finalContent = finalContent ? `${finalContent}\n\n${imageMarkdown}` : imageMarkdown;
      }

      messages.push({ role: 'user', content: finalContent });

      // 解析 agentId（通过 bindings 配置）
      const resolvedAgentId = resolveAgentIdByBindings(
        accountId,
        isDirect ? 'direct' : 'group',
        isDirect ? senderId : data.conversationId,
        log
      );
      log?.info?.(`[DingTalk][Bindings] 解析结果: accountId=${accountId} -> agentId=${resolvedAgentId}`);

      // Gateway 认证：优先使用 token，其次 password
      const gatewayAuth = config.gatewayToken || config.gatewayPassword || '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-OpenClaw-Agent-Id': resolvedAgentId,
        'X-OpenClaw-Memory-User': Buffer.from(`${sessionContext.channel}:${sessionContext.accountId}:${sessionContext.peerId}`, 'utf-8').toString('base64'),
      };
      if (gatewayAuth) {
        headers['Authorization'] = `Bearer ${gatewayAuth}`;
      }

      const response = await fetch(gatewayUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'main',
          messages,
          stream: true,
          user: sessionContextJson,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Gateway error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let streamDone = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            streamDone = true;
            break;
          }

          try {
            const chunk = JSON.parse(data);
            const content = chunk.choices?.[0]?.delta?.content;
            if (content) {
              accumulated += content;
              chunkCount++;

              if (chunkCount <= 3) {
                log?.info?.(`[DingTalk] Gateway chunk #${chunkCount}: "${content.slice(0, 50)}..." (accumulated=${accumulated.length})`);
              }

              const now = Date.now();
              if (now - lastUpdateTime >= updateInterval) {
                const displayContent = accumulated
                  .replace(FILE_MARKER_PATTERN, '')
                  .replace(VIDEO_MARKER_PATTERN, '')
                  .replace(AUDIO_MARKER_PATTERN, '')
                  .trim();
                await streamAICard(card, displayContent, false, log);
                lastUpdateTime = now;
              }
            }
          } catch {}
        }
        
        if (streamDone) break;
      }

      log?.info?.(`[DingTalk] Gateway 流完成，共 ${chunkCount} chunks, ${accumulated.length} 字符`);

      // 后处理
      log?.info?.(`[DingTalk][Media] 开始图片后处理`);
      accumulated = await processLocalImages(accumulated, oapiToken, log);

      log?.info?.(`[DingTalk][Video] 开始视频后处理`);
      accumulated = await processVideoMarkers(accumulated, '', config, oapiToken, log, true, target);

      log?.info?.(`[DingTalk][Audio] 开始音频后处理`);
      accumulated = await processAudioMarkers(accumulated, '', config, oapiToken, log, true, target);

      log?.info?.(`[DingTalk][File] 开始文件后处理`);
      accumulated = await processFileMarkers(accumulated, '', config, oapiToken, log, true, target);

      const finalCardContent = accumulated.trim();
      if (finalCardContent.length === 0) {
        log?.info?.(`[DingTalk][AICard] 内容为空（纯媒体消息），使用默认提示`);
        await finishAICard(card, '✅ 媒体已发送', log);
      } else {
        await finishAICard(card, finalCardContent, log);
      }
      log?.info?.(`[DingTalk] 流式响应完成，共 ${finalCardContent.length} 字符`);

    } catch (err: any) {
      log?.error?.(`[DingTalk] Gateway 调用失败: ${err.message}`);
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
      const gatewayUrl = `http://127.0.0.1:${runtime?.gateway?.port || 18789}/v1/chat/completions`;
      const messages: any[] = [];
      
      if (config.systemPrompt) {
        messages.push({ role: 'system', content: config.systemPrompt });
      }

      let finalContent = userContent;
      if (imageLocalPaths.length > 0) {
        const imageMarkdown = imageLocalPaths.map(p => `![image](file://${p})`).join('\n');
        finalContent = finalContent ? `${finalContent}\n\n${imageMarkdown}` : imageMarkdown;
      }

      messages.push({ role: 'user', content: finalContent });

      // 解析 agentId（通过 bindings 配置）
      const resolvedAgentId = resolveAgentIdByBindings(
        accountId,
        isDirect ? 'direct' : 'group',
        isDirect ? senderId : data.conversationId,
        log
      );
      log?.info?.(`[DingTalk][Bindings] (降级模式) 解析结果: accountId=${accountId} -> agentId=${resolvedAgentId}`);

      // Gateway 认证：优先使用 token，其次 password
      const gatewayAuth = config.gatewayToken || config.gatewayPassword || '';
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-OpenClaw-Agent-Id': resolvedAgentId,
        'X-OpenClaw-Memory-User': Buffer.from(`${sessionContext.channel}:${sessionContext.accountId}:${sessionContext.peerId}`, 'utf-8').toString('base64'),
      };
      if (gatewayAuth) {
        headers['Authorization'] = `Bearer ${gatewayAuth}`;
      }

      const response = await fetch(gatewayUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: 'main',
          messages,
          stream: true,
          user: sessionContextJson,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`Gateway error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let streamDone = false;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            streamDone = true;
            break;
          }

          try {
            const chunk = JSON.parse(data);
            const content = chunk.choices?.[0]?.delta?.content;
            if (content) {
              fullResponse += content;
            }
          } catch {}
        }
        
        if (streamDone) break;
      }

      // 后处理
      log?.info?.(`[DingTalk][Media] (降级模式) 开始图片后处理`);
      fullResponse = await processLocalImages(fullResponse, oapiToken, log);

      log?.info?.(`[DingTalk][Video] (降级模式) 开始视频后处理`);
      fullResponse = await processVideoMarkers(fullResponse, sessionWebhook, config, oapiToken, log);

      log?.info?.(`[DingTalk][Audio] (降级模式) 开始音频后处理`);
      fullResponse = await processAudioMarkers(fullResponse, sessionWebhook, config, oapiToken, log);

      log?.info?.(`[DingTalk][File] (降级模式) 开始文件后处理`);
      fullResponse = await processFileMarkers(fullResponse, sessionWebhook, config, oapiToken, log);

      // 发送普通消息
      const token = await getAccessToken(config);
      const hasMarkdown = /^[#*>-]|[*_`#\[\]]/.test(fullResponse) || fullResponse.includes('\n');
      const useMarkdown = hasMarkdown;

      if (useMarkdown) {
        const title = fullResponse.split('\n')[0].replace(/^[#*\s\->]+/, '').slice(0, 20) || 'Message';
        const body: any = {
          msgtype: 'markdown',
          markdown: { title, text: fullResponse },
        };
        if (!isDirect) body.at = { atUserIds: [senderId], isAtAll: false };
        
        await axios.post(sessionWebhook, body, {
          headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
        });
      } else {
        const body: any = { msgtype: 'text', text: { content: fullResponse } };
        if (!isDirect) body.at = { atUserIds: [senderId], isAtAll: false };
        
        await axios.post(sessionWebhook, body, {
          headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
        });
      }

      log?.info?.(`[DingTalk] 普通消息回复完成，共 ${fullResponse.length} 字符`);

    } catch (err: any) {
      log?.error?.(`[DingTalk] Gateway 调用失败: ${err.message}`);
      const token = await getAccessToken(config);
      const body: any = { msgtype: 'text', text: { content: `抱歉，处理请求时出错: ${err.message}` } };
      if (!isDirect) body.at = { atUserIds: [senderId], isAtAll: false };
      
      await axios.post(sessionWebhook, body, {
        headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
      });
    }
  }
}

// 导出消息处理函数，供 monitor.ts 使用
export { handleDingTalkMessage };
