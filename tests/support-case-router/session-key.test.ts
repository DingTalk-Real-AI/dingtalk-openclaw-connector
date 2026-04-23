import { describe, expect, it } from 'vitest';
import { buildSupportCaseSessionPeerId, buildSupportCaseSessionKey } from '../../src/support-case-router/session-key.ts';

describe('support case session key', () => {
  it('builds final session peer id using conversationId and caseId', () => {
    expect(buildSupportCaseSessionPeerId({
      conversationId: 'cid-1',
      caseId: 'case-1',
    })).toBe('support-case/cid-1/case-1');
  });

  it('builds different session keys for different case ids in same group', () => {
    const sessionKeyA = buildSupportCaseSessionKey({
      agentId: 'customer-support-safe',
      accountId: 'default',
      conversationId: 'cid-1',
      caseId: 'case-a',
    });
    const sessionKeyB = buildSupportCaseSessionKey({
      agentId: 'customer-support-safe',
      accountId: 'default',
      conversationId: 'cid-1',
      caseId: 'case-b',
    });

    expect(sessionKeyA).not.toBe(sessionKeyB);
    expect(sessionKeyA).toContain('support-case/cid-1/case-a');
    expect(sessionKeyB).toContain('support-case/cid-1/case-b');
  });
});
