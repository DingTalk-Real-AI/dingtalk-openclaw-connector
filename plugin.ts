/**
 * DingTalk Channel Plugin for Moltbot
 *
 * 通过钉钉 Stream 模式连接，支持 AI Card 流式响应。
 * 完整接入 Moltbot 消息处理管道。
 */

import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream';
import axios from 'axios';
import type { ClawdbotPluginApi, PluginRuntime, ClawdbotConfig } from 'clawdbot/plugin-sdk';

// ============ 常量 ============

export const id = 'dingtalk';

let runtime: PluginRuntime | null = null;

function getRuntime(): PluginRuntime {
  if (!runtime) throw new Error('DingTalk runtime not initialized');
  return runtime;
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
  return (cfg?.channels as any)?.dingtalk || {};
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

function buildMediaSystemPrompt(): string {
  return `## 钉钉图片显示规则

你正在钉钉中与用户对话。显示图片时，直接使用本地文件路径，系统会自动上传处理。

### 正确方式
\`\`\`markdown
![描述](file:///path/to/image.jpg)
![描述](/tmp/screenshot.png)
![描述](/Users/xxx/photo.jpg)
\`\`\`

### 禁止
- 不要自己执行 curl 上传
- 不要猜测或构造 URL
- 不要使用 https://oapi.dingtalk.com/... 这类地址

直接输出本地路径即可，系统会自动上传到钉钉。`;
}

// ============ 图片后处理：自动上传本地图片到钉钉 ============

/**
 * 匹配 markdown 图片中的本地文件路径：
 * - ![alt](file:///path/to/image.jpg)
 * - ![alt](MEDIA:/var/folders/xxx.jpg)
 * - ![alt](/tmp/xxx.jpg)
 * - ![alt](/var/folders/xxx.jpg)
 * - ![alt](/Users/xxx/photo.jpg)
 * - ![alt](attachment:///path.jpg)
 */
const LOCAL_IMAGE_RE = /!\[([^\]]*)\]\(((?:file:\/\/\/|MEDIA:|attachment:\/\/\/)[^\s)]+|\/(?:tmp|var|private|Users)[^\s)]+)\)/g;

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

/** 上传本地文件到钉钉，返回 media_id（以 @ 开头） */
async function uploadToDingTalk(
  filePath: string,
  oapiToken: string,
  log?: any,
): Promise<string | null> {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const FormData = (await import('form-data')).default;

    const absPath = toLocalPath(filePath);
    if (!fs.existsSync(absPath)) {
      log?.warn?.(`[DingTalk][Media] 文件不存在: ${absPath}`);
      return null;
    }

    const form = new FormData();
    form.append('media', fs.createReadStream(absPath), {
      filename: path.basename(absPath),
      contentType: 'image/jpeg',
    });

    log?.info?.(`[DingTalk][Media] 上传图片: ${absPath}`);
    const resp = await axios.post(
      `https://oapi.dingtalk.com/media/upload?access_token=${oapiToken}&type=image`,
      form,
      { headers: form.getHeaders(), timeout: 30_000 },
    );

    const mediaId = resp.data?.media_id;
    if (mediaId) {
      log?.info?.(`[DingTalk][Media] 上传成功: media_id=${mediaId}`);
      return mediaId;
    }
    log?.warn?.(`[DingTalk][Media] 上传返回无 media_id: ${JSON.stringify(resp.data)}`);
    return null;
  } catch (err: any) {
    log?.error?.(`[DingTalk][Media] 上传失败: ${err.message}`);
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

  const matches = [...content.matchAll(LOCAL_IMAGE_RE)];
  if (matches.length === 0) {
    log?.info?.(`[DingTalk][Media] 未检测到本地图片路径`);
    return content;
  }

  log?.info?.(`[DingTalk][Media] 检测到 ${matches.length} 个本地图片，开始上传...`);

  let result = content;
  for (const match of matches) {
    const [fullMatch, alt, rawPath] = match;
    const mediaId = await uploadToDingTalk(rawPath, oapiToken, log);
    if (mediaId) {
      result = result.replace(fullMatch, `![${alt}](${mediaId})`);
    }
  }
  return result;
}

// ============ AI Card Streaming ============

const DINGTALK_API = 'https://api.dingtalk.com';
const AI_CARD_TEMPLATE_ID = '382e4302-551d-4880-bf29-a30acfab2e71.schema';

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

// 创建 AI Card 实例
async function createAICard(
  config: any,
  data: any,
  log?: any,
): Promise<AICardInstance | null> {
  try {
    const token = await getAccessToken(config);
    const cardInstanceId = `card_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    log?.info?.(`[DingTalk][AICard] 开始创建卡片 outTrackId=${cardInstanceId}`);
    log?.info?.(`[DingTalk][AICard] conversationType=${data.conversationType}, conversationId=${data.conversationId}, senderStaffId=${data.senderStaffId}, senderId=${data.senderId}`);

    // 1. 创建卡片实例（Python SDK 传空 cardParamMap，不预设 flowStatus）
    const createBody = {
      cardTemplateId: AI_CARD_TEMPLATE_ID,
      outTrackId: cardInstanceId,
      cardData: {
        cardParamMap: {},
      },
      callbackType: 'STREAM',
      imGroupOpenSpaceModel: { supportForward: true },
      imRobotOpenSpaceModel: { supportForward: true },
    };

    log?.info?.(`[DingTalk][AICard] POST /v1.0/card/instances body=${JSON.stringify(createBody)}`);
    const createResp = await axios.post(`${DINGTALK_API}/v1.0/card/instances`, createBody, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
    });
    log?.info?.(`[DingTalk][AICard] 创建卡片响应: status=${createResp.status} data=${JSON.stringify(createResp.data)}`);

    // 2. 投放卡片
    const isGroup = data.conversationType === '2';
    const deliverBody: any = {
      outTrackId: cardInstanceId,
      userIdType: 1,
    };

    if (isGroup) {
      deliverBody.openSpaceId = `dtv1.card//IM_GROUP.${data.conversationId}`;
      deliverBody.imGroupOpenDeliverModel = {
        robotCode: config.clientId,
      };
    } else {
      const userId = data.senderStaffId || data.senderId;
      deliverBody.openSpaceId = `dtv1.card//IM_ROBOT.${userId}`;
      deliverBody.imRobotOpenDeliverModel = { spaceType: 'IM_ROBOT' };
    }

    log?.info?.(`[DingTalk][AICard] POST /v1.0/card/instances/deliver body=${JSON.stringify(deliverBody)}`);
    const deliverResp = await axios.post(`${DINGTALK_API}/v1.0/card/instances/deliver`, deliverBody, {
      headers: { 'x-acs-dingtalk-access-token': token, 'Content-Type': 'application/json' },
    });
    log?.info?.(`[DingTalk][AICard] 投放卡片响应: status=${deliverResp.status} data=${JSON.stringify(deliverResp.data)}`);

    return { cardInstanceId, accessToken: token, inputingStarted: false };
  } catch (err: any) {
    log?.error?.(`[DingTalk][AICard] 创建卡片失败: ${err.message}`);
    if (err.response) {
      log?.error?.(`[DingTalk][AICard] 错误响应: status=${err.response.status} data=${JSON.stringify(err.response.data)}`);
    }
    return null;
  }
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
          msgContent: '',
          staticMsgContent: '',
          sys_full_json_obj: JSON.stringify({
            order: ['msgTitle', 'msgContent', 'staticMsgContent', 'msgTextList', 'msgImages', 'msgSlider', 'msgButtons'],
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
  const body = {
    outTrackId: card.cardInstanceId,
    guid: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    key: 'msgContent',
    content: content,
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
  log?.info?.(`[DingTalk][AICard] 开始 finish，最终内容长度=${content.length}`);

  // 1. 先用最终内容关闭流式通道（isFinalize=true），确保卡片显示替换后的内容
  await streamAICard(card, content, true, log);

  // 2. 更新卡片状态为 FINISHED
  const body = {
    outTrackId: card.cardInstanceId,
    cardData: {
      cardParamMap: {
        flowStatus: AICardStatus.FINISHED,
        msgContent: content,
        staticMsgContent: '',
        sys_full_json_obj: JSON.stringify({
          order: ['msgTitle', 'msgContent', 'staticMsgContent', 'msgTextList', 'msgImages', 'msgSlider', 'msgButtons'],
        }),
      },
    },
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

async function* streamFromGateway(
  userContent: string,
  systemPrompts: string[],
  gatewayToken?: string,
  log?: any,
): AsyncGenerator<string, void, unknown> {
  const rt = getRuntime();
  const gatewayUrl = `http://127.0.0.1:${rt.gateway?.port || 18789}/v1/chat/completions`;

  const messages: any[] = [];
  for (const prompt of systemPrompts) {
    messages.push({ role: 'system', content: prompt });
  }
  messages.push({ role: 'user', content: userContent });

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (gatewayToken) {
    headers['Authorization'] = `Bearer ${gatewayToken}`;
  }

  log?.info?.(`[DingTalk][Gateway] POST ${gatewayUrl}, messages count=${messages.length}, userContent="${userContent.slice(0, 80)}..."`);

  const response = await fetch(gatewayUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'default',
      messages,
      stream: true,
    }),
  });

  log?.info?.(`[DingTalk][Gateway] 响应 status=${response.status}, ok=${response.ok}, hasBody=${!!response.body}`);

  if (!response.ok || !response.body) {
    const errText = response.body ? await response.text() : '(no body)';
    log?.error?.(`[DingTalk][Gateway] 错误响应: ${errText}`);
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
}

// ============ 消息处理 ============

function extractMessageContent(data: any): { text: string; messageType: string } {
  const msgtype = data.msgtype || 'text';
  switch (msgtype) {
    case 'text':
      return { text: data.text?.content?.trim() || '', messageType: 'text' };
    case 'richText': {
      const parts = data.content?.richText || [];
      const text = parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('');
      return { text: text || '[富文本消息]', messageType: 'richText' };
    }
    case 'picture':
      return { text: '[图片]', messageType: 'picture' };
    case 'audio':
      return { text: data.content?.recognition || '[语音消息]', messageType: 'audio' };
    case 'video':
      return { text: '[视频]', messageType: 'video' };
    case 'file':
      return { text: `[文件: ${data.content?.fileName || '文件'}]`, messageType: 'file' };
    default:
      return { text: data.text?.content?.trim() || `[${msgtype}消息]`, messageType: msgtype };
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
  let text = markdown;
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
  const rt = getRuntime();

  const content = extractMessageContent(data);
  if (!content.text) return;

  const isDirect = data.conversationType === '1';
  const senderId = data.senderStaffId || data.senderId;
  const senderName = data.senderNick || 'Unknown';

  log?.info?.(`[DingTalk] 收到消息: from=${senderName} text="${content.text.slice(0, 50)}..."`);

  // 构建 system prompts & 获取 oapi token（用于图片后处理）
  const systemPrompts: string[] = [];
  let oapiToken: string | null = null;

  if (dingtalkConfig.enableMediaUpload !== false) {
    // 添加图片使用提示（告诉 LLM 直接输出本地路径）
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
      for await (const chunk of streamFromGateway(content.text, systemPrompts, dingtalkConfig.gatewayToken, log)) {
        accumulated += chunk;
        chunkCount++;

        if (chunkCount <= 3) {
          log?.info?.(`[DingTalk] Gateway chunk #${chunkCount}: "${chunk.slice(0, 50)}..." (accumulated=${accumulated.length})`);
        }

        // 节流更新，避免过于频繁
        const now = Date.now();
        if (now - lastUpdateTime >= updateInterval) {
          await streamAICard(card, accumulated, false, log);
          lastUpdateTime = now;
        }
      }

      log?.info?.(`[DingTalk] Gateway 流完成，共 ${chunkCount} chunks, ${accumulated.length} 字符`);

      // 后处理：上传本地图片到钉钉，替换 file:// 路径为 media_id
      log?.info?.(`[DingTalk][Media] 开始后处理，oapiToken=${oapiToken ? '有' : '无'}，内容片段="${accumulated.slice(0, 200)}..."`);
      accumulated = await processLocalImages(accumulated, oapiToken, log);

      // 完成
      await finishAICard(card, accumulated, log);
      log?.info?.(`[DingTalk] 流式响应完成，共 ${accumulated.length} 字符`);

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
      for await (const chunk of streamFromGateway(content.text, systemPrompts, dingtalkConfig.gatewayToken, log)) {
        fullResponse += chunk;
      }

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
}

// ============ 插件定义 ============

const meta = {
  id: 'dingtalk',
  label: 'DingTalk',
  selectionLabel: 'DingTalk (钉钉)',
  docsPath: '/channels/dingtalk',
  docsLabel: 'dingtalk',
  blurb: '钉钉企业内部机器人，使用 Stream 模式，无需公网 IP，支持 AI Card 流式响应。',
  order: 70,
  aliases: ['dd', 'ding'],
};

const dingtalkPlugin = {
  id: 'dingtalk',
  meta,
  capabilities: {
    chatTypes: ['direct', 'group'],
    reactions: false,
    threads: false,
    media: true,
    nativeCommands: false,
    blockStreaming: false,
  },
  reload: { configPrefixes: ['channels.dingtalk'] },
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
      return config.accounts
        ? Object.keys(config.accounts)
        : (isConfigured(cfg) ? ['default'] : []);
    },
    resolveAccount: (cfg: ClawdbotConfig, accountId?: string) => {
      const config = getConfig(cfg);
      const id = accountId || 'default';
      if (config.accounts?.[id]) {
        return { accountId: id, config: config.accounts[id], enabled: config.accounts[id].enabled !== false };
      }
      return { accountId: 'default', config, enabled: config.enabled !== false };
    },
    defaultAccountId: () => 'default',
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
      policyPath: 'channels.dingtalk.dmPolicy',
      allowFromPath: 'channels.dingtalk.allowFrom',
      approveHint: '使用 /allow dingtalk:<userId> 批准用户',
      normalizeEntry: (raw: string) => raw.replace(/^(dingtalk|dd|ding):/i, ''),
    }),
  },
  groups: {
    resolveRequireMention: ({ cfg }: any) => getConfig(cfg).groupPolicy !== 'open',
  },
  messaging: {
    normalizeTarget: ({ target }: any) =>
      target ? { targetId: target.replace(/^(dingtalk|dd|ding):/i, '') } : null,
    targetResolver: {
      looksLikeId: (id: string) => /^[\w-]+$/.test(id),
      hint: '<conversationId>',
    },
  },
  outbound: {
    deliveryMode: 'direct' as const,
    sendText: async () => ({
      ok: false as const,
      error: 'DingTalk requires sessionWebhook context',
    }),
  },
  gateway: {
    startAccount: async (ctx: any) => {
      const { account, cfg, abortSignal } = ctx;
      const config = account.config;

      if (!config.clientId || !config.clientSecret) {
        throw new Error('DingTalk clientId and clientSecret are required');
      }

      ctx.log?.info(`[${account.accountId}] 启动钉钉 Stream 客户端...`);

      const client = new DWClient({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        debug: config.debug || false,
      });

      client.registerCallbackListener(TOPIC_ROBOT, async (res: any) => {
        try {
          const messageId = res.headers?.messageId;
          ctx.log?.info?.(`[DingTalk] 收到 Stream 回调, messageId=${messageId}, headers=${JSON.stringify(res.headers)}`);
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

          if (messageId) client.socketCallBackResponse(messageId, { success: true });
        } catch (error: any) {
          ctx.log?.error?.(`[DingTalk] 处理消息异常: ${error.message}`);
          const messageId = res.headers?.messageId;
          if (messageId) client.socketCallBackResponse(messageId, { success: false });
        }
      });

      await client.connect();
      ctx.log?.info(`[${account.accountId}] 钉钉 Stream 客户端已连接`);

      const rt = getRuntime();
      rt.channel.activity.record('dingtalk', account.accountId, 'start');

      let stopped = false;
      if (abortSignal) {
        abortSignal.addEventListener('abort', () => {
          if (stopped) return;
          stopped = true;
          ctx.log?.info(`[${account.accountId}] 停止钉钉 Stream 客户端...`);
          rt.channel.activity.record('dingtalk', account.accountId, 'stop');
        });
      }

      return {
        stop: () => {
          if (stopped) return;
          stopped = true;
          ctx.log?.info(`[${account.accountId}] 钉钉 Channel 已停止`);
          rt.channel.activity.record('dingtalk', account.accountId, 'stop');
        },
      };
    },
  },
  status: {
    defaultRuntime: { accountId: 'default', running: false, lastStartAt: null, lastStopAt: null, lastError: null },
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
    api.registerGatewayMethod('dingtalk.status', async ({ respond, cfg }: any) => {
      const result = await dingtalkPlugin.status.probe({ cfg });
      respond(true, result);
    });
    api.registerGatewayMethod('dingtalk.probe', async ({ respond, cfg }: any) => {
      const result = await dingtalkPlugin.status.probe({ cfg });
      respond(result.ok, result);
    });
    api.logger?.info('[DingTalk] 插件已注册');
  },
};

export default plugin;
export { dingtalkPlugin, sendMessage, sendTextMessage, sendMarkdownMessage };
