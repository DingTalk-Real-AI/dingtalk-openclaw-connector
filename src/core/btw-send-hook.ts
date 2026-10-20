import {
  deriveInboundMessageHookContext,
  toPluginMessageContext,
} from 'openclaw/plugin-sdk/hook-runtime';
import { getGlobalHookRunner } from 'openclaw/plugin-sdk/plugin-runtime';
import {
  finalizeInboundContext,
  type MsgContext,
  type ReplyDispatcherOptions,
} from 'openclaw/plugin-sdk/reply-runtime';

/** 为旁路 dispatcher 保留 buffered 入口的 message_sending 取消与改写策略。 */
export function createDingtalkBtwMessageSendingHook(
  ctx: MsgContext,
): ReplyDispatcherOptions['beforeDeliver'] {
  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks('message_sending')) return undefined;

  const finalized = finalizeInboundContext(ctx);
  const hookContext = deriveInboundMessageHookContext(finalized);
  const replyTarget = typeof finalized.OriginatingTo === 'string' && finalized.OriginatingTo.trim()
    ? finalized.OriginatingTo
    : hookContext.isGroup
      ? hookContext.conversationId ?? hookContext.to ?? hookContext.from
      : hookContext.from || hookContext.conversationId || hookContext.to || '';

  return async (payload) => {
    if (!payload.text) return payload;
    // 超时及错误策略由宿主 hook runner 处理，保持取消结果，不在插件内吞异常。
    const result = await hookRunner.runMessageSending(
      { content: payload.text, to: replyTarget },
      toPluginMessageContext(hookContext),
    );
    if (result?.cancel) return null;
    // appendBeforeDeliver 会继承原 payload 的宿主 metadata，无需使用私有 SDK 导出。
    return result?.content == null ? payload : { ...payload, text: result.content };
  };
}
