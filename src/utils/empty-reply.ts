/**
 * 空回复（final 文本为空）兜底文案集中处。
 *
 * 背景
 * ----
 * 群聊场景下用户 @ 机器人后看到「任务执行完成（无文本输出）」，常见根因不是 connector，
 * 而是上游 OpenClaw 的 reply delivery mode（`source-reply-delivery-mode.ts`）：群聊
 * 默认走 `message_tool_only`，会跳过 `onPartialReply` 与 `accumulatedText`，
 * 导致本插件累积的文本始终为空，最后落到 connector 的空回复兜底。
 *
 * 修复路径在 OpenClaw 的 `openclaw.json`：
 *   {
 *     "messages": {
 *       "groupChat": { "visibleReplies": "automatic" }
 *     }
 *   }
 *
 * 本模块的优化目标：让群聊场景看到的兜底文案变成一句可操作的提示，
 * 并在日志里给运维一份完整指引，而不是一句无信息量的「任务执行完成」。
 * 单聊场景的兜底文案保持原样（单聊空 final 通常是模型自身输出空）。
 */

const DIRECT_FALLBACK_TEXT = '✅ 任务执行完成（无文本输出）';

const GROUP_FALLBACK_TEXT = [
  'ℹ️ 暂未收到模型回复内容。',
  '若群聊频繁出现该提示，请联系机器人管理员检查 OpenClaw 配置：',
  '`messages.groupChat.visibleReplies` 需设为 `"automatic"`',
  '（详见 README / TROUBLESHOOTING.md）。',
].join('\n');

const GROUP_FALLBACK_LOG_HINT =
  '群聊 final 文本为空：常见根因是 OpenClaw `messages.groupChat.visibleReplies` ' +
  '未设为 "automatic"（上游 source-reply-delivery-mode.ts 默认 message_tool_only， ' +
  '会跳过 partial/accumulated 文本）。' +
  '请在 openclaw.json 中追加：' +
  '{ "messages": { "groupChat": { "visibleReplies": "automatic" } } }，' +
  '然后 `openclaw gateway restart`。详见 docs/TROUBLESHOOTING.md。';

/**
 * 选取空回复的兜底文案。
 *
 * - 群聊：附带修复指引（指向 OpenClaw `messages.groupChat.visibleReplies` 配置）。
 * - 单聊：维持原文案，避免对模型本身就输出空的常规场景产生噪音。
 */
export function pickEmptyReplyFallbackText(isGroup: boolean): string {
  return isGroup ? GROUP_FALLBACK_TEXT : DIRECT_FALLBACK_TEXT;
}

/**
 * 群聊空回复时给运维的 warn 级别日志指引（含 openclaw.json 修复片段）。
 * 单聊不需要这条 hint，因为单聊空回复多半与配置无关。
 */
export function emptyGroupReplyLogHint(): string {
  return GROUP_FALLBACK_LOG_HINT;
}

/**
 * 群聊是否未显式将 OpenClaw `messages.groupChat.visibleReplies` 设为 `"automatic"`。
 *
 * `undefined` / 缺失 / `messages: {}` 均视为未开启（与上游默认 `message_tool_only` 行为一致），
 * 需要 connector 在「本轮无任何用户可见回复」时用 idle 兜底提示配置。
 */
export function groupChatLacksVisibleRepliesAutomatic(cfg: any): boolean {
  return cfg?.messages?.groupChat?.visibleReplies !== 'automatic';
}

export const __testables = {
  DIRECT_FALLBACK_TEXT,
  GROUP_FALLBACK_TEXT,
  GROUP_FALLBACK_LOG_HINT,
};
