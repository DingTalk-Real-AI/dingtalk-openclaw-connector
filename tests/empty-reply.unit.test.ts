/**
 * 空回复兜底文案
 *
 * 群聊空 final 常由 OpenClaw `messages.groupChat.visibleReplies` 未设为 "automatic"
 * 触发；本测试锁定兜底文案的分流契约：
 *   - 群聊：必须给出可操作的修复指引，至少包含 visibleReplies / automatic 关键字
 *   - 单聊：保持原文案 "✅ 任务执行完成（无文本输出）"
 *   - 日志 hint：要包含 openclaw.json 片段和 messages.groupChat 关键字
 */
import { describe, it, expect } from 'vitest';
import {
  pickEmptyReplyFallbackText,
  emptyGroupReplyLogHint,
  groupChatLacksVisibleRepliesAutomatic,
} from '../src/utils/empty-reply.ts';

describe('pickEmptyReplyFallbackText', () => {
  it('单聊保持原"任务执行完成（无文本输出）"文案', () => {
    const text = pickEmptyReplyFallbackText(false);
    expect(text).toBe('✅ 任务执行完成（无文本输出）');
  });

  it('群聊给出包含 visibleReplies / automatic 的修复指引', () => {
    const text = pickEmptyReplyFallbackText(true);
    expect(text).toContain('visibleReplies');
    expect(text).toContain('automatic');
    expect(text).not.toBe('✅ 任务执行完成（无文本输出）');
  });

  it('群聊文案不抛配置细节给终端用户，要建议联系管理员', () => {
    const text = pickEmptyReplyFallbackText(true);
    expect(text).toMatch(/管理员/);
  });
});

describe('groupChatLacksVisibleRepliesAutomatic', () => {
  it('cfg 缺失或 messages 为空视为未配置 automatic', () => {
    expect(groupChatLacksVisibleRepliesAutomatic(undefined)).toBe(true);
    expect(groupChatLacksVisibleRepliesAutomatic({})).toBe(true);
    expect(groupChatLacksVisibleRepliesAutomatic({ messages: {} })).toBe(true);
    expect(
      groupChatLacksVisibleRepliesAutomatic({ messages: { groupChat: {} } }),
    ).toBe(true);
  });

  it('仅当 visibleReplies 为 automatic 时视为已配置', () => {
    expect(
      groupChatLacksVisibleRepliesAutomatic({
        messages: { groupChat: { visibleReplies: 'automatic' } },
      }),
    ).toBe(false);
    expect(
      groupChatLacksVisibleRepliesAutomatic({
        messages: { groupChat: { visibleReplies: 'tool_only' } },
      }),
    ).toBe(true);
  });
});

describe('emptyGroupReplyLogHint', () => {
  it('日志指引包含 openclaw.json 片段', () => {
    const hint = emptyGroupReplyLogHint();
    expect(hint).toContain('messages');
    expect(hint).toContain('groupChat');
    expect(hint).toContain('visibleReplies');
    expect(hint).toContain('automatic');
  });

  it('指引点出根因（message_tool_only / source-reply-delivery-mode）', () => {
    const hint = emptyGroupReplyLogHint();
    expect(hint).toContain('message_tool_only');
  });
});
