/** 只使用回调中明确给出的引用 ID，不按时间、正文或发送者猜测。 */
function object(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'string' && value.length <= 64 * 1024) {
    try { value = JSON.parse(value); } catch { return undefined; }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 512
    ? value.trim() : undefined;
}

export interface QuotedMessageReference {
  isQuoted: boolean;
  /** 保留全部明确 ID：相互冲突时由存储层拒绝恢复。 */
  ids: string[];
}

export function extractQuotedMessageReference(data: unknown): QuotedMessageReference {
  const root = object(data);
  if (!root) return { isQuoted: false, ids: [] };
  const ids = new Set<string>();
  let isQuoted = false;
  const add = (value: unknown) => {
    const id = identifier(value);
    if (id) { ids.add(id); isQuoted = true; }
  };
  add(root.originalMsgId);
  add(root.originalProcessQueryKey);
  const containers = [root, object(root.text), object(root.content)].filter(Boolean);
  for (const container of containers) {
    if (container!.isReplyMsg === true) isQuoted = true;
    const replied = object(container!.repliedMsg);
    if (!replied) continue;
    isQuoted = true;
    for (const key of ['msgId', 'messageId', 'processQueryKey', 'outTrackId', 'cardInstanceId']) {
      add(replied[key]);
    }
  }
  return { isQuoted, ids: [...ids] };
}

export function extractQuotedMessageId(data: unknown): string | undefined {
  return extractQuotedMessageReference(data).ids[0];
}
