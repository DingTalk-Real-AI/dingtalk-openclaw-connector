/**
 * 钉钉消息发送模块
 * 支持 AI Card 流式响应、普通消息、主动消息
 */

import axios from "axios";
import type { DingtalkConfig } from "../types/index.ts";
import { DINGTALK_API, getAccessToken, getOapiAccessToken } from "../utils/index.ts";
import { createLoggerFromConfig } from "../utils/logger.ts";
import {
  processLocalImages,
  processVideoMarkers,
  processAudioMarkers,
  processFileMarkers,
  uploadMediaToDingTalk,
} from "./media.ts";
// ✅ 导入 AI Card 相关函数，避免重复实现
import {
  createAICardForTarget,
  streamAICard,
  finishAICard,
  type AICardInstance,
  type AICardTarget,
} from "./messaging/card.ts";

// ============ 常量 ============
// 注意：AI Card 相关的类型和函数已移至 ./messaging/card.ts，通过上方 import 引入

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

// ============ AI Card 相关函数已移至 ./messaging/card.ts ============
// createAICardForTarget, streamAICard, finishAICard 现在从 card.ts 导入使用

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
      `发送单聊消息: userIds=${userIdArray.join(",")}, msgType=${msgType}`,
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
        `发送成功: processQueryKey=${resp.data.processQueryKey}`,
      );
      return {
        ok: true,
        processQueryKey: resp.data.processQueryKey,
        usedAICard: false,
      };
    }

    log?.warn?.(
      `发送响应异常: ${JSON.stringify(resp.data)}`,
    );
    return {
      ok: false,
      error: resp.data?.message || "Unknown error",
      usedAICard: false,
    };
  } catch (err: any) {
    const errMsg = err.response?.data?.message || err.message;
    log?.error?.(`发送失败: ${errMsg}`);
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
      `发送群聊消息: openConversationId=${openConversationId}, msgType=${msgType}`,
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
        `发送成功: processQueryKey=${resp.data.processQueryKey}`,
      );
      return {
        ok: true,
        processQueryKey: resp.data.processQueryKey,
        usedAICard: false,
      };
    }

    log?.warn?.(
      `发送响应异常: ${JSON.stringify(resp.data)}`,
    );
    return {
      ok: false,
      error: resp.data?.message || "Unknown error",
      usedAICard: false,
    };
  } catch (err: any) {
    const errMsg = err.response?.data?.message || err.message;
    log?.error?.(`发送失败: ${errMsg}`);
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
      log?.info?.(`开始图片后处理`);
      processedContent = await processLocalImages(content, oapiToken, log);
    } else {
      log?.warn?.(
        `无法获取 oapiToken，跳过媒体后处理`,
      );
    }

    // 2. 后处理02：提取视频标记并发送视频消息
    log?.info?.(`开始视频后处理`);
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
    log?.info?.(`开始音频后处理`);
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
    log?.info?.(`开始文件后处理`);
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
        `处理后内容为空（纯文件/视频消息），跳过创建 AI Card`,
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
      `AI Card 发送成功: ${targetDesc}, cardInstanceId=${card.cardInstanceId}`,
    );
    return { ok: true, cardInstanceId: card.cardInstanceId, usedAICard: true };
  } catch (err: any) {
    log?.error?.(
      `AI Card 发送失败 (${targetDesc}): ${err.message}`,
    );
    if (err.response) {
      log?.error?.(
        `错误响应: status=${err.response.status} data=${JSON.stringify(err.response.data)}`,
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

  const log = createLoggerFromConfig(config, 'sendTextToDingTalk');

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
    const debugEnabled =
      config.debug === true || String(config.debug).toLowerCase() === "true";
    log.info("准备调用 uploadMediaToDingTalk，参数:", { mediaUrl, mediaType, debug: debugEnabled });
    if (!oapiToken) {
      log.error("oapiToken 为空，无法上传媒体文件");
      return sendProactive(
        config,
        targetParam,
        "⚠️ 媒体文件处理失败：缺少 oapiToken",
        { msgType: "text", replyToId },
      );
    }
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
    log.error("发送媒体消息失败:", err.message);
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
  const log = createLoggerFromConfig(config, 'sendProactive');
  
  log.info(
    "开始处理，参数:",
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
    log.info("发送给用户，userId:", userId);

    // 构建发送参数
    return sendProactiveInternal(
      config,
      { type: "user", userId },
      content,
      options,
    );
  }

  if (target.openConversationId) {
    log.info(
      "发送给群聊，openConversationId:",
      target.openConversationId,
    );
    return sendProactiveInternal(
      config,
      { type: "group", openConversationId: target.openConversationId },
      content,
      options,
    );
  }

  log.error("target 参数缺少必要字段:", target);
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
  const log = createLoggerFromConfig(config, 'sendProactiveInternal');
  
  log.info(
    "开始处理，参数:",
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
    log.error("target 参数无效:", target);
    return { ok: false, error: "Invalid target parameter", usedAICard: false };
  }

  const {
    msgType = "text",
    useAICard = false,
    fallbackToNormal = false,
    log: externalLog,
  } = options;

  // 如果启用 AI Card
  if (useAICard) {
    try {
      const card = await createAICardForTarget(config, target, externalLog);
      if (card) {
        await finishAICard(card, content, externalLog);
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
      externalLog?.error?.(`AI Card 发送失败: ${err.message}`);
      if (!fallbackToNormal) {
        return { ok: false, error: err.message, usedAICard: false };
      }
    }
  }

  // 发送普通消息
  try {
    log.info(
      "准备发送普通消息，target.type:",
      target.type,
    );
    const token = await getAccessToken(config);
    const isUser = target.type === "user";
    log.info(
      "isUser:",
      isUser,
      "target:",
      JSON.stringify(target),
    );
    const targetId = isUser ? target.userId : target.openConversationId;
    log.info("targetId:", targetId);

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

    externalLog?.info?.(
      `发送${isUser ? '单聊' : '群聊'}消息：${isUser ? 'userIds=' : 'openConversationId='}${targetId}`,
    );

    const resp = await axios.post(webhookUrl, body, {
      headers: {
        "x-acs-dingtalk-access-token": token,
        "Content-Type": "application/json",
      },
    });

    // 重要：钉钉接口有时会出现 HTTP 200 但业务失败的情况，需要打印返回体辅助排查
    try {
      const dataPreview = JSON.stringify(resp.data ?? {});
      const truncated =
        dataPreview.length > 2000 ? `${dataPreview.slice(0, 2000)}...(truncated)` : dataPreview;
      const msg = `发送${isUser ? "单聊" : "群聊"}消息响应：status=${resp.status}, processQueryKey=${resp.data?.processQueryKey ?? ""}, data=${truncated}`;
      log.info(msg);
      externalLog?.info?.(msg);
    } catch {
      const msg = `发送${isUser ? "单聊" : "群聊"}消息响应：status=${resp.status}, processQueryKey=${resp.data?.processQueryKey ?? ""}`;
      log.info(msg);
      externalLog?.info?.(msg);
    }

    return {
      ok: true,
      processQueryKey: resp.data?.processQueryKey,
      usedAICard: false,
    };
  } catch (err: any) {
    const status = err?.response?.status;
    const respData = err?.response?.data;
    let respPreview = "";
    try {
      const raw = JSON.stringify(respData ?? {});
      respPreview = raw.length > 2000 ? `${raw.slice(0, 2000)}...(truncated)` : raw;
    } catch {
      respPreview = String(respData ?? "");
    }

    const baseMsg = err?.message ? String(err.message) : String(err);
    const extra =
      typeof status === "number"
        ? ` status=${status}${respPreview ? `, data=${respPreview}` : ""}`
        : respPreview
          ? ` data=${respPreview}`
          : "";

    const msg = `发送${target.type === "user" ? "单聊" : "群聊"}消息失败：${baseMsg}${extra}`;
log.error(msg);
externalLog.error(msg);
    return { ok: false, error: baseMsg, usedAICard: false };
  }
}
