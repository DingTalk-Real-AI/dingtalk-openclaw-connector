import { describe, expect, it } from 'vitest';
import { createRunLockStore } from '../../src/support-case-router/run-lock.ts';

describe('run lock store', () => {
  it('persists recoverable accepted tasks before enqueue', async () => {
    const store = createRunLockStore({
      staleAfterMs: 30_000,
      doneTtlMs: 60_000,
      writer: {
        append: async () => {},
      },
      now: () => 1_700_000_000_000,
    });

    const accepted = await store.accept({
      dedupeKey: 'acc:conv:msg-1',
      payload: {
        rawEvent: { msgId: 'msg-1', conversationId: 'cid-1' },
        caseId: 'case-1',
        sessionKey: 'agent:customer-support-safe:dingtalk-connector:group:support-case/cid-1/case-1',
        agentId: 'customer-support-safe',
        replyTarget: { openConversationId: 'cid-1' },
      },
    });

    expect(accepted.status).toBe('accepted');
    expect(accepted.payload.caseId).toBe('case-1');
    expect(accepted.payload.sessionKey).toContain('support-case/cid-1/case-1');
  });

  it('recovers stale running entries with original payload intact', async () => {
    const entries: any[] = [];
    const store = createRunLockStore({
      staleAfterMs: 1_000,
      doneTtlMs: 60_000,
      writer: {
        append: async (entry) => {
          entries.push(entry);
        },
      },
      now: () => 10_000,
    });

    await store.accept({
      dedupeKey: 'acc:conv:msg-2',
      payload: {
        rawEvent: { msgId: 'msg-2' },
        caseId: 'case-2',
        sessionKey: 'session-2',
        agentId: 'customer-support-safe',
        replyTarget: { openConversationId: 'cid-2' },
      },
    });
    await store.markRunning('acc:conv:msg-2');

    const recovered = await store.recoverStale({ now: 20_000 });

    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.payload.caseId).toBe('case-2');
    expect(recovered[0]?.payload.replyTarget).toEqual({ openConversationId: 'cid-2' });
  });
});
