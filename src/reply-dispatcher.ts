// 类型定义
interface ClawdbotConfig {
  [key: string]: any;
}

interface RuntimeEnv {
  log?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
  warn?: (...args: any[]) => void;
  debug?: (...args: any[]) => void;
  info?: (...args: any[]) => void;
  [key: string]: any;
}

interface ReplyPayload {
  text?: string;
  [key: string]: any;
}

type SupportCaseRouteForReplyDispatcher = {
  caseId: string;
  rootMessageId: string;
  publicCaseRef?: string;
  matchedBy: 'reply_map' | 'marker' | 'new_root';
  isNewCase: boolean;
};

type SupportCaseReplyMapStore = {
  recordOutbound: (input: {
    accountId: string;
    conversationId: string;
    messageId: string;
    caseId: string;
    rootMessageId: string;
    publicCaseRef?: string;
    source: 'outbound_ack';
  }) => Promise<unknown>;
};

type SupportCaseReplyContext = {
  route: SupportCaseRouteForReplyDispatcher;
  replyMapStore: SupportCaseReplyMapStore;
  markerMode?: 'short-ref' | 'none';
};

const PUBLIC_CASE_REF_PATTERN = /^#Q-[A-Z0-9]{4,16}$/i;
const KNOWN_UNSTABLE_OUTBOUND_IDS = new Set([
  'unknown',
  'file-message-sent',
  'image-message-sent',
  'video-message-sent',
  'video-text-sent',
]);

function normalizePublicCaseRef(publicCaseRef: string): string | undefined {
  const normalized = publicCaseRef.trim().toUpperCase();
  return PUBLIC_CASE_REF_PATTERN.test(normalized) ? normalized : undefined;
}

function normalizeStableOutboundId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized || KNOWN_UNSTABLE_OUTBOUND_IDS.has(normalized.toLowerCase())) return undefined;
  return normalized;
}

function summarizeSupportCaseOutboundObjectKeys(value: unknown, maxKeys: number = 12): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const keys = Object.keys(value as Record<string, unknown>).sort();
  if (keys.length <= maxKeys) return keys;
  return [...keys.slice(0, maxKeys), `...+${keys.length - maxKeys}`];
}

function appendSupportCaseOutboundIdCandidate(
  candidates: Array<{ path: string; value: string }>,
  seen: Set<string>,
  path: string,
  rawValue: unknown,
) {
  if (typeof rawValue === 'string') {
    const trimmed = rawValue.trim();
    if (!trimmed) return;
    const dedupeKey = `${path}=${trimmed}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    candidates.push({ path, value: trimmed });
    return;
  }

  if (!Array.isArray(rawValue)) return;
  for (let index = 0; index < rawValue.length; index += 1) {
    appendSupportCaseOutboundIdCandidate(
      candidates,
      seen,
      `${path}[${index}]`,
      rawValue[index],
    );
  }
}

export function collectSupportCaseOutboundIdCandidates(value: unknown): Array<{ path: string; value: string }> {
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, any>;
  const entries: Array<[string, unknown]> = [
    ['cardInstanceId', record.cardInstanceId],
    ['outTrackId', record.outTrackId],
    ['processQueryKey', record.processQueryKey],
    ['messageId', record.messageId],
    ['msgId', record.msgId],
    ['data.cardInstanceId', record.data?.cardInstanceId],
    ['data.outTrackId', record.data?.outTrackId],
    ['data.processQueryKey', record.data?.processQueryKey],
    ['data.messageId', record.data?.messageId],
    ['data.msgId', record.data?.msgId],
    ['deliverResultCarrierIds', record.deliverResultCarrierIds],
    ['data.deliverResultCarrierIds', record.data?.deliverResultCarrierIds],
  ];
  const seen = new Set<string>();
  const candidates: Array<{ path: string; value: string }> = [];

  for (const [path, rawValue] of entries) {
    appendSupportCaseOutboundIdCandidate(candidates, seen, path, rawValue);
  }

  return candidates;
}

export function buildSupportCaseOutboundIdDiagnostics(value: unknown) {
  if (!value || typeof value !== 'object') {
    return {
      rawOutboundIdFields: {},
      outboundIdCandidates: [],
      keyShapes: {
        topLevel: [],
        data: [],
      },
    };
  }

  const record = value as Record<string, any>;
  return {
    rawOutboundIdFields: {
      cardInstanceId: typeof record.cardInstanceId === 'string' ? record.cardInstanceId : '',
      outTrackId: typeof record.outTrackId === 'string' ? record.outTrackId : '',
      processQueryKey: typeof record.processQueryKey === 'string' ? record.processQueryKey : '',
      messageId: typeof record.messageId === 'string' ? record.messageId : '',
      msgId: typeof record.msgId === 'string' ? record.msgId : '',
      'data.cardInstanceId': typeof record.data?.cardInstanceId === 'string' ? record.data.cardInstanceId : '',
      'data.outTrackId': typeof record.data?.outTrackId === 'string' ? record.data.outTrackId : '',
      'data.processQueryKey': typeof record.data?.processQueryKey === 'string' ? record.data.processQueryKey : '',
      'data.messageId': typeof record.data?.messageId === 'string' ? record.data.messageId : '',
      'data.msgId': typeof record.data?.msgId === 'string' ? record.data.msgId : '',
      deliverResultCarrierIds: Array.isArray(record.deliverResultCarrierIds)
        ? record.deliverResultCarrierIds.filter((item: unknown): item is string => typeof item === 'string')
        : [],
      'data.deliverResultCarrierIds': Array.isArray(record.data?.deliverResultCarrierIds)
        ? record.data.deliverResultCarrierIds.filter((item: unknown): item is string => typeof item === 'string')
        : [],
    },
    outboundIdCandidates: collectSupportCaseOutboundIdCandidates(value),
    keyShapes: {
      topLevel: summarizeSupportCaseOutboundObjectKeys(record),
      data: summarizeSupportCaseOutboundObjectKeys(record.data),
    },
  };
}

export function extractStableDingtalkOutboundMessageId(value: unknown): string | undefined {
  const candidates = collectSupportCaseOutboundIdCandidates(value).filter((candidate) =>
    candidate.path === 'cardInstanceId'
    || candidate.path === 'outTrackId'
    || candidate.path === 'data.cardInstanceId'
    || candidate.path === 'data.outTrackId',
  );

  for (const candidate of candidates) {
    const stableId = normalizeStableOutboundId(candidate.value);
    if (stableId) return stableId;
  }

  return undefined;
}

export function appendPublicCaseRefMarker(
  text: string,
  publicCaseRef: string | undefined,
  markerMode: 'short-ref' | 'none' = 'short-ref',
): string {
  if (markerMode === 'none' || !publicCaseRef) return text;

  const marker = normalizePublicCaseRef(publicCaseRef);
  if (!marker) return text;

  const markerInText = new RegExp(`${marker.replace('-', '\\-')}\\b`, 'i');
  if (markerInText.test(text)) return text;

  const trimmedRight = text.trimEnd();
  return trimmedRight ? `${trimmedRight}\n\n${marker}` : marker;
}

// ✅ 动态导入 channel-runtime 模块
const channelRuntimeModule = await import("openclaw/plugin-sdk/channel-runtime") as any;

const {
  createReplyPrefixOptions,
  createTypingCallbacks,
  logTypingFailure,
} = channelRuntimeModule;

import { createLoggerFromConfig } from "./utils/logger.ts";
import { CHANNEL_ID } from "./channel.ts";
import { resolveDingtalkAccount } from "./config/accounts.ts";
import { getDingtalkRuntime } from "./runtime.ts";
import type { DingtalkConfig } from "./types/index.ts";
import {
  createAICardForTarget,
  finishAICard,
  streamAICard,
  type AICardInstance,
  type AICardTarget,
} from "./services/messaging/card.ts";
import { sendMessage } from "./services/messaging.ts";
import { getOapiAccessToken } from "./utils/token.ts";
import {
  processLocalImages,
  processVideoMarkers,
  processAudioMarkers,
  uploadAndReplaceFileMarkers,
} from "./services/media/index.ts";


export type CreateDingtalkReplyDispatcherParams = {
  cfg: ClawdbotConfig;
  agentId: string;
  runtime: RuntimeEnv;
  conversationId: string;
  senderId: string;
  isDirect: boolean;
  accountId?: string;
  messageCreateTimeMs?: number;
  sessionWebhook: string;
  asyncMode?: boolean;
  /** 队列繁忙时预先创建的 AI Card，startStreaming 时直接复用而非新建 */
  preCreatedCard?: AICardInstance;
  supportCase?: SupportCaseReplyContext;
};

export function createDingtalkReplyDispatcher(params: CreateDingtalkReplyDispatcherParams) {
  const core = getDingtalkRuntime();
  const {
    cfg,
    agentId,
    conversationId,
    senderId,
    isDirect,
    accountId,
    sessionWebhook,
    asyncMode = false,
    preCreatedCard,
    supportCase,
  } = params;

  const account = resolveDingtalkAccount({ cfg, accountId });
  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg,
    agentId,
    channel: CHANNEL_ID,
    accountId,
  });

  // ✅ 读取 debug 配置
  const log = createLoggerFromConfig(account.config, `DingTalk:${accountId}`);

  // AI Card 状态管理
  let currentCardTarget: AICardInstance | null = null;
  let accumulatedText = "";
  const deliveredFinalTexts = new Set<string>();
  
  // 异步模式：累积完整响应
  let asyncModeFullResponse = "";
  
  // ✅ 节流控制：避免频繁调用钉钉 API 导致 QPS 限流
  // 全局令牌桶限流器已在 streamAICard 内部实现（card.ts），此处的 updateInterval
  // 作为单实例级别的前置过滤，减少不必要的 streamAICard 调用
  let lastUpdateTime = 0;
  const updateInterval = 800; // 最小更新间隔 800ms（配合 card.ts 全局限流器，降低单实例发送频率）

  // ✅ 错误兜底：防止重复发送错误消息
  const deliveredErrorTypes = new Set<string>();
  let lastErrorTime = 0;
  const ERROR_COOLDOWN = 60000; // 错误消息冷却时间 1 分钟
  const recordedSupportCaseOutboundIds = new Set<string>();

  const addSupportCaseMarkerForUnstableOutbound = (text: string) =>
    appendPublicCaseRefMarker(
      text,
      supportCase?.route.publicCaseRef,
      supportCase?.markerMode ?? 'short-ref',
    );

  const recordStableSupportCaseOutbound = async (candidate: unknown) => {
    if (!supportCase) return false;

    const outboundDiagnostics = buildSupportCaseOutboundIdDiagnostics(candidate);
    const messageId = extractStableDingtalkOutboundMessageId(candidate);
    log.info(
      `[support-case-router] outbound-id-diagnostics: rawOutboundIdFields=${JSON.stringify(outboundDiagnostics.rawOutboundIdFields)}, outboundIdCandidates=${JSON.stringify(outboundDiagnostics.outboundIdCandidates.map((entry) => `${entry.path}=${entry.value}`))}, selectedReplyMapId=${JSON.stringify(messageId || '')}, keyShapes=${JSON.stringify(outboundDiagnostics.keyShapes)}`,
    );
    if (!messageId) {
      log.info(
        `[support-case-router] outbound-id-fallback: selectedReplyMapId=\"\", outboundIdCandidates=${JSON.stringify(outboundDiagnostics.outboundIdCandidates.map((entry) => `${entry.path}=${entry.value}`))}`,
      );
      return false;
    }
    if (recordedSupportCaseOutboundIds.has(messageId)) {
      log.info(`[support-case-router] outbound-id-fallback: selectedReplyMapId=${JSON.stringify(messageId)}, duplicate=true`);
      return false;
    }

    recordedSupportCaseOutboundIds.add(messageId);
    try {
      await supportCase.replyMapStore.recordOutbound({
        accountId: account.accountId,
        conversationId: String(conversationId || ''),
        messageId,
        caseId: supportCase.route.caseId,
        rootMessageId: supportCase.route.rootMessageId,
        publicCaseRef: supportCase.route.publicCaseRef,
        source: 'outbound_ack',
      });
      log.info(`[support-case-router] recorded outbound reply_map id=${messageId}`);
      return true;
    } catch (err: any) {
      recordedSupportCaseOutboundIds.delete(messageId);
      log.warn(`[support-case-router] failed to record outbound reply_map: ${err?.message || String(err)}`);
      return false;
    }
  };

  // ============ 错误兜底函数 ============

  /**
   * 发送兜底错误消息，确保用户始终能收到反馈
   */
  const sendFallbackErrorMessage = async (
    errorType: 'mediaProcess' | 'sendMessage' | 'unknown',
    originalError?: string,
    forceSend: boolean = false
  ) => {
    const now = Date.now();
    const errorKey = `${errorType}:${conversationId}:${senderId}`;
    
    // 防止重复发送相同类型的错误消息
    if (!forceSend && deliveredErrorTypes.has(errorKey)) {
      log.debug(`[DingTalk][Fallback] 跳过重复错误消息：${errorType}`);
      return;
    }
    
    // 冷却时间控制
    if (!forceSend && now - lastErrorTime < ERROR_COOLDOWN) {
      log.debug(`[DingTalk][Fallback] 冷却时间内，跳过错误消息`);
      return;
    }

    const errorMessages = {
      mediaProcess: '⚠️ 媒体文件处理失败，已发送文字回复',
      sendMessage: '⚠️ 消息发送失败，请稍后重试',
      unknown: '⚠️ 抱歉，处理您的请求时出错，请稍后重试',
    };
    
    const errorMessage = addSupportCaseMarkerForUnstableOutbound(errorMessages[errorType]);
    log.warn(`[DingTalk][Fallback] ${errorMessage}, error: ${originalError}`);
    
    try {
      const result = await sendMessage(
        account.config as DingtalkConfig,
        sessionWebhook,
        errorMessage,
        {
          useMarkdown: false,
          log: params.runtime.log,
        }
      );
      await recordStableSupportCaseOutbound(result);
      deliveredErrorTypes.add(errorKey);
      lastErrorTime = now;
      log.info(`[DingTalk][Fallback] ✅ 错误消息发送成功`);
    } catch (fallbackErr: any) {
      log.error(`[DingTalk][Fallback] ❌ 错误消息发送失败：${fallbackErr.message}`);
    }
  };

  // 打字指示器回调（钉钉暂不支持，预留接口）
  const typingCallbacks = createTypingCallbacks({
    start: async () => {
      // 钉钉暂不支持打字指示器
    },
    stop: async () => {
      // 钉钉暂不支持打字指示器
    },
    onStartError: (err: any) =>
      logTypingFailure({
        log: (message: any) => params.runtime.log?.(message),
        channel: CHANNEL_ID,
        action: "start",
        error: err,
      }),
    onStopError: (err: any) =>
      logTypingFailure({
        log: (message: any) => params.runtime.log?.(message),
        channel: CHANNEL_ID,
        action: "stop",
        error: err,
      }),
  });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit(
    cfg,
    CHANNEL_ID,
    accountId,
    { fallbackLimit: 4000 }
  );
  const chunkMode = core.channel.text.resolveChunkMode(cfg, CHANNEL_ID);

  // 流式 AI Card 支持
  const streamingEnabled = (account.config as any)?.streaming !== false;
  // 用 Promise 保存 AI Card 的创建过程，避免 final 消息到达时轮询等待
  let cardCreationPromise: Promise<void> | null = null;

  const startStreaming = (): Promise<void> => {
    // 如果已经有创建中的 Promise，直接复用，避免并发创建
    if (cardCreationPromise) {
      return cardCreationPromise;
    }
    // 如果 AI Card 已存在，直接返回已完成的 Promise
    if (currentCardTarget) {
      return Promise.resolve();
    }

    cardCreationPromise = (async () => {
      // 异步模式下禁用流式 AI Card
      if (asyncMode) {
        log.info(`[DingTalk][startStreaming] 异步模式，跳过 AI Card 创建`);
        return;
      }
      if (!streamingEnabled) {
        log.info(`[DingTalk][startStreaming] 流式功能被禁用，跳过 AI Card 创建`);
        return;
      }

      // 若队列繁忙时已预先创建了 Card（显示排队 ACK 文案），直接复用，无需新建
      // 这样用户看到的是同一条消息从 ACK 文案更新为最终结果，而不是多出一条消息
      if (preCreatedCard) {
        log.info(`[DingTalk][startStreaming] 复用预创建 AI Card，cardInstanceId=${preCreatedCard.cardInstanceId}`);
        currentCardTarget = preCreatedCard;
        accumulatedText = "";
        return;
      }

      log.info(`[DingTalk][startStreaming] 开始创建 AI Card...`);

      try {
        const target: AICardTarget = isDirect
          ? { type: 'user', userId: senderId }
          : { type: 'group', openConversationId: conversationId };

        log.info(`[DingTalk][startStreaming] 目标：${JSON.stringify(target)}`);

        const card = await createAICardForTarget(
          account.config as DingtalkConfig,
          target,
          log
        );
        currentCardTarget = card;
        accumulatedText = "";

        if (card) {
          log.info(`[DingTalk][startStreaming] ✅ AI Card 创建成功`);
        } else {
          log.warn(`[DingTalk][startStreaming] AI Card 创建返回 null，静默降级到普通消息模式`);
        }
      } catch (error: any) {
        log.error(`[DingTalk][startStreaming] ❌ AI Card 创建失败：${error?.message || String(error)}，静默降级到普通消息模式`);
        currentCardTarget = null;
      } finally {
        // 创建完成后清空 Promise，允许下次重新创建
        cardCreationPromise = null;
      }
    })();

    return cardCreationPromise;
  };

  const closeStreaming: () => Promise<void> = async () => {
    // 立即捕获并清空，防止并发调用重复执行（竞争条件保护）
    // closeStreaming 可能被 onIdle 和 onError 同时触发，若不在此处清空，
    // 第一次调用的 finally 块会将 currentCardTarget 置 null，
    // 导致第二次调用的 finishAICard 收到 null 参数而崩溃
    const cardSnapshot = currentCardTarget;
    if (!cardSnapshot) {
      log.info(`[DingTalk][closeStreaming] 无 AI Card，跳过关闭`);
      return;
    }
    currentCardTarget = null;

    log.info(`[DingTalk][closeStreaming] 开始关闭 AI Card...`);

    try {
      // 处理媒体标记
      let finalText = accumulatedText;
      
      // ✅ 如果累积的文本为空，使用默认提示文案
      if (!finalText.trim()) {
        finalText = '✅ 任务执行完成（无文本输出）';
        log.info(`[DingTalk][closeStreaming] 累积文本为空，使用默认提示文案`);
      }
      
      // 获取 oapiToken 用于媒体处理
      const oapiToken = await getOapiAccessToken(account.config as DingtalkConfig);
      
      // ✅ 构建正确的 target（单聊用 senderId，群聊用 conversationId）
      const target: AICardTarget = isDirect
        ? { type: 'user', userId: senderId }
        : { type: 'group', openConversationId: conversationId };
      
      log.info(`[DingTalk][closeStreaming] 开始处理媒体文件，target=${JSON.stringify(target)}`);
      
      if (oapiToken) {
        // 处理本地图片
        finalText = await processLocalImages(finalText, oapiToken, log);
        
        // ✅ 先处理 Markdown 标记格式的媒体文件
        finalText = await processVideoMarkers(
          finalText,
          '',
          account.config as DingtalkConfig,
          oapiToken,
          log,
          true,  // ✅ 使用主动 API 模式
          target
        );
        finalText = await processAudioMarkers(
          finalText,
          '',
          account.config as DingtalkConfig,
          oapiToken,
          log,
          true,  // ✅ 使用主动 API 模式
          target
        );
        finalText = await uploadAndReplaceFileMarkers(
          finalText,
          '',
          account.config as DingtalkConfig,
          oapiToken,
          log,
          true,  // ✅ 使用主动 API 模式
          target
        );
        
        // ✅ 处理裸露的本地文件路径（绕过 OpenClaw SDK 的 bug）
        log.info(`[DingTalk][closeStreaming] 准备调用 processRawMediaPaths`);
        const { processRawMediaPaths } = await import('./services/media');
        finalText = await processRawMediaPaths(
          finalText,
          account.config as DingtalkConfig,
          oapiToken,
          log,
          target
        );
        log.info(`[DingTalk][closeStreaming] processRawMediaPaths 处理完成`);
      } else {
        log.warn(`[DingTalk][closeStreaming] oapiToken 为空，跳过媒体处理`);
      }

      log.info(`[DingTalk][closeStreaming] 准备调用 finishAICard，文本长度=${finalText.length}`);
      log.debug(`[DingTalk][closeStreaming] 最终发送内容长度=${finalText.length}`);
      await finishAICard(
        cardSnapshot,
        finalText,
        account.config as DingtalkConfig,
        log
      );
      await recordStableSupportCaseOutbound({
        cardInstanceId: cardSnapshot.cardInstanceId,
        deliverResultCarrierIds: cardSnapshot.deliverResultCarrierIds,
      });
      log.info(`[DingTalk][closeStreaming] ✅ AI Card 关闭成功`);
    } catch (error: any) {
      log.error(`[DingTalk][closeStreaming] ❌ AI Card 关闭失败：${error?.message || String(error)}`);
      // ✅ 媒体处理或关闭失败时，降级发送普通消息
      await sendFallbackErrorMessage('mediaProcess', error?.message || String(error));
      
      // 尝试用普通消息发送累积的文本
      if (accumulatedText.trim()) {
        try {
          log.info(`[DingTalk][closeStreaming] 降级发送普通消息`);
          const fallbackText = addSupportCaseMarkerForUnstableOutbound(accumulatedText);
          const result = await sendMessage(
            account.config as DingtalkConfig,
            sessionWebhook,
            fallbackText,
            {
              useMarkdown: true,
              log: params.runtime.log,
            }
          );
          await recordStableSupportCaseOutbound(result);
          log.info(`[DingTalk][closeStreaming] ✅ 降级发送成功`);
        } catch (sendErr: any) {
          log.error(`[DingTalk][closeStreaming] ❌ 降级发送失败：${sendErr.message}`);
        }
      }
    } finally {
      // currentCardTarget 已在函数开头清空，此处只需重置累积文本
      accumulatedText = "";
    }
  };

  const { dispatcher, replyOptions, markDispatchIdle } =
    core.channel.reply.createReplyDispatcherWithTyping({
      ...prefixOptions,
      humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, agentId),
      onReplyStart: () => {
        log.info(`[DingTalk][onReplyStart] 开始回复，流式 enabled=${streamingEnabled}`);
        // 每次 onReplyStart 都是全新的回复周期，清空去重集合
        deliveredFinalTexts.clear();
        if (streamingEnabled) {
          // fire-and-forget：提前创建 AI Card，onPartialReply 会等待创建完成
          void startStreaming();
        }
        typingCallbacks.onActive?.();
      },
      deliver: async (payload, info) => {
        let text = payload.text ?? "";
        
        log.info(`[DingTalk][deliver] 被调用：kind=${info?.kind}, textLength=${text.length}, hasText=${Boolean(text.trim())}`);
        log.debug(`[DingTalk][deliver] payload keys=${Object.keys(payload).join(',')}, info.kind=${info?.kind}`);
        
        // ✅ 在 final 响应时，先处理裸露的文件路径
        if (info?.kind === "final" && text.trim()) {
          const target: AICardTarget = isDirect
            ? { type: 'user', userId: senderId }
            : { type: 'group', openConversationId: conversationId };
          
          try {
            const oapiToken = await getOapiAccessToken(account.config as DingtalkConfig);
            if (oapiToken) {
              log.info(`[DingTalk][deliver] 检测到 final 响应，准备处理裸露文件路径`);
              const { processRawMediaPaths } = await import('./services/media');
              text = await processRawMediaPaths(
                text,
                account.config as DingtalkConfig,
                oapiToken,
                log,
                target
              );
              log.info(`[DingTalk][deliver] 裸露文件路径处理完成`);
            }
          } catch (err: any) {
            log.error(`[DingTalk][deliver] 处理裸露文件路径失败：${err.message}`);
          }
        }
        
        const hasText = Boolean(text.trim());
        const skipTextForDuplicateFinal =
          info?.kind === "final" && hasText && deliveredFinalTexts.has(text);
        
        // ✅ 如果是 final 响应且没有文本，使用默认提示文案
        if (info?.kind === "final" && !hasText) {
          text = '✅ 任务执行完成（无文本输出）';
          log.info(`[DingTalk][deliver] final 响应无文本，使用默认提示文案`);
        }
        
        const shouldDeliverText = Boolean(text.trim()) && !skipTextForDuplicateFinal;

        if (!shouldDeliverText) {
          log.info(`[DingTalk][deliver] 跳过发送：hasText=${hasText}, skipTextForDuplicateFinal=${skipTextForDuplicateFinal}`);
          return;
        }

        // 异步模式：只累积响应，不发送
        if (asyncMode) {
          log.info(`[DingTalk][deliver] 异步模式，累积响应`);
          asyncModeFullResponse = addSupportCaseMarkerForUnstableOutbound(text);
          return;
        }

        // block 消息：Agent 的中间 status update
        // 追加到同一张流式 AI Card 里（delta 模式），不单独创建新卡片
        // 如果流式 AI Card 未启用，直接丢弃 block（不发送）
        if (info?.kind === "block") {
          if (!streamingEnabled) {
            log.info(`[DingTalk][deliver] block 消息，流式未启用，丢弃`);
            return;
          }
          log.info(`[DingTalk][deliver] block 消息，追加到流式 AI Card，文本长度=${text.length}`);
          // 确保 AI Card 已创建（startStreaming 内部会复用已有的 cardCreationPromise）
          await startStreaming();
          // AI Card 已就绪，用 streamAICard 更新内容（仅展示当前 block 文本，不累积到 accumulatedText）
          // accumulatedText 专门给 onPartialReply 的流式更新使用，block 不能污染它
          if (currentCardTarget) {
            const now = Date.now();
            if (now - lastUpdateTime >= updateInterval) {
              // ✅ 乐观更新：防止并发回调在 await 期间通过节流检查
              lastUpdateTime = now;
              try {
                await streamAICard(
                  currentCardTarget,
                  text,
                  false,
                  account.config as DingtalkConfig,
                  log
                );
                log.info(`[DingTalk][deliver] ✅ block 更新到 AI Card 成功`);
              } catch (streamErr: any) {
                log.error(`[DingTalk][deliver] ❌ block 更新 AI Card 失败：${streamErr.message}`);
              }
            }
          } else {
            log.warn(`[DingTalk][deliver] block 消息：AI Card 创建失败，丢弃该 block`);
          }
          return;
        }

        // 流式模式的 final 处理
        if (info?.kind === "final" && streamingEnabled) {
          log.info(`[DingTalk][deliver] final 响应，流式模式`);
          // await startStreaming() 确保 AI Card 创建完成后再处理 final
          await startStreaming();

          if (currentCardTarget) {
            // 直接用 final 的 text 覆盖 accumulatedText，确保 closeStreaming 用最终内容关闭卡片
            // 不能追加，因为 final text 本身就是完整的最终回复
            accumulatedText = text;
            log.info(`[DingTalk][deliver] 调用 closeStreaming 完成 AI Card`);
            await closeStreaming();
            deliveredFinalTexts.add(text);
            return;
          } else {
            log.warn(`[DingTalk][deliver] ⚠️ AI Card 创建失败，降级到非流式发送`);
          }
        }

        // 流式模式但没有 card target：降级到非流式发送
        // 或者非流式模式：使用普通消息发送
        if (info?.kind === "final") {
          log.info(`[DingTalk][deliver] 降级到非流式发送，文本长度=${text.length}`);
          log.debug(`[DingTalk][deliver] 非流式发送，文本长度=${text.length}`);
          try {
            for (const rawChunk of core.channel.text.chunkTextWithMode(
              text,
              textChunkLimit,
              chunkMode
            )) {
              const chunk = addSupportCaseMarkerForUnstableOutbound(rawChunk);
              const result = await sendMessage(
                account.config as DingtalkConfig,
                sessionWebhook,
                chunk,
                {
                  useMarkdown: true,
                  log: params.runtime.log,
                }
              );
              await recordStableSupportCaseOutbound(result);
            }
            log.info(`[DingTalk][deliver] ✅ 非流式发送成功`);
            deliveredFinalTexts.add(text);
          } catch (error: any) {
            log.error(`[DingTalk][deliver] ❌ 非流式发送失败：${error.message}`);
            params.runtime.error?.(
              `dingtalk[${account.accountId}]: non-streaming delivery failed: ${String(error)}`
            );
            // ✅ 发送兜底错误消息
            await sendFallbackErrorMessage('sendMessage', error.message);
          }
          return;
        }
      },
      onError: async (error, info) => {
        log.error(`[DingTalk][onError] ${info.kind} reply failed: ${String(error)}`);
        params.runtime.error?.(
          `dingtalk[${account.accountId}] ${info.kind} reply failed: ${String(error)}`
        );
        await closeStreaming();
        typingCallbacks.onIdle?.();
      },
      onIdle: async () => {
        log.info(`[DingTalk][onIdle] 回复空闲，关闭 AI Card`);
        typingCallbacks.onIdle?.();
        await closeStreaming();
      },
      onCleanup: () => {
        log.info(`[DingTalk][onCleanup] 清理回调`);
        typingCallbacks.onCleanup?.();
      },
    });

  // 构建完整的 replyOptions：replyOptions 只包含 onReplyStart、onTypingController、onTypingCleanup
  // deliver、onError、onIdle、onCleanup 等回调已经在 createReplyDispatcherWithTyping 的参数中定义
  return {
    dispatcher,
    replyOptions: {
      ...replyOptions,  // ✅ 包含 onReplyStart、onTypingController、onTypingCleanup
      onModelSelected,
      ...(streamingEnabled && {
        onPartialReply: async (payload: ReplyPayload) => {
        log.info(`[DingTalk][onPartialReply] 被调用，payload.text=${payload.text ? payload.text.length : 'null'}`);
        log.debug(`[DingTalk][onPartialReply] textLength=${payload.text?.length ?? 0}`);
        if (!payload.text) {
          log.debug(`[DingTalk][onPartialReply] 空文本，跳过`);
          return;
        }
        
        log.debug(`[DingTalk][onPartialReply] 收到部分响应，文本长度=${payload.text.length}`);
        
        // 异步模式下禁用流式更新
        if (asyncMode) {
          log.debug(`[DingTalk][onPartialReply] 异步模式，累积响应`);
          asyncModeFullResponse = addSupportCaseMarkerForUnstableOutbound(payload.text);
          return;
        }
        
        // await startStreaming() 确保 AI Card 创建完成后再更新
        // startStreaming 内部会复用已有的 cardCreationPromise，不会重复创建
        await startStreaming();
        
        if (currentCardTarget) {
          accumulatedText = payload.text;
          
          const now = Date.now();
          if (now - lastUpdateTime >= updateInterval) {
            const { FILE_MARKER_PATTERN, VIDEO_MARKER_PATTERN, AUDIO_MARKER_PATTERN } = await import('./services/media/common.ts');
            const displayContent = accumulatedText
              .replace(FILE_MARKER_PATTERN, '')
              .replace(VIDEO_MARKER_PATTERN, '')
              .replace(AUDIO_MARKER_PATTERN, '')
              .trim();
            
            log.debug(`[DingTalk][onPartialReply] 更新 AI Card，显示文本长度=${displayContent.length}`);
            
            // ✅ 乐观更新：在发起 HTTP 请求前立即更新 lastUpdateTime，
            // 防止并发的 onPartialReply 回调在 await 期间通过节流检查，
            // 导致多个请求同时打到同一张卡片触发服务端 403 并发保护
            lastUpdateTime = now;
            try {
              await streamAICard(
                currentCardTarget,
                displayContent,
                false,
                account.config as DingtalkConfig,
                log
              );
              log.debug(`[DingTalk][onPartialReply] ✅ AI Card 更新成功`);
            } catch (err: any) {
              // QPS 限流已在 streamAICard 内部处理（自动退避+重试），
              // 到达此处说明重试也失败了，记录错误但不中断流式更新
              log.error(`[DingTalk][onPartialReply] ❌ AI Card 更新失败：${err.message}`);
              await sendFallbackErrorMessage('sendMessage', err.message);
            }
          } else {
            log.debug(`[DingTalk][onPartialReply] 节流控制，跳过本次更新（距离上次更新 ${now - lastUpdateTime}ms）`);
          }
        } else {
          log.warn(`[DingTalk][onPartialReply] ⚠️ AI Card 不存在，跳过更新`);
        }
      },
      }),
    },
    markDispatchIdle,
    getAsyncModeResponse: () => asyncModeFullResponse,
  };
}
