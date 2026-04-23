import { describe, expect, it } from 'vitest';
import { createSupportCaseRouter } from '../../src/support-case-router/router.ts';

describe('support case router', () => {
  const baseConfig = {
    enabled: true,
    allowedGroups: ['cid-1'],
    safeAgentId: 'customer-support-safe',
    requireMentionForNewRoot: true,
    toolPolicy: {
      mode: 'allowlist' as const,
      allow: ['message.send'],
    },
  };

  it('requires mention for a new root case', async () => {
    const router = createSupportCaseRouter({
      config: baseConfig,
      replyMap: {
        findByMessageId: async () => null,
      },
    });

    const result = await router.resolve({
      accountId: 'default',
      conversationId: 'cid-1',
      messageId: 'msg-1',
      senderId: 'user-1',
      isGroup: true,
      isMentioned: false,
    });

    expect(result.shouldRun).toBe(false);
    expect(result.reason).toBe('not_mentioned_for_new_root');
  });

  it('allows existing case reply without mention when reply_map hits', async () => {
    const router = createSupportCaseRouter({
      config: baseConfig,
      replyMap: {
        findByMessageId: async (messageId: string) =>
          messageId === 'root-msg'
            ? {
                caseId: 'case-1',
                rootMessageId: 'root-msg',
                publicCaseRef: '#Q-8K2A',
              }
            : null,
      },
    });

    const result = await router.resolve({
      accountId: 'default',
      conversationId: 'cid-1',
      messageId: 'msg-2',
      senderId: 'user-1',
      isGroup: true,
      isMentioned: false,
      repliedMessageId: 'root-msg',
    });

    expect(result.shouldRun).toBe(true);
    expect(result.caseId).toBe('case-1');
    expect(result.matchedBy).toBe('reply_map');
    expect(result.isNewCase).toBe(false);
  });

  it('fails closed when group is not allowlisted', async () => {
    const router = createSupportCaseRouter({
      config: baseConfig,
      replyMap: {
        findByMessageId: async () => null,
      },
    });

    const result = await router.resolve({
      accountId: 'default',
      conversationId: 'cid-2',
      messageId: 'msg-3',
      senderId: 'user-2',
      isGroup: true,
      isMentioned: true,
    });

    expect(result.shouldRun).toBe(false);
    expect(result.reason).toBe('not_allowlisted_group');
  });
});
