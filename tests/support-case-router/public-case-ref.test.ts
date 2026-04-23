import { describe, expect, it, vi } from 'vitest';
import { createSupportCaseRouter } from '../../src/support-case-router/router.ts';

vi.mock('openclaw/plugin-sdk/channel-runtime', () => ({
  createReplyPrefixOptions: () => ({}),
  createTypingCallbacks: () => ({}),
  logTypingFailure: vi.fn(),
}));

vi.mock('../../src/channel.ts', () => ({
  CHANNEL_ID: 'dingtalk-connector',
}));

vi.mock('../../src/config/accounts.ts', () => ({
  resolveDingtalkAccount: vi.fn(),
}));

vi.mock('../../src/runtime.ts', () => ({
  getDingtalkRuntime: vi.fn(),
}));

vi.mock('../../src/utils/logger.ts', () => ({
  createLoggerFromConfig: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

vi.mock('../../src/services/messaging/card.ts', () => ({
  createAICardForTarget: vi.fn(),
  finishAICard: vi.fn(),
  streamAICard: vi.fn(),
}));

vi.mock('../../src/services/messaging.ts', () => ({
  sendMessage: vi.fn(),
}));

vi.mock('../../src/utils/token.ts', () => ({
  getOapiAccessToken: vi.fn(),
}));

vi.mock('../../src/services/media/index.ts', () => ({
  processAudioMarkers: vi.fn(),
  processLocalImages: vi.fn(),
  processVideoMarkers: vi.fn(),
  uploadAndReplaceFileMarkers: vi.fn(),
}));

const {
  appendPublicCaseRefMarker,
  buildSupportCaseOutboundIdDiagnostics,
  collectSupportCaseOutboundIdCandidates,
  extractStableDingtalkOutboundMessageId,
} = await import('../../src/reply-dispatcher.ts');

describe('public case ref outbound handling', () => {
  it('appends only the public case ref marker for unstable outbound text', () => {
    const marked = appendPublicCaseRefMarker('Thanks, we are checking this.', '#q-8k2a');

    expect(marked).toBe('Thanks, we are checking this.\n\n#Q-8K2A');
    expect(marked).not.toContain('case-');
  });

  it('does not expose internal case ids as visible markers', () => {
    expect(appendPublicCaseRefMarker('Reply body', 'case-internal-123')).toBe('Reply body');
  });

  it('treats AI Card ids as stable and webhook process keys as unstable', () => {
    expect(extractStableDingtalkOutboundMessageId({ cardInstanceId: 'card_123' })).toBe('card_123');
    expect(extractStableDingtalkOutboundMessageId({ data: { outTrackId: 'card_456' } })).toBe('card_456');
    expect(extractStableDingtalkOutboundMessageId({ deliverResultCarrierIds: ['msg_789'] })).toBeUndefined();

    expect(extractStableDingtalkOutboundMessageId({ processQueryKey: 'pq_123' })).toBeUndefined();
    expect(extractStableDingtalkOutboundMessageId({ data: { processQueryKey: 'pq_456' } })).toBeUndefined();
    expect(extractStableDingtalkOutboundMessageId({ messageId: 'webhook-msg-1' })).toBeUndefined();
    expect(extractStableDingtalkOutboundMessageId({})).toBeUndefined();
  });

  it('collects outbound id diagnostics without exposing message bodies', () => {
    const candidate = {
      processQueryKey: 'pq_123',
      cardInstanceId: 'card_123',
      deliverResultCarrierIds: ['msg_555'],
      data: {
        outTrackId: 'card_456',
        msgId: 'msg_789',
      },
      text: 'reply body should never be logged by diagnostics',
    };

    expect(collectSupportCaseOutboundIdCandidates(candidate)).toEqual([
      { path: 'cardInstanceId', value: 'card_123' },
      { path: 'processQueryKey', value: 'pq_123' },
      { path: 'data.outTrackId', value: 'card_456' },
      { path: 'data.msgId', value: 'msg_789' },
      { path: 'deliverResultCarrierIds[0]', value: 'msg_555' },
    ]);

    expect(buildSupportCaseOutboundIdDiagnostics(candidate)).toEqual({
      rawOutboundIdFields: {
        cardInstanceId: 'card_123',
        outTrackId: '',
        processQueryKey: 'pq_123',
        messageId: '',
        msgId: '',
        'data.cardInstanceId': '',
        'data.outTrackId': 'card_456',
        'data.processQueryKey': '',
        'data.messageId': '',
        'data.msgId': 'msg_789',
        deliverResultCarrierIds: ['msg_555'],
        'data.deliverResultCarrierIds': [],
      },
      outboundIdCandidates: [
        { path: 'cardInstanceId', value: 'card_123' },
        { path: 'processQueryKey', value: 'pq_123' },
        { path: 'data.outTrackId', value: 'card_456' },
        { path: 'data.msgId', value: 'msg_789' },
        { path: 'deliverResultCarrierIds[0]', value: 'msg_555' },
      ],
      keyShapes: {
        topLevel: ['cardInstanceId', 'data', 'deliverResultCarrierIds', 'processQueryKey', 'text'],
        data: ['msgId', 'outTrackId'],
      },
    });
  });
});

describe('public case ref routing fallback', () => {
  const config = {
    enabled: true,
    allowedGroups: ['cid-1'],
    safeAgentId: 'customer-support-safe',
    requireMentionForNewRoot: true,
    caseMarkerMode: 'short-ref' as const,
  };

  it('prefers reply_map over marker when both are present', async () => {
    const findByPublicCaseRef = vi.fn(async () => ({
      caseId: 'case-marker',
      rootMessageId: 'root-marker',
      publicCaseRef: '#Q-MARK',
    }));

    const router = createSupportCaseRouter({
      config,
      replyMap: {
        findByMessageId: async () => ({
          caseId: 'case-map',
          rootMessageId: 'root-map',
          publicCaseRef: '#Q-MAP1',
        }),
        findByPublicCaseRef,
      },
    });

    const result = await router.resolve({
      accountId: 'default',
      conversationId: 'cid-1',
      messageId: 'msg-2',
      senderId: 'user-1',
      isGroup: true,
      isMentioned: false,
      repliedMessageId: 'bot-msg-1',
      markerRef: '#Q-MARK',
    });

    expect(result).toMatchObject({
      shouldRun: true,
      caseId: 'case-map',
      rootMessageId: 'root-map',
      matchedBy: 'reply_map',
      isNewCase: false,
    });
    expect(findByPublicCaseRef).not.toHaveBeenCalled();
  });

  it('falls back to marker lookup when reply_map misses', async () => {
    const router = createSupportCaseRouter({
      config,
      replyMap: {
        findByMessageId: async () => null,
        findByPublicCaseRef: async () => ({
          caseId: 'case-marker',
          rootMessageId: 'root-marker',
          publicCaseRef: '#Q-MARK',
        }),
      },
    });

    const result = await router.resolve({
      accountId: 'default',
      conversationId: 'cid-1',
      messageId: 'msg-2',
      senderId: 'user-1',
      isGroup: true,
      isMentioned: false,
      repliedMessageId: 'unknown-bot-msg',
      markerRef: '#Q-MARK',
    });

    expect(result).toMatchObject({
      shouldRun: true,
      caseId: 'case-marker',
      rootMessageId: 'root-marker',
      matchedBy: 'marker',
      isNewCase: false,
    });
  });
});
