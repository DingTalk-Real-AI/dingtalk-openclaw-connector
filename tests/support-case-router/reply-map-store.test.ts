import { describe, expect, it } from 'vitest';
import { createReplyMapStore } from '../../src/support-case-router/reply-map-store.ts';

describe('reply map store', () => {
  it('records inbound and outbound audit trail for a case', async () => {
    const records: any[] = [];
    const store = createReplyMapStore({
      writer: {
        append: async (entry) => {
          records.push(entry);
        },
      },
      now: () => 1_700_000_000_000,
    });

    await store.recordInbound({
      accountId: 'acc-1',
      conversationId: 'cid-1',
      messageId: 'msg-root',
      caseId: 'case-1',
      rootMessageId: 'msg-root',
      senderId: 'user-a',
      publicCaseRef: '#Q-8K2A',
      source: 'root',
    });

    await store.recordInbound({
      accountId: 'acc-1',
      conversationId: 'cid-1',
      messageId: 'msg-follow-up',
      caseId: 'case-1',
      rootMessageId: 'msg-root',
      senderId: 'user-a',
      publicCaseRef: '#Q-8K2A',
      source: 'reply',
    });

    await store.recordOutbound({
      accountId: 'acc-1',
      conversationId: 'cid-1',
      messageId: 'bot-msg-1',
      caseId: 'case-1',
      rootMessageId: 'msg-root',
      publicCaseRef: '#Q-8K2A',
      source: 'outbound_ack',
    });

    expect(records).toHaveLength(3);
    expect(await store.findByMessageId('msg-root')).toMatchObject({
      caseId: 'case-1',
      rootMessageId: 'msg-root',
      direction: 'inbound_user',
    });
    expect(await store.findByMessageId('bot-msg-1')).toMatchObject({
      caseId: 'case-1',
      rootMessageId: 'msg-root',
      publicCaseRef: '#Q-8K2A',
      direction: 'outbound_bot',
    });
    expect(await store.findByPublicCaseRef('#q-8k2a')).toMatchObject({
      caseId: 'case-1',
      rootMessageId: 'msg-root',
      publicCaseRef: '#Q-8K2A',
    });
  });

  it('rebuilds index while skipping corrupted jsonl rows', async () => {
    const store = createReplyMapStore({
      writer: {
        append: async () => {},
      },
      now: () => 1_700_000_000_000,
    });

    await store.rebuildFromLines([
      '{"accountId":"acc-1","conversationId":"cid-1","messageId":"msg-1","caseId":"case-1","rootMessageId":"msg-1","direction":"inbound_user","source":"root","createdAt":1700000000000}',
      '{not-json}',
      '{"accountId":"acc-1","conversationId":"cid-1","messageId":"bot-msg-1","caseId":"case-1","rootMessageId":"msg-1","direction":"outbound_bot","source":"outbound_ack","createdAt":1700000001000}',
    ]);

    expect(await store.findByMessageId('msg-1')).toMatchObject({ caseId: 'case-1' });
    expect(await store.findByMessageId('bot-msg-1')).toMatchObject({ direction: 'outbound_bot' });
    expect(store.getCorruptedLineCount()).toBe(1);
  });
});
