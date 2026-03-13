import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream';
import type { ClawdbotConfig, RuntimeEnv, HistoryEntry } from "openclaw/plugin-sdk";
import type { ResolvedDingtalkAccount, DingtalkConfig } from "./types.ts";
import { 
  isMessageProcessed, 
  markMessageProcessed, 
  buildSessionContext,
  normalizeSlashCommand,
  getAccessToken,
  getOapiAccessToken,
  DINGTALK_API,
  DINGTALK_OAPI
} from "./utils.ts";
import { 
  createAICardForTarget, 
  streamAICard, 
  finishAICard,
  type AICardTarget 
} from "./messaging.ts";
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
} from "./media.ts";
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

      const response = await fetch(gatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OpenClaw-Agent-Id': accountId === '__default__' ? 'main' : accountId,
          'X-OpenClaw-Memory-User': Buffer.from(`${sessionContext.channel}:${sessionContext.accountId}:${sessionContext.peerId}`, 'utf-8').toString('base64'),
        },
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

      const response = await fetch(gatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-OpenClaw-Agent-Id': accountId === '__default__' ? 'main' : accountId,
          'X-OpenClaw-Memory-User': Buffer.from(`${sessionContext.channel}:${sessionContext.accountId}:${sessionContext.peerId}`, 'utf-8').toString('base64'),
        },
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
            if (content) {
              fullResponse += content;
            }
          } catch {}
        }
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

// ============ 监控账号 ============

export async function monitorSingleAccount(opts: MonitorDingtalkAccountOpts): Promise<void> {
  const { cfg, account, runtime, abortSignal } = opts;
  const { accountId } = account;
  const log = runtime?.log ?? console.log;

  if (!account.clientId || !account.clientSecret) {
    throw new Error(`DingTalk account "${accountId}" missing credentials`);
  }

  log(`[DingTalk][${accountId}] Starting DingTalk Stream client...`);

  const client = new DWClient({
    clientId: account.clientId,
    clientSecret: account.clientSecret,
  });

  return new Promise<void>((resolve, reject) => {
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
    client.registerAllEventListener(async (res: any) => {
      const messageId = res.headers?.messageId;
      log?.info?.(`[DingTalk] 收到 Stream 回调, messageId=${messageId}`);

      // 立即确认回调
      if (messageId) {
        client.socketCallBackResponse(messageId, { success: true });
        log?.info?.(`[DingTalk] 已立即确认回调: messageId=${messageId}`);
      }

      // 消息去重
      if (messageId && isMessageProcessed(accountId, messageId)) {
        log?.warn?.(`[DingTalk][${accountId}] 检测到重复消息，跳过处理: messageId=${messageId}`);
        return;
      }

      if (messageId) {
        markMessageProcessed(accountId, messageId);
      }

      // 异步处理消息
      try {
        const data = JSON.parse(res.data);
        log?.info?.(`[DingTalk] 开始处理消息: accountId=${accountId}, hasConfig=${!!account.config}, dataKeys=${Object.keys(data).join(',')}`);
        
        await handleDingTalkMessage({
          accountId,
          config: account.config,
          data,
          sessionWebhook: data.sessionWebhook,
          runtime,
          log,
        });
        
        log?.info?.(`[DingTalk] 消息处理完成`);
      } catch (error: any) {
        log?.error?.(`[DingTalk] 处理消息异常: ${error.message}\n${error.stack}`);
      }
    });

    // Connect to DingTalk Stream
    client.connect()
      .then(() => {
        log(`[DingTalk][${accountId}] Connected to DingTalk Stream`);
      })
      .catch((err) => {
        log(`[DingTalk][${accountId}] Failed to connect: ${err.message}`);
        reject(err);
      });

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
