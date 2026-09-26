import {
  createReplyDispatcher,
  dispatchInboundMessage,
  type ReplyDispatcherOptions,
} from 'openclaw/plugin-sdk/reply-runtime';
import { createDingtalkBtwMessageSendingHook } from './btw-send-hook.ts';

export type DingtalkBtwDispatchParams = Pick<
  Parameters<typeof dispatchInboundMessage>[0],
  'ctx' | 'cfg' | 'replyOptions'
> & {
  dispatcherOptions: ReplyDispatcherOptions;
  dispatchReplyFromConfig: NonNullable<Parameters<typeof dispatchInboundMessage>[0]['dispatchReplyFromConfig']>;
};

/** 旁路回复使用独立队列，避免 buffered 入口的前台排序屏障等待主生成结束。 */
export function dispatchDingtalkBtw({ dispatcherOptions, dispatchReplyFromConfig, ...params }: DingtalkBtwDispatchParams) {
  const chatType = params.ctx.ChatType;
  const dispatcher = createReplyDispatcher({
    ...dispatcherOptions,
    silentReplyContext: dispatcherOptions.silentReplyContext ?? {
      cfg: params.cfg,
      sessionKey: params.ctx.SessionKey,
      surface: params.ctx.Surface ?? params.ctx.Provider,
      conversationType: chatType === 'direct' ? 'direct' : chatType === 'group' || chatType === 'channel' ? 'group' : undefined,
    },
  });
  return dispatchInboundMessage({
    ...params,
    dispatcher,
    dispatchReplyFromConfig: (context) => {
      // 此时 SDK 已安装 reply_payload_sending；legacy 策略必须在它之后执行。
      const messageSending = createDingtalkBtwMessageSendingHook(context.ctx);
      if (messageSending) context.dispatcher.appendBeforeDeliver?.(messageSending);
      // runtime 的低层入口允许主任务活动期间解析 /btw，普通 SDK 默认入口会等待主任务。
      return dispatchReplyFromConfig(context);
    },
  });
}
