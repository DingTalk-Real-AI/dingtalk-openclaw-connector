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

// ✅ 动态导入 channel-runtime 模块
const channelRuntimeModule = await import("openclaw/plugin-sdk/channel-runtime") as any;

const {
  createReplyPrefixOptions,
  createTypingCallbacks,
  logTypingFailure,
} = channelRuntimeModule;

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
  processFileMarkers,
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
  } = params;

  const account = resolveDingtalkAccount({ cfg, accountId });
  const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
    cfg,
    agentId,
    channel: "dingtalk-connector",
    accountId,
  });

  // ✅ 读取 debug 配置
  const debugMode = account.config?.debug || false;
  const log = {
    info: (msg: string) => {
      if (debugMode) {
        params.runtime.info?.(msg);
      }
    },
    error: (msg: string) => {
      if (debugMode) {
        params.runtime.error?.(msg);
      }
    },
    warn: (msg: string) => {
      if (debugMode) {
        params.runtime.warn?.(msg);
      }
    },
    debug: (msg: string) => {
      if (debugMode) {
        params.runtime.debug?.(msg);
      }
    },
  };

  // AI Card 状态管理
  let currentCardTarget: AICardTarget | null = null;
  let accumulatedText = "";
  const deliveredFinalTexts = new Set<string>();
  
  // 异步模式：累积完整响应
  let asyncModeFullResponse = "";
  
  // ✅ 节流控制：避免频繁调用钉钉 API 导致 QPS 限流
  let lastUpdateTime = 0;
  const updateInterval = 500; // 最小更新间隔 500ms（钉钉 QPS 限制：40 次/秒，保守起见设为 0.5 秒）

  // ✅ 错误兜底：防止重复发送错误消息
  const deliveredErrorTypes = new Set<string>();
  let lastErrorTime = 0;
  const ERROR_COOLDOWN = 60000; // 错误消息冷却时间 1 分钟

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
    
    const errorMessage = errorMessages[errorType];
    log.warn(`[DingTalk][Fallback] ${errorMessage}, error: ${originalError}`);
    
    try {
      await sendMessage(
        account.config as DingtalkConfig,
        sessionWebhook,
        errorMessage,
        {
          useMarkdown: false,
          log: params.runtime.log,
        }
      );
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
        channel: "dingtalk-connector",
        action: "start",
        error: err,
      }),
    onStopError: (err: any) =>
      logTypingFailure({
        log: (message: any) => params.runtime.log?.(message),
        channel: "dingtalk-connector",
        action: "stop",
        error: err,
      }),
  });

  const textChunkLimit = core.channel.text.resolveTextChunkLimit(
    cfg,
    "dingtalk-connector",
    accountId,
    { fallbackLimit: 4000 }
  );
  const chunkMode = core.channel.text.resolveChunkMode(cfg, "dingtalk-connector");

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
        currentCardTarget = preCreatedCard as any;
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
        currentCardTarget = card as any;
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
    if (!currentCardTarget) {
      log.info(`[DingTalk][closeStreaming] 无 AI Card，跳过关闭`);
      return;
    }

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
        finalText = await processFileMarkers(
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
      await finishAICard(
        currentCardTarget as any,
        finalText,
        account.config as DingtalkConfig,
        log
      );
      log.info(`[DingTalk][closeStreaming] ✅ AI Card 关闭成功`);
    } catch (error: any) {
      log.error(`[DingTalk][closeStreaming] ❌ AI Card 关闭失败：${error?.message || String(error)}`);
      // ✅ 媒体处理或关闭失败时，降级发送普通消息
      await sendFallbackErrorMessage('mediaProcess', error?.message || String(error));
      
      // 尝试用普通消息发送累积的文本
      if (accumulatedText.trim()) {
        try {
          log.info(`[DingTalk][closeStreaming] 降级发送普通消息`);
          await sendMessage(
            account.config as DingtalkConfig,
            sessionWebhook,
            accumulatedText,
            {
              useMarkdown: true,
              log: params.runtime.log,
            }
          );
          log.info(`[DingTalk][closeStreaming] ✅ 降级发送成功`);
        } catch (sendErr: any) {
          log.error(`[DingTalk][closeStreaming] ❌ 降级发送失败：${sendErr.message}`);
        }
      }
    } finally {
      currentCardTarget = null;
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
          asyncModeFullResponse = text;
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
              try {
                await streamAICard(
                  currentCardTarget as any,
                  text,
                  false,
                  account.config as DingtalkConfig,
                  log
                );
                lastUpdateTime = now;
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
          try {
            for (const chunk of core.channel.text.chunkTextWithMode(
              text,
              textChunkLimit,
              chunkMode
            )) {
              await sendMessage(
                account.config as DingtalkConfig,
                sessionWebhook,
                chunk,
                {
                  useMarkdown: true,
                  log: params.runtime.log,
                }
              );
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
        if (!payload.text) {
          log.debug(`[DingTalk][onPartialReply] 空文本，跳过`);
          return;
        }
        
        log.debug(`[DingTalk][onPartialReply] 收到部分响应，文本长度=${payload.text.length}`);
        
        // 异步模式下禁用流式更新
        if (asyncMode) {
          log.debug(`[DingTalk][onPartialReply] 异步模式，累积响应`);
          asyncModeFullResponse = payload.text;
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
            
            try {
              await streamAICard(
                currentCardTarget as any,
                displayContent,
                false,
                account.config as DingtalkConfig,
                log
              );
              lastUpdateTime = now;
              log.debug(`[DingTalk][onPartialReply] ✅ AI Card 更新成功`);
            } catch (err: any) {
              // 安全检查：确保 code 存在且为字符串
              const errorCode = err.response?.data?.code;
              if (err.response?.status === 403 && typeof errorCode === 'string' && errorCode.includes('QpsLimit')) {
                // QPS 限流，跳过本次更新
                log.warn(`[DingTalk][AICard] QPS 限流，跳过本次更新`);
              } else {
                log.error(`[DingTalk][onPartialReply] ❌ AI Card 更新失败：${err.message}`);
                // ✅ 发送兜底错误消息，但不抛出异常，避免中断后续处理
                await sendFallbackErrorMessage('sendMessage', err.message);
              }
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