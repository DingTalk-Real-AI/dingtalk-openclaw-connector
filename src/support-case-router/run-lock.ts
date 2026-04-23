export type RecoverableRunPayload = {
  rawEvent: Record<string, unknown>;
  caseId: string;
  sessionKey: string;
  agentId: string;
  replyTarget: Record<string, unknown>;
};

export type RunLockRecord = {
  dedupeKey: string;
  status: 'accepted' | 'running' | 'done' | 'failed';
  payload: RecoverableRunPayload;
  createdAt: number;
  updatedAt: number;
  staleAfterMs: number;
  doneTtlMs: number;
  error?: string;
};

export type RunLockWriter = {
  append: (entry: RunLockRecord) => Promise<void>;
};

export function createRunLockStore(params: {
  staleAfterMs: number;
  doneTtlMs: number;
  writer: RunLockWriter;
  now?: () => number;
}) {
  const now = params.now ?? (() => Date.now());
  const entries = new Map<string, RunLockRecord>();

  const persist = async (entry: RunLockRecord) => {
    entries.set(entry.dedupeKey, entry);
    await params.writer.append(entry);
    return entry;
  };

  return {
    async accept(input: { dedupeKey: string; payload: RecoverableRunPayload }) {
      const timestamp = now();
      const existing = entries.get(input.dedupeKey);
      if (existing && existing.status !== 'failed') return existing;

      return persist({
        dedupeKey: input.dedupeKey,
        status: 'accepted',
        payload: input.payload,
        createdAt: timestamp,
        updatedAt: timestamp,
        staleAfterMs: params.staleAfterMs,
        doneTtlMs: params.doneTtlMs,
      });
    },

    async markRunning(dedupeKey: string) {
      const existing = entries.get(dedupeKey);
      if (!existing) throw new Error(`Run lock not found for ${dedupeKey}`);
      return persist({
        ...existing,
        status: 'running',
        updatedAt: now(),
      });
    },

    async markDone(dedupeKey: string) {
      const existing = entries.get(dedupeKey);
      if (!existing) throw new Error(`Run lock not found for ${dedupeKey}`);
      return persist({
        ...existing,
        status: 'done',
        updatedAt: now(),
      });
    },

    async markFailed(dedupeKey: string, error: string) {
      const existing = entries.get(dedupeKey);
      if (!existing) throw new Error(`Run lock not found for ${dedupeKey}`);
      return persist({
        ...existing,
        status: 'failed',
        updatedAt: now(),
        error,
      });
    },

    async recoverStale(input?: { now?: number }) {
      const recoverAt = input?.now ?? now();
      const recovered: RunLockRecord[] = [];

      for (const entry of entries.values()) {
        if (entry.status !== 'running') continue;
        if (recoverAt - entry.updatedAt <= entry.staleAfterMs) continue;
        recovered.push(entry);
      }

      return recovered;
    },
  };
}
