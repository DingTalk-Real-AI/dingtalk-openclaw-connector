/**
 * 钉钉消息发送模块
 * 支持 AI Card 流式响应、普通消息、主动消息
 */

import axios from "axios";
import type { DingtalkConfig } from "./types.ts";
import { DINGTALK_API, getAccessToken, getOapiAccessToken } from "../utils/index.ts";
import { createLoggerFromConfig } from "../utils/logger.ts";
import {
  processLocalImages,
  processVideoMarkers,
  processAudioMarkers,
  processFileMarkers,
  uploadMediaToDingTalk,
} from "./media.ts";

// ============ 常量 ============

const AI_CARD_TEMPLATE_ID = "02fcf2f4-5e02-4a85-b672-46d1f715543e.schema";

/** AI Card 状态 */
const AICardStatus = {
  PROCESSING: "1",
  INPUTING: "2",
  FINISHED: "3",
  EXECUTING: "4",
  FAILED: "5",
} as const;

/** AI Card 实例接口 */
export interface AICardInstance {
  cardInstanceId: string;
  accessToken: string;
  inputingStarted: boolean;
}

/** AI Card 投放目标类型 */
export type AICardTarget =
  | { type: "user"; userId: string }
  | { type: "group"; openConversationId: string };

/** 消息类型枚举 */
export type DingTalkMsgType =
  | "text"
  | "markdown"
  | "link"
  | "actionCard"
  | "image";

/** 主动发送消息的结果 */
export interface SendResult {
  ok: boolean;
  processQueryKey?: string;
  cardInstanceId?: string;
  error?: string;
  usedAICard?: boolean;
}

/** 主动发送选项 */
export interface ProactiveSendOptions {
  msgType?: DingTalkMsgType;
  replyToId?: string;
  title?: string;
  log?: any;
  useAICard?: boolean;
  fallbackToNormal?: boolean;
}

// ============ Markdown 格式修正 ============

/**
 * 确保 Markdown 表格前有空行，否则钉钉无法正确渲染表格。
 *
 * 逐行向前看：当前行像表头（含 `|`）且下一行是分隔行时，
 * 若前一行非空且非表格行，则在表头前插入空行。
 * 支持缩进表格（行首有空白字符）。
 */
function ensureTableBlankLines(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];

  // 匹配表格分隔行 (例如 | --- | --- | 或 --- | ---)
  const tableDividerRegex = /^\s*\|?\s*:?-+:?\s*(\|?\s*:?-+:?\s*)+\|?\s*$/;
  // 匹配包含竖线的表格行
  const tableRowRegex = /^\s*\|?.*\|.*\|?\s*$/;

  const isDivider = (line: string) =>
    line &&
    typeof line === "string" &&
    line.includes("|") &&
    tableDividerRegex.test(line);

  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i];
    const nextLine = lines[i + 1] ?? "";

    // 逻辑：
    // 1. 当前行看起来像表头（包含 |）
    // 2. 下一行是分隔行（---）
    // 3. 前一行不是空行且不是表格行
    if (
      tableRowRegex.test(currentLine) &&
      isDivider(nextLine) &&
      i > 0 &&
      lines[i - 1].trim() !== "" &&
      !tableRowRegex.test(lines[i - 1])
    ) {
      result.push("");
    }

    result.push(currentLine);
  }
  return result.join("\n");
}

// ============ AI Card 相关 ============

/**
 * 构建卡片投放请求体
 */
function buildDeliverBody(
  cardInstanceId: string,
  target: AICardTarget,
  robotCode: string,
): any {
  const base = { outTrackId: cardInstanceId, userIdType: 1 };

  if (target.type === "group") {
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
 */
export async function createAICardForTarget(
  config: DingtalkConfig,
  target: AICardTarget,
  log?: any,
): Promise<AICardInstance | null> {
  const targetDesc =
    target.type === "group"
      ? `群聊 ${target.openConversationId}`
      : `用户 ${target.userId}`;

  try {
    console.log(
      `[createAICardForTarget] 被调用: targetDesc=${targetDesc}, log=${typeof log}, hasInfo=${typeof log?.info}`,
    );
    const token = await getAccessToken(config);
    const cardInstanceId = `card_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    log?.info?.(
      `[DingTalk][AICard] 开始创建卡片: ${targetDesc}, outTrackId=${cardInstanceId}`,
    );

    // 1. 创建卡片实例
    const createBody = {
      cardTemplateId: AI_CARD_TEMPLATE_ID,
      outTrackId: cardInstanceId,
      cardData: { cardParamMap: {} },
      callbackType: "STREAM",
      imGroupOpenSpaceModel: { supportForward: true },
      imRobotOpenSpaceModel: { supportForward: true },
    };

    log?.info?.(`[DingTalk][AICard] POST /v1.0/card/instances`);
    const createResp = await axios.post(
      `${DINGTALK_API}/v1.0/card/instances`,
      createBody,
      {
        headers: {
          "x-acs-dingtalk-access-token": token,
          "Content-Type": "application/json",
        },
      },
    );
    log?.info?.(`[DingTalk][AICard] 创建卡片响应: status=${createResp.status}`);

    // 2. 投放卡片
    const deliverBody = buildDeliverBody(
      cardInstanceId,
      target,
      config.clientId,
    );

    log?.info?.(
      `[DingTalk][AICard] POST /v1.0/card/instances/deliver body=${JSON.stringify(deliverBody)}`,
    );
    const deliverResp = await axios.post(
      `${DINGTALK_API}/v1.0/card/instances/deliver`,
      deliverBody,
      {
        headers: {
          "x-acs-dingtalk-access-token": token,
          "Content-Type": "application/json",
        },
      },
    );
    log?.info?.(
      `[DingTalk][AICard] 投放卡片响应: status=${deliverResp.status}`,
    );

    return { cardInstanceId, accessToken: token, inputingStarted: false };
  } catch (err: any) {
    log?.error?.(
      `[DingTalk][AICard] 创建卡片失败 (${targetDesc}): ${err.message}`,
    );
    if (err.response) {
      log?.error?.(
        `[DingTalk][AICard] 错误响应: status=${err.response.status} data=${JSON.stringify(err.response.data)}`,
      );
    }
    return null;
  }
}

/**
 * 流式更新 AI Card 内容
 */
export async function streamAICard(
  card: AICardInstance,
  content: string,
  finished: boolean = false,
  log?: any,
): Promise<void> {
  // 首次 streaming 前，先切换到 INPUTING 状态
  if (!card.inputingStarted) {
    const statusBody = {
      outTrackId: card.cardInstanceId,
      cardData: {
        cardParamMap: {
          flowStatus: AICardStatus.INPUTING,
          msgContent: content,
          staticMsgContent: "",
          sys_full_json_obj: JSON.stringify({
            order: ["msgContent"],
          }),
        },
      },
    };
    log?.info?.(
      `[DingTalk][AICard] PUT /v1.0/card/instances (INPUTING) outTrackId=${card.cardInstanceId}`,
    );
    try {
      const statusResp = await axios.put(
        `${DINGTALK_API}/v1.0/card/instances`,
        statusBody,
        {
          headers: {
            "x-acs-dingtalk-access-token": card.accessToken,
            "Content-Type": "application/json",
          },
        },
      );
      log?.info?.(
        `[DingTalk][AICard] INPUTING 响应: status=${statusResp.status} data=${JSON.stringify(statusResp.data)}`,
      );
    } catch (err: any) {
      log?.error?.(
        `[DingTalk][AICard] INPUTING 切换失败: ${err.message}, resp=${JSON.stringify(err.response?.data)}`,
      );
      throw err;
    }
    card.inputingStarted = true;
  }

  // 调用 streaming API 更新内容
  // ✅ 修正 Markdown 表格格式，确保钉钉能正确渲染
  const fixedContent = ensureTableBlankLines(content);
  const body = {
    outTrackId: card.cardInstanceId,
    guid: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    key: "msgContent",
    content: fixedContent,
    isFull: true,
    isFinalize: finished,
    isError: false,
  };

  log?.info?.(
    `[DingTalk][AICard] PUT /v1.0/card/streaming contentLen=${content.length} isFinalize=${finished} guid=${body.guid}`,
  );
  try {
    const streamResp = await axios.put(
      `${DINGTALK_API}/v1.0/card/streaming`,
      body,
      {
        headers: {
          "x-acs-dingtalk-access-token": card.accessToken,
          "Content-Type": "application/json",
        },
      },
    );
    log?.info?.(
      `[DingTalk][AICard] streaming 响应: status=${streamResp.status}`,
    );
  } catch (err: any) {
    log?.error?.(
      `[DingTalk][AICard] streaming 更新失败: ${err.message}, resp=${JSON.stringify(err.response?.data)}`,
    );
    throw err;
  }
}

/**
 * 完成 AI Card
 */
export async function finishAICard(
  card: AICardInstance,
  content: string,
  log?: any,
): Promise<void> {
  // ✅ 修正 Markdown 表格格式
  const fixedContent = ensureTableBlankLines(content);
  log?.info?.(
    `[DingTalk][AICard] 开始 finish，最终内容长度=${fixedContent.length}`,
  );

  // 1. 先用最终内容关闭流式通道
  await streamAICard(card, fixedContent, true, log);

  // 2. 更新卡片状态为 FINISHED
  const body = {
    outTrackId: card.cardInstanceId,
    cardData: {
      cardParamMap: {
        flowStatus: AICardStatus.FINISHED,
        msgContent: fixedContent,
        staticMsgContent: "",
        sys_full_json_obj: JSON.stringify({
          order: ["msgContent"],
        }),
      },
    },
  };

  log?.info?.(
    `[DingTalk][AICard] PUT /v1.0/card/instances (FINISHED) outTrackId=${card.cardInstanceId}`,
  );
  try {
    const finishResp = await axios.put(
      `${DINGTALK_API}/v1.0/card/instances`,
      body,
      {
        headers: {
          "x-acs-dingtalk-access-token": card.accessToken,
          "Content-Type": "application/json",
        },
      },
    );
    log?.info?.(
      `[DingTalk][AICard] FINISHED 响应: status=${finishResp.status} data=${JSON.stringify(finishResp.data)}`,
    );
  } catch (err: any) {
    log?.error?.(
      `[DingTalk][AICard] FINISHED 更新失败: ${err.message}, resp=${JSON.stringify(err.response?.data)}`,
    );
  }
}

// ============ 普通消息发送 ============

/**
 * 发送 Markdown 消息
 */
async function sendMarkdownMessage(
  config: DingtalkConfig,
  sessionWebhook: string,
  title: string,
  markdown: string,
  options: any = {},
): Promise<any> {
  const token = await getAccessToken(config);
  let text = markdown;
  if (options.atUserId) text = `${text} @${options.atUserId}`;

  const body: any = {
    msgtype: "markdown",
    markdown: { title: title || "Message", text },
  };
  if (options.atUserId)
    body.at = { atUserIds: [options.atUserId], isAtAll: false };

  return (
    await axios.post(sessionWebhook, body, {
      headers: {
        "x-acs-dingtalk-access-token": token,
        "Content-Type": "application/json",
      },
    })
  ).data;
}

/**
 * 发送文本消息
 */
async function sendTextMessage(
  config: DingtalkConfig,
  sessionWebhook: string,
  text: string,
  options: any = {},
): Promise<any> {
  const token = await getAccessToken(config);
  const body: any = { msgtype: "text", text: { content: text } };
  if (options.atUserId)
    body.at = { atUserIds: [options.atUserId], isAtAll: false };

  return (
    await axios.post(sessionWebhook, body, {
      headers: {
        "x-acs-dingtalk-access-token": token,
        "Content-Type": "application/json",
      },
    })
  ).data;
}

/**
 * 智能选择 text / markdown
 */
export async function sendMessage(
  config: DingtalkConfig,
  sessionWebhook: string,
  text: string,
  options: any = {},
): Promise<any> {
  const hasMarkdown =
    /^[#*>-]|[*_`#\[\]]/.test(text) ||
    (text && typeof text === "string" && text.includes("\n"));
  const useMarkdown =
    options.useMarkdown !== false && (options.useMarkdown || hasMarkdown);

  if (useMarkdown) {
    const title =
      options.title ||
      text
        .split("\n")[0]
        .replace(/^[#*\s\->]+/, "")
        .slice(0, 20) ||
      "Message";
    return sendMarkdownMessage(config, sessionWebhook, title, text, options);
  }
  return sendTextMessage(config, sessionWebhook, text, options);
}

// ============ 主动发送消息 ============

/**
 * 构建普通消息的 msgKey 和 msgParam
 */
function buildMsgPayload(
  msgType: DingTalkMsgType,
  content: string,
  title?: string,
): { msgKey: string; msgParam: Record<string, any> } | { error: string } {
  switch (msgType) {
    case "markdown":
      return {
        msgKey: "sampleMarkdown",
        msgParam: {
          title:
            title ||
            content
              .split("\n")[0]
              .replace(/^[#*\s\->]+/, "")
              .slice(0, 20) ||
            "Message",
          text: content,
        },
      };
    case "link":
      try {
        return {
          msgKey: "sampleLink",
          msgParam: typeof content === "string" ? JSON.parse(content) : content,
        };
      } catch {
        return { error: "Invalid link message format, expected JSON" };
      }
    case "actionCard":
      try {
        return {
          msgKey: "sampleActionCard",
          msgParam: typeof content === "string" ? JSON.parse(content) : content,
        };
      } catch {
        return { error: "Invalid actionCard message format, expected JSON" };
      }
    case "image":
      return {
        msgKey: "sampleImageMsg",
        msgParam: { photoURL: content },
      };
    case "text":
    default:
      return {
        msgKey: "sampleText",
        msgParam: { content },
      };
  }
}

/**
 * 使用普通消息 API 发送单聊消息（降级方案）
 */
async function sendNormalToUser(
  config: DingtalkConfig,
  userIds: string | string[],
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  const { msgType = "text", title, log } = options;
  const userIdArray = Array.isArray(userIds) ? userIds : [userIds];

  const payload = buildMsgPayload(msgType, content, title);
  if ("error" in payload) {
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

    log?.info?.(
      `[DingTalk][Normal] 发送单聊消息: userIds=${userIdArray.join(",")}, msgType=${msgType}`,
    );

    const resp = await axios.post(
      `${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`,
      body,
      {
        headers: {
          "x-acs-dingtalk-access-token": token,
          "Content-Type": "application/json",
        },
        timeout: 10_000,
      },
    );

    if (resp.data?.processQueryKey) {
      log?.info?.(
        `[DingTalk][Normal] 发送成功: processQueryKey=${resp.data.processQueryKey}`,
      );
      return {
        ok: true,
        processQueryKey: resp.data.processQueryKey,
        usedAICard: false,
      };
    }

    log?.warn?.(
      `[DingTalk][Normal] 发送响应异常: ${JSON.stringify(resp.data)}`,
    );
    return {
      ok: false,
      error: resp.data?.message || "Unknown error",
      usedAICard: false,
    };
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
  config: DingtalkConfig,
  openConversationId: string,
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  const { msgType = "text", title, log } = options;

  const payload = buildMsgPayload(msgType, content, title);
  if ("error" in payload) {
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

    log?.info?.(
      `[DingTalk][Normal] 发送群聊消息: openConversationId=${openConversationId}, msgType=${msgType}`,
    );

    const resp = await axios.post(
      `${DINGTALK_API}/v1.0/robot/groupMessages/send`,
      body,
      {
        headers: {
          "x-acs-dingtalk-access-token": token,
          "Content-Type": "application/json",
        },
        timeout: 10_000,
      },
    );

    if (resp.data?.processQueryKey) {
      log?.info?.(
        `[DingTalk][Normal] 发送成功: processQueryKey=${resp.data.processQueryKey}`,
      );
      return {
        ok: true,
        processQueryKey: resp.data.processQueryKey,
        usedAICard: false,
      };
    }

    log?.warn?.(
      `[DingTalk][Normal] 发送响应异常: ${JSON.stringify(resp.data)}`,
    );
    return {
      ok: false,
      error: resp.data?.message || "Unknown error",
      usedAICard: false,
    };
  } catch (err: any) {
    const errMsg = err.response?.data?.message || err.message;
    log?.error?.(`[DingTalk][Normal] 发送失败: ${errMsg}`);
    return { ok: false, error: errMsg, usedAICard: false };
  }
}

/**
 * 主动创建并发送 AI Card（通用内部实现）
 */
async function sendAICardInternal(
  config: DingtalkConfig,
  target: AICardTarget,
  content: string,
  log?: any,
): Promise<SendResult> {
  const targetDesc =
    target.type === "group"
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
      log?.warn?.(
        `[DingTalk][AICard][Proactive] 无法获取 oapiToken，跳过媒体后处理`,
      );
    }

    // 2. 后处理02：提取视频标记并发送视频消息
    log?.info?.(`[DingTalk][Video][Proactive] 开始视频后处理`);
    processedContent = await processVideoMarkers(
      processedContent,
      "",
      config,
      oapiToken,
      log,
      true,
      target,
    );

    // 3. 后处理03：提取音频标记并发送音频消息
    log?.info?.(`[DingTalk][Audio][Proactive] 开始音频后处理`);
    processedContent = await processAudioMarkers(
      processedContent,
      "",
      config,
      oapiToken,
      log,
      true,
      target,
    );

    // 4. 后处理04：提取文件标记并发送独立文件消息
    log?.info?.(`[DingTalk][File][Proactive] 开始文件后处理`);
    processedContent = await processFileMarkers(
      processedContent,
      "",
      config,
      oapiToken,
      log,
      true,
      target,
    );

    // 5. 检查处理后的内容是否为空
    const trimmedContent = processedContent.trim();
    if (!trimmedContent) {
      log?.info?.(
        `[DingTalk][AICard][Proactive] 处理后内容为空（纯文件/视频消息），跳过创建 AI Card`,
      );
      return { ok: true, usedAICard: false };
    }

    // 6. 创建卡片
    const card = await createAICardForTarget(config, target, log);
    if (!card) {
      return {
        ok: false,
        error: "Failed to create AI Card",
        usedAICard: false,
      };
    }

    // 7. 使用 finishAICard 设置内容
    await finishAICard(card, processedContent, log);

    log?.info?.(
      `[DingTalk][AICard][Proactive] AI Card 发送成功: ${targetDesc}, cardInstanceId=${card.cardInstanceId}`,
    );
    return { ok: true, cardInstanceId: card.cardInstanceId, usedAICard: true };
  } catch (err: any) {
    log?.error?.(
      `[DingTalk][AICard][Proactive] AI Card 发送失败 (${targetDesc}): ${err.message}`,
    );
    if (err.response) {
      log?.error?.(
        `[DingTalk][AICard][Proactive] 错误响应: status=${err.response.status} data=${JSON.stringify(err.response.data)}`,
      );
    }
    return {
      ok: false,
      error: err.response?.data?.message || err.message,
      usedAICard: false,
    };
  }
}

/**
 * 主动发送 AI Card 到单聊用户
 */
export async function sendAICardToUser(
  config: DingtalkConfig,
  userId: string,
  content: string,
  log?: any,
): Promise<SendResult> {
  return sendAICardInternal(config, { type: "user", userId }, content, log);
}

/**
 * 主动发送 AI Card 到群聊
 */
export async function sendAICardToGroup(
  config: DingtalkConfig,
  openConversationId: string,
  content: string,
  log?: any,
): Promise<SendResult> {
  return sendAICardInternal(
    config,
    { type: "group", openConversationId },
    content,
    log,
  );
}

/**
 * 主动发送文本消息到钉钉
 */
export async function sendToUser(
  config: DingtalkConfig,
  userId: string,
  text: string,
  options?: ProactiveSendOptions,
): Promise<SendResult> {
  return sendProactive(config, { userId }, text, options || {});
}

/**
 * 主动发送文本消息到钉钉群
 */
export async function sendToGroup(
  config: DingtalkConfig,
  openConversationId: string,
  text: string,
  options?: ProactiveSendOptions,
): Promise<SendResult> {
  return sendProactive(config, { openConversationId }, text, options || {});
}

/**
 * 发送文本消息（用于 outbound 接口）
 */
export async function sendTextToDingTalk(params: {
  config: DingtalkConfig;
  target: string;
  text: string;
  replyToId?: string;
}): Promise<SendResult> {
  const { config, target, text, replyToId } = params;

  // 参数校验
  if (!target || typeof target !== "string") {
    console.error("[sendTextToDingTalk] target 参数无效:", target);
    return { ok: false, error: "Invalid target parameter", usedAICard: false };
  }

  // 判断目标是用户还是群
  const isUser = !target.startsWith("cid");
  const targetParam = isUser
    ? { type: "user" as const, userId: target }
    : { type: "group" as const, openConversationId: target };

  return sendProactive(config, targetParam, text, {
    msgType: "text",
    replyToId,
  });
}

/**
 * 发送媒体消息（用于 outbound 接口）
 */
export async function sendMediaToDingTalk(params: {
  config: DingtalkConfig;
  target: string;
  text?: string;
  mediaUrl: string;
  replyToId?: string;
}): Promise<SendResult> {
  // 临时调试：打印 config.debug 的值
  console.log('[sendMediaToDingTalk] config.debug =', params.config?.debug, 'config =', JSON.stringify({
    debug: params.config?.debug,
    hasConfig: !!params.config,
  }));
  
  const log = createLoggerFromConfig(params.config, 'sendMediaToDingTalk');
  
  log.info(
    "开始处理，params:",
    JSON.stringify({
      target: params.target,
      text: params.text,
      mediaUrl: params.mediaUrl,
      replyToId: params.replyToId,
      hasConfig: !!params.config,
    }),
  );

  const { config, target, text, mediaUrl, replyToId } = params;

  // 参数校验
  if (!target || typeof target !== "string") {
    log.error("target 参数无效:", target);
    return { ok: false, error: "Invalid target parameter", usedAICard: false };
  }

  // 判断目标是用户还是群
  const isUser = !target.startsWith("cid");
  const targetParam = isUser
    ? { type: "user" as const, userId: target }
    : { type: "group" as const, openConversationId: target };

  log.info("参数解析完成，mediaUrl:", mediaUrl, "type:", typeof mediaUrl);

  // 参数校验
  if (!mediaUrl) {
    log.info("mediaUrl 为空，返回错误提示");
    return sendProactive(config, targetParam, text ?? "⚠️ 缺少媒体文件 URL", {
      msgType: "text",
      replyToId,
    });
  }

  // 1. 先发送文本消息（如果有）
  if (text?.trim()) {
    log.info("先发送文本消息");
    await sendProactive(config, targetParam, text, {
      msgType: "text",
      replyToId,
    });
  }

  // 2. 上传媒体文件并发送媒体消息
  try {
    log.info("开始获取 oapiToken");
    const oapiToken = await getOapiAccessToken(config);
    log.info("oapiToken 获取成功");

    // 根据文件扩展名判断媒体类型
    log.info("开始解析文件扩展名，mediaUrl:", mediaUrl);
    const ext = mediaUrl.toLowerCase().split(".").pop() || "";
    log.info("文件扩展名:", ext);
    let mediaType: "image" | "file" | "video" | "voice" = "file";

    if (["jpg", "jpeg", "png", "gif", "bmp", "webp"].includes(ext)) {
      mediaType = "image";
    } else if (
      ["mp4", "avi", "mov", "mkv", "flv", "wmv", "webm"].includes(ext)
    ) {
      mediaType = "video";
    } else if (
      ["mp3", "wav", "aac", "ogg", "m4a", "flac", "wma", "amr"].includes(ext)
    ) {
      mediaType = "voice";
    }
    log.info("媒体类型判断完成:", mediaType);

    // 上传文件到钉钉
    const debugEnabled = config.debug === true || config.debug === 'true';
    log.info("准备调用 uploadMediaToDingTalk，参数:", { mediaUrl, mediaType, debug: debugEnabled });
    const uploadResult = await uploadMediaToDingTalk(
      mediaUrl,
      mediaType,
      oapiToken,
      20 * 1024 * 1024,
      debugEnabled,
    );
    log.info("uploadMediaToDingTalk 返回结果:", uploadResult);

    if (!uploadResult) {
      // 上传失败，发送文本消息提示
      log.error("上传失败，返回错误提示");
      return sendProactive(config, targetParam, "⚠️ 媒体文件上传失败", {
        msgType: "text",
        replyToId,
      });
    }

    // uploadResult 现在是下载链接，需要提取 media_id
    // 格式：https://down.dingtalk.com/media/{media_id}
    const mediaId = uploadResult.replace(
      "https://down.dingtalk.com/media/",
      "",
    );
    log.info("提取 media_id:", mediaId);

    // 3. 根据媒体类型发送对应的消息
    const fileName = mediaUrl.split("/").pop() || "file";

    if (mediaType === "image") {
      // 图片消息 - 发送真正的图片消息
      const result = await sendProactive(config, targetParam, mediaId, {
        msgType: "image",
        replyToId,
      });
      return {
        ...result,
        processQueryKey: result.processQueryKey || "image-message-sent",
      };
    }

    // 对于视频，使用视频标记机制
    if (mediaType === "video") {
      // 构建视频标记
      const videoMarker = `[DINGTALK_VIDEO]{"path":"${mediaUrl}"}[/DINGTALK_VIDEO]`;

      // 直接处理视频标记（上传并发送视频消息）
      const { processVideoMarkers } = await import("./media.js");
      await processVideoMarkers(
        videoMarker, // 只传入标记，不包含原始文本
        "",
        config,
        oapiToken,
        console,
        true, // useProactiveApi
        targetParam,
      );

      // 如果有原始文本，单独发送
      if (text?.trim()) {
        const result = await sendProactive(config, targetParam, text, {
          msgType: "text",
          replyToId,
        });
        return {
          ...result,
          processQueryKey: result.processQueryKey || "video-text-sent",
        };
      }

      // 视频已发送，返回成功
      return {
        ok: true,
        usedAICard: false,
        processQueryKey: "video-message-sent",
      };
    }

    // 对于音频、文件，发送包含下载链接的文本消息
    const fs = await import("fs");
    const stats = fs.statSync(mediaUrl);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    // 构建下载链接（添加文件扩展名）
    const downloadUrl = `${uploadResult}.${ext}`;

    // 根据媒体类型选择图标和描述
    let icon = "📄";
    let typeLabel = "文件";
    if (mediaType === "voice") {
      icon = "🎵";
      typeLabel = "音频";
    }

    const message = `${icon} ${typeLabel}文件已上传\n\n文件: ${fileName}\n大小: ${fileSizeMB} MB\n\n下载链接: ${downloadUrl}`;

    const result = await sendProactive(config, targetParam, message, {
      msgType: "text",
      replyToId,
    });

    // 确保返回值中有 processQueryKey，告诉 SDK 消息已发送成功
    return {
      ...result,
      processQueryKey: result.processQueryKey || "media-message-sent",
    };
  } catch (err: any) {
    console.error("[sendMediaToDingTalk] 发送媒体消息失败:", err.message);
    // 发生错误，发送文本消息提示
    return sendProactive(
      config,
      targetParam,
      `⚠️ 媒体文件处理失败: ${err.message}`,
      { msgType: "text", replyToId },
    );
  }
}

/**
 * 智能发送消息
 */
export async function sendProactive(
  config: DingtalkConfig,
  target: { userId?: string; userIds?: string[]; openConversationId?: string },
  content: string,
  options: ProactiveSendOptions = {},
): Promise<SendResult> {
  console.log(
    "[sendProactive] 开始处理，参数:",
    JSON.stringify({
      target,
      contentLength: content?.length,
      hasOptions: !!options,
    }),
  );

  if (!options.msgType) {
    const hasMarkdown =
      /^[#*>-]|[*_`#\[\]]/.test(content) ||
      (content && typeof content === "string" && content.includes("\n"));
    if (hasMarkdown) {
      options.msgType = "markdown";
    }
  }

  // 直接实现发送逻辑，不要递归调用 sendToUser/sendToGroup
  if (target.userId || target.userIds) {
    const userIds = target.userIds || [target.userId!];
    const userId = userIds[0];
    console.log("[sendProactive] 发送给用户，userId:", userId);

    // 构建发送参数
    return sendProactiveInternal(
      config,
      { type: "user", userId },
      content,
      options,
    );
  }

  if (target.openConversationId) {
    console.log(
      "[sendProactive] 发送给群聊，openConversationId:",
      target.openConversationId,
    );
    return sendProactiveInternal(
      config,
      { type: "group", openConversationId: target.openConversationId },
      content,
      options,
    );
  }

  console.error("[sendProactive] target 参数缺少必要字段:", target);
  return {
    ok: false,
    error: "Must specify userId, userIds, or openConversationId",
    usedAICard: false,
  };
}

/**
 * 内部发送实现
 */
async function sendProactiveInternal(
  config: DingtalkConfig,
  target: AICardTarget,
  content: string,
  options: ProactiveSendOptions,
): Promise<SendResult> {
  console.log(
    "[sendProactiveInternal] 开始处理，参数:",
    JSON.stringify({
      target,
      contentLength: content?.length,
      msgType: options.msgType,
      useAICard: options.useAICard,
      targetType: target?.type,
      hasTarget: !!target,
    }),
  );

  // 参数校验
  if (!target || typeof target !== "object") {
    console.error("[sendProactiveInternal] target 参数无效:", target);
    return { ok: false, error: "Invalid target parameter", usedAICard: false };
  }

  const {
    msgType = "text",
    useAICard = false,
    fallbackToNormal = false,
    log,
  } = options;

  // 如果启用 AI Card
  if (useAICard) {
    try {
      const card = await createAICardForTarget(config, target, log);
      if (card) {
        await finishAICard(card, content, log);
        return {
          ok: true,
          cardInstanceId: card.cardInstanceId,
          usedAICard: true,
        };
      }
      if (!fallbackToNormal) {
        return {
          ok: false,
          error: "Failed to create AI Card",
          usedAICard: false,
        };
      }
    } catch (err: any) {
      log?.error?.(`[DingTalk] AI Card 发送失败: ${err.message}`);
      if (!fallbackToNormal) {
        return { ok: false, error: err.message, usedAICard: false };
      }
    }
  }

  // 发送普通消息
  try {
    console.log(
      "[sendProactiveInternal] 准备发送普通消息，target.type:",
      target.type,
    );
    const token = await getAccessToken(config);
    const isUser = target.type === "user";
    console.log(
      "[sendProactiveInternal] isUser:",
      isUser,
      "target:",
      JSON.stringify(target),
    );
    const targetId = isUser ? target.userId : target.openConversationId;
    console.log("[sendProactiveInternal] targetId:", targetId);

    // ✅ 根据目标类型选择不同的 API
    const webhookUrl = isUser
      ? `${DINGTALK_API}/v1.0/robot/oToMessages/batchSend`
      : `${DINGTALK_API}/v1.0/robot/groupMessages/send`;

    // 构建消息体
    const body: any = {
      robotCode: config.clientId,
      msgKey: msgType === "markdown" ? "sampleMarkdown" : "sampleText",
    };

    if (msgType === "markdown") {
      body.msgParam = JSON.stringify({
        title: options.title || "Message",
        text: content,
      });
    } else {
      body.msgParam = JSON.stringify({ content });
    }

    // ✅ 根据目标类型设置不同的参数
    if (isUser) {
      body.userIds = [targetId];
    } else {
      body.openConversationId = targetId;
    }

    log?.info?.(
      `[DingTalk] 发送${isUser ? '单聊' : '群聊'}消息：${isUser ? 'userIds=' : 'openConversationId='}${targetId}`,
    );

    const resp = await axios.post(webhookUrl, body, {
      headers: {
        "x-acs-dingtalk-access-token": token,
        "Content-Type": "application/json",
      },
    });

    log?.info?.(
      `[DingTalk] 发送${isUser ? '单聊' : '群聊'}消息成功：processQueryKey=${resp.data?.processQueryKey}`,
    );

    return {
      ok: true,
      processQueryKey: resp.data?.processQueryKey,
      usedAICard: false,
    };
  } catch (err: any) {
    log?.error?.(`[DingTalk] 发送${target.type === 'user' ? '单聊' : '群聊'}消息失败：${err.message}`);
    return { ok: false, error: err.message, usedAICard: false };
  }
}
