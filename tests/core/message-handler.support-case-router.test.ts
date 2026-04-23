import { mkdtemp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/runtime.ts', () => ({
  getDingtalkRuntime: vi.fn(),
  setDingtalkRuntime: vi.fn(),
}));

vi.mock('../../src/reply-dispatcher.ts', () => ({
  createDingtalkReplyDispatcher: vi.fn(),
}));

let buildSupportCaseQueueIdentity: any;
let extractMessageContent: any;
let resolveSupportCaseRouteForMessage: any;
let shouldAttemptSupportCaseRouterForMessage: any;

beforeAll(async () => {
  const messageHandler = await import('../../src/core/message-handler.ts');
  buildSupportCaseQueueIdentity = messageHandler.buildSupportCaseQueueIdentity;
  extractMessageContent = messageHandler.extractMessageContent;
  resolveSupportCaseRouteForMessage = messageHandler.resolveSupportCaseRouteForMessage;
  shouldAttemptSupportCaseRouterForMessage = messageHandler.shouldAttemptSupportCaseRouterForMessage;
});

function supportCaseConfig(replyMapStorePath: string) {
  return {
    clientId: 'bot-code',
    supportCaseRouter: {
      enabled: true,
      allowedGroups: ['cid-1'],
      safeAgentId: 'safe-agent',
      requireMentionForNewRoot: true,
      replyMapStorePath,
      toolPolicy: {
        mode: 'allowlist',
        allow: ['message.send'],
      },
    },
  } as any;
}

async function tempJsonlPath(name: string) {
  const dir = await mkdtemp(path.join(tmpdir(), 'dingtalk-message-handler-'));
  return path.join(dir, name);
}

function supportCaseId(accountId: string, conversationId: string, messageId: string) {
  return `case-${createHash('sha256')
    .update(`${accountId}:${conversationId}:${messageId}`)
    .digest('hex')
    .slice(0, 16)}`;
}

describe('message-handler support case router wiring', () => {
  it('leaves disabled supportCaseRouter on the old queue identity path', async () => {
    const result = await resolveSupportCaseRouteForMessage({
      accountId: 'secret-account',
      config: {
        clientId: 'bot-code',
        supportCaseRouter: { enabled: false },
      } as any,
      data: {
        conversationType: '2',
        conversationId: 'cid-1',
        msgId: 'msg-1',
        msgtype: 'text',
        text: { content: '@bot secret text', at: { atDingtalkIds: ['bot-code'] } },
      },
      content: {
        text: '@bot secret text',
        messageType: 'text',
        imageUrls: [],
        downloadCodes: [],
        fileNames: [],
        atDingtalkIds: ['bot-code'],
        atMobiles: [],
      },
      log: { info: () => undefined },
    });

    expect(result).toEqual({ enabled: false });
    expect(buildSupportCaseQueueIdentity({
      supportCaseRoute: result,
      accountId: 'secret-account',
      conversationId: 'cid-1',
      baseSessionId: 'cid-1',
      matchedAgentId: 'main',
    })).toEqual({
      finalSessionKey: 'cid-1',
      queueKey: 'cid-1:main',
    });
  });

  it('dry-run logging omits user text, group name, phone, and account', async () => {
    const replyMapStorePath = await tempJsonlPath('reply-map.jsonl');
    const logs: string[] = [];
    const data = {
      conversationType: '2',
      conversationId: 'cid-1',
      conversationTitle: 'VIP Customer Group',
      msgId: 'msg-1',
      msgtype: 'text',
      robotCode: 'bot-code',
      senderStaffId: 'user-phone-13800138000',
      text: {
        content: '@bot user text includes account ACME and phone 13800138000',
        at: { atDingtalkIds: ['bot-code'] },
      },
    };

    const route = await resolveSupportCaseRouteForMessage({
      accountId: 'secret-account',
      config: supportCaseConfig(replyMapStorePath),
      data,
      content: extractMessageContent(data),
      log: { info: (message: string) => logs.push(message) },
    });

    expect(route.enabled && route.shouldRun).toBe(true);
    const joinedLogs = logs.join('\n');
    expect(joinedLogs).not.toContain('user text');
    expect(joinedLogs).not.toContain('VIP Customer Group');
    expect(joinedLogs).not.toContain('13800138000');
    expect(joinedLogs).not.toContain('secret-account');
    expect(joinedLogs).not.toContain('ACME');
  });

  it('allows reply_map and marker hits for existing cases without mention', async () => {
    const replyMapStorePath = await tempJsonlPath('reply-map.jsonl');
    await writeFile(replyMapStorePath, `${JSON.stringify({
      accountId: 'acc-1',
      conversationId: 'cid-1',
      messageId: 'root-msg',
      caseId: 'case-existing',
      rootMessageId: 'root-msg',
      direction: 'inbound_user',
      source: 'root',
      createdAt: 1_700_000_000_000,
      publicCaseRef: '#Q-8K2A',
    })}\n`, 'utf8');

    const replyData = {
      conversationType: '2',
      conversationId: 'cid-1',
      msgId: 'msg-reply',
      msgtype: 'text',
      text: {
        content: 'follow up without mention',
        isReplyMsg: true,
        repliedMsg: {
          msgId: 'root-msg',
          msgType: 'text',
          content: { text: 'previous case message' },
        },
      },
    };
    const replyRoute = await resolveSupportCaseRouteForMessage({
      accountId: 'acc-1',
      config: supportCaseConfig(replyMapStorePath),
      data: replyData,
      content: extractMessageContent(replyData),
    });

    expect(replyRoute.enabled && replyRoute.shouldRun).toBe(true);
    expect(replyRoute.matchedBy).toBe('reply_map');

    const markerData = {
      conversationType: '2',
      conversationId: 'cid-1',
      msgId: 'msg-marker',
      msgtype: 'text',
      text: { content: 'follow up for #q-8k2a without mention' },
    };
    const markerRoute = await resolveSupportCaseRouteForMessage({
      accountId: 'acc-1',
      config: supportCaseConfig(replyMapStorePath),
      data: markerData,
      content: extractMessageContent(markerData),
    });

    expect(markerRoute.enabled && markerRoute.shouldRun).toBe(true);
    expect(markerRoute.matchedBy).toBe('marker');
  });

  it('aligns queue key with final support-case session key plus agent id', () => {
    const route = {
      enabled: true,
      shouldRun: true,
      agentId: 'safe-agent',
      caseId: 'case-123',
      rootMessageId: 'root-msg',
      matchedBy: 'new_root',
      isNewCase: true,
    };

    const identity = buildSupportCaseQueueIdentity({
      supportCaseRoute: route,
      accountId: 'acc-1',
      conversationId: 'cid-1',
      baseSessionId: 'cid-1',
      matchedAgentId: 'safe-agent',
    });

    expect(identity.finalSessionKey).toContain('support-case/cid-1/case-123');
    expect(identity.queueKey).toBe(`${identity.finalSessionKey}:safe-agent`);
  });

  it('keeps A/B/X isolated and routes replies back to the original case', async () => {
    const replyMapStorePath = await tempJsonlPath('reply-map.jsonl');
    const accountId = 'acc-1';
    const conversationId = 'cid-1';
    const caseAId = supportCaseId(accountId, conversationId, 'msg-a');
    const caseA2Id = supportCaseId(accountId, conversationId, 'msg-a2');
    const caseBId = supportCaseId(accountId, conversationId, 'msg-b');

    await writeFile(replyMapStorePath, [
      JSON.stringify({
        accountId,
        conversationId,
        messageId: 'msg-a',
        caseId: caseAId,
        rootMessageId: 'msg-a',
        direction: 'inbound_user',
        source: 'root',
        createdAt: 1_700_000_000_000,
        publicCaseRef: '#Q-A001',
      }),
      JSON.stringify({
        accountId,
        conversationId,
        messageId: 'msg-a2',
        caseId: caseA2Id,
        rootMessageId: 'msg-a2',
        direction: 'inbound_user',
        source: 'root',
        createdAt: 1_700_000_000_001,
        publicCaseRef: '#Q-A002',
      }),
      JSON.stringify({
        accountId,
        conversationId,
        messageId: 'msg-b',
        caseId: caseBId,
        rootMessageId: 'msg-b',
        direction: 'inbound_user',
        source: 'root',
        createdAt: 1_700_000_000_002,
        publicCaseRef: '#Q-B001',
      }),
      JSON.stringify({
        accountId,
        conversationId,
        messageId: 'bot-answer-a',
        caseId: caseAId,
        rootMessageId: 'msg-a',
        direction: 'outbound_bot',
        source: 'reply',
        createdAt: 1_700_000_000_003,
        publicCaseRef: '#Q-A001',
      }),
    ].join('\n') + '\n', 'utf8');

    const config = supportCaseConfig(replyMapStorePath);

    const rootAData = {
      conversationType: '2',
      conversationId,
      msgId: 'msg-a',
      msgtype: 'text',
      robotCode: 'bot-code',
      senderStaffId: 'user-a',
      text: {
        content: '@bot question A',
        at: { atDingtalkIds: ['bot-code'] },
      },
    };
    const rootA2Data = {
      conversationType: '2',
      conversationId,
      msgId: 'msg-a2',
      msgtype: 'text',
      robotCode: 'bot-code',
      senderStaffId: 'user-a',
      text: {
        content: '@bot second top-level question',
        at: { atDingtalkIds: ['bot-code'] },
      },
    };
    const rootBData = {
      conversationType: '2',
      conversationId,
      msgId: 'msg-b',
      msgtype: 'text',
      robotCode: 'bot-code',
      senderStaffId: 'user-b',
      text: {
        content: '@bot question B',
        at: { atDingtalkIds: ['bot-code'] },
      },
    };
    const unrelatedData = {
      conversationType: '2',
      conversationId,
      msgId: 'msg-x',
      msgtype: 'text',
      robotCode: 'bot-code',
      senderStaffId: 'user-x',
      text: { content: 'unrelated group chatter without mention' },
    };
    const replyToRootAData = {
      conversationType: '2',
      conversationId,
      msgId: 'msg-a-reply-1',
      msgtype: 'text',
      robotCode: 'bot-code',
      senderStaffId: 'user-a',
      text: {
        content: 'replying to the original question',
        isReplyMsg: true,
        repliedMsg: {
          msgId: 'msg-a',
          msgType: 'text',
          content: { text: 'question A' },
        },
      },
    };
    const replyToBotAData = {
      conversationType: '2',
      conversationId,
      msgId: 'msg-a-reply-2',
      msgtype: 'text',
      robotCode: 'bot-code',
      senderStaffId: 'user-a',
      text: {
        content: 'replying to the bot answer',
        isReplyMsg: true,
        repliedMsg: {
          msgId: 'bot-answer-a',
          msgType: 'text',
          content: { text: 'bot answer A' },
        },
      },
    };

    const [routeA, routeA2, routeB, routeX, replyToRootA, replyToBotA] = await Promise.all([
      resolveSupportCaseRouteForMessage({
        accountId,
        config,
        data: rootAData,
        content: extractMessageContent(rootAData),
      }),
      resolveSupportCaseRouteForMessage({
        accountId,
        config,
        data: rootA2Data,
        content: extractMessageContent(rootA2Data),
      }),
      resolveSupportCaseRouteForMessage({
        accountId,
        config,
        data: rootBData,
        content: extractMessageContent(rootBData),
      }),
      resolveSupportCaseRouteForMessage({
        accountId,
        config,
        data: unrelatedData,
        content: extractMessageContent(unrelatedData),
      }),
      resolveSupportCaseRouteForMessage({
        accountId,
        config,
        data: replyToRootAData,
        content: extractMessageContent(replyToRootAData),
      }),
      resolveSupportCaseRouteForMessage({
        accountId,
        config,
        data: replyToBotAData,
        content: extractMessageContent(replyToBotAData),
      }),
    ]);

    const identityA = buildSupportCaseQueueIdentity({
      supportCaseRoute: routeA,
      accountId,
      conversationId,
      baseSessionId: conversationId,
      matchedAgentId: 'safe-agent',
    });
    const identityA2 = buildSupportCaseQueueIdentity({
      supportCaseRoute: routeA2,
      accountId,
      conversationId,
      baseSessionId: conversationId,
      matchedAgentId: 'safe-agent',
    });
    const identityB = buildSupportCaseQueueIdentity({
      supportCaseRoute: routeB,
      accountId,
      conversationId,
      baseSessionId: conversationId,
      matchedAgentId: 'safe-agent',
    });
    const identityReplyRootA = buildSupportCaseQueueIdentity({
      supportCaseRoute: replyToRootA,
      accountId,
      conversationId,
      baseSessionId: conversationId,
      matchedAgentId: 'safe-agent',
    });
    const identityReplyBotA = buildSupportCaseQueueIdentity({
      supportCaseRoute: replyToBotA,
      accountId,
      conversationId,
      baseSessionId: conversationId,
      matchedAgentId: 'safe-agent',
    });

    expect(routeA.enabled && routeA.shouldRun).toBe(true);
    expect(routeA2.enabled && routeA2.shouldRun).toBe(true);
    expect(routeB.enabled && routeB.shouldRun).toBe(true);
    expect(routeX).toEqual({
      enabled: true,
      shouldRun: false,
      reason: 'not_mentioned_for_new_root',
    });
    expect(routeA.caseId).toBe(caseAId);
    expect(routeA2.caseId).toBe(caseA2Id);
    expect(routeB.caseId).toBe(caseBId);
    expect(routeA.caseId).not.toBe(routeA2.caseId);
    expect(routeA.caseId).not.toBe(routeB.caseId);
    expect(routeA2.caseId).not.toBe(routeB.caseId);

    expect(replyToRootA.enabled && replyToRootA.shouldRun).toBe(true);
    expect(replyToRootA.matchedBy).toBe('reply_map');
    expect(replyToRootA.caseId).toBe(caseAId);
    expect(replyToBotA.enabled && replyToBotA.shouldRun).toBe(true);
    expect(replyToBotA.matchedBy).toBe('reply_map');
    expect(replyToBotA.caseId).toBe(caseAId);

    expect(identityA.finalSessionKey).toContain(`support-case/${conversationId}/${caseAId}`);
    expect(identityA2.finalSessionKey).toContain(`support-case/${conversationId}/${caseA2Id}`);
    expect(identityB.finalSessionKey).toContain(`support-case/${conversationId}/${caseBId}`);
    expect(identityA.finalSessionKey).not.toBe(identityA2.finalSessionKey);
    expect(identityA.finalSessionKey).not.toBe(identityB.finalSessionKey);
    expect(identityA.queueKey).toBe(`${identityA.finalSessionKey}:safe-agent`);
    expect(identityA2.queueKey).toBe(`${identityA2.finalSessionKey}:safe-agent`);
    expect(identityB.queueKey).toBe(`${identityB.finalSessionKey}:safe-agent`);
    expect(identityReplyRootA.finalSessionKey).toBe(identityA.finalSessionKey);
    expect(identityReplyBotA.finalSessionKey).toBe(identityA.finalSessionKey);
  });

  it('only attempts support routing after existing group admission and support allowedGroups pass', () => {
    const config = {
      supportCaseRouter: {
        enabled: true,
        allowedGroups: ['cid-support'],
        safeAgentId: 'safe-agent',
      },
      groupPolicy: 'allowlist',
      groupAllowFrom: ['cid-support'],
    };

    expect(shouldAttemptSupportCaseRouterForMessage({
      config,
      data: { conversationType: '2', conversationId: 'cid-support' },
    })).toBe(true);
    expect(shouldAttemptSupportCaseRouterForMessage({
      config,
      data: { conversationType: '2', conversationId: 'cid-other' },
    })).toBe(false);
    expect(shouldAttemptSupportCaseRouterForMessage({
      config: { ...config, groupAllowFrom: ['cid-other'] },
      data: { conversationType: '2', conversationId: 'cid-support' },
    })).toBe(false);
    expect(shouldAttemptSupportCaseRouterForMessage({
      config,
      data: { conversationType: '1', conversationId: 'cid-support' },
    })).toBe(false);
  });
});
