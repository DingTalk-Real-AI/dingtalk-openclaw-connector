export type ReplyMapDirection = 'inbound_user' | 'outbound_bot';
export type ReplyMapSource = 'root' | 'reply' | 'marker' | 'outbound_ack';

export type ReplyMapEntry = {
  accountId: string;
  conversationId: string;
  messageId: string;
  caseId: string;
  rootMessageId: string;
  direction: ReplyMapDirection;
  source: ReplyMapSource;
  createdAt: number;
  senderId?: string;
  publicCaseRef?: string;
};

export type ReplyMapWriter = {
  append: (entry: ReplyMapEntry) => Promise<void>;
};

function isReplyMapEntry(value: unknown): value is ReplyMapEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.accountId === 'string'
    && typeof entry.conversationId === 'string'
    && typeof entry.messageId === 'string'
    && typeof entry.caseId === 'string'
    && typeof entry.rootMessageId === 'string'
    && (entry.direction === 'inbound_user' || entry.direction === 'outbound_bot')
    && typeof entry.createdAt === 'number';
}

export function createReplyMapStore(params: {
  writer: ReplyMapWriter;
  now?: () => number;
}) {
  const now = params.now ?? (() => Date.now());
  const byMessageId = new Map<string, ReplyMapEntry>();
  const byPublicCaseRef = new Map<string, ReplyMapEntry>();
  let corruptedLineCount = 0;

  const persist = async (entry: ReplyMapEntry) => {
    byMessageId.set(entry.messageId, entry);
    if (entry.publicCaseRef) {
      byPublicCaseRef.set(entry.publicCaseRef.toUpperCase(), entry);
    }
    await params.writer.append(entry);
    return entry;
  };

  return {
    async recordInbound(input: Omit<ReplyMapEntry, 'direction' | 'createdAt'>) {
      return persist({
        ...input,
        direction: 'inbound_user',
        createdAt: now(),
      });
    },

    async recordOutbound(input: Omit<ReplyMapEntry, 'direction' | 'createdAt'>) {
      return persist({
        ...input,
        direction: 'outbound_bot',
        createdAt: now(),
      });
    },

    async findByMessageId(messageId: string) {
      return byMessageId.get(messageId) ?? null;
    },

    async findByPublicCaseRef(publicCaseRef: string) {
      return byPublicCaseRef.get(publicCaseRef.toUpperCase()) ?? null;
    },

    async rebuildFromLines(lines: string[]) {
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (!isReplyMapEntry(parsed)) {
            corruptedLineCount += 1;
            continue;
          }
          byMessageId.set(parsed.messageId, parsed);
          if (parsed.publicCaseRef) {
            byPublicCaseRef.set(parsed.publicCaseRef.toUpperCase(), parsed);
          }
        } catch {
          corruptedLineCount += 1;
        }
      }
    },

    getCorruptedLineCount() {
      return corruptedLineCount;
    },
  };
}
