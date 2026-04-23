import { createHash } from 'node:crypto';

export function buildSupportCaseSessionPeerId(params: {
  conversationId: string;
  caseId: string;
}) {
  return `support-case/${params.conversationId}/${params.caseId}`;
}

export function buildSupportCaseSessionKey(params: {
  agentId: string;
  accountId: string;
  conversationId: string;
  caseId: string;
}) {
  const peerId = buildSupportCaseSessionPeerId({
    conversationId: params.conversationId,
    caseId: params.caseId,
  });
  const suffix = createHash('sha256')
    .update(`${params.agentId}:${params.accountId}:${peerId}`)
    .digest('hex')
    .slice(0, 8);

  return `agent:${params.agentId}:dingtalk-connector:group:${peerId}:${suffix}`;
}
