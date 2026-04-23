import { createHash } from 'node:crypto';

export type SupportCaseRouterLikeConfig = {
  enabled?: boolean;
  allowedGroups?: Array<string | number>;
  safeAgentId?: string;
  requireMentionForNewRoot?: boolean;
  caseMarkerMode?: 'short-ref' | 'none';
  toolPolicy?: {
    mode?: 'allowlist';
    allow?: string[];
    deny?: string[];
  };
};

export type ReplyMapLookup = {
  findByMessageId: (messageId: string) => Promise<{
    caseId: string;
    rootMessageId: string;
    publicCaseRef?: string;
  } | null>;
  findByPublicCaseRef?: (publicCaseRef: string) => Promise<{
    caseId: string;
    rootMessageId: string;
    publicCaseRef?: string;
  } | null>;
};

function normalizeSupportGroupId(value: string | number | undefined | null): string {
  return String(value ?? '').trim();
}

export function createSupportCaseRouter(params: {
  config: SupportCaseRouterLikeConfig;
  replyMap: ReplyMapLookup;
}) {
  return {
    async resolve(input: {
      accountId: string;
      conversationId: string;
      messageId: string;
      senderId: string;
      isGroup: boolean;
      isMentioned: boolean;
      repliedMessageId?: string;
      markerRef?: string;
    }) {
      if (params.config.enabled !== true) {
        return { shouldRun: false, reason: 'router_disabled' as const };
      }

      if (!input.isGroup) {
        return { shouldRun: false, reason: 'not_group' as const };
      }

      const allowlist = (params.config.allowedGroups ?? []).map((value) => normalizeSupportGroupId(value));
      if (allowlist.length === 0 || !allowlist.includes(normalizeSupportGroupId(input.conversationId))) {
        return { shouldRun: false, reason: 'not_allowlisted_group' as const };
      }

      if (!input.isMentioned) {
        return { shouldRun: false, reason: 'not_mentioned_for_new_root' as const };
      }

      const caseId = `case-${createHash('sha256')
        .update(`${input.accountId}:${input.conversationId}:${input.messageId}`)
        .digest('hex')
        .slice(0, 16)}`;

      return {
        shouldRun: true,
        agentId: params.config.safeAgentId,
        caseId,
        rootMessageId: input.messageId,
        publicCaseRef: params.config.caseMarkerMode === 'none'
          ? undefined
          : `#Q-${caseId.replace(/^case-/, '').slice(0, 6).toUpperCase()}`,
        matchedBy: 'new_root' as const,
        isNewCase: true,
      };
    },
  };
}
