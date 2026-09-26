/** 只保留钉钉实际回执里的消息身份；carrierId 是卡片投放结果的消息查询键。 */
export function extractDingtalkMessageIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const items = [record, record.result, record.data].filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object");
  const ids: string[] = [];
  for (const item of items) {
    for (const value of [item.processQueryKey, item.messageId, item.msgId]) {
      if (typeof value === "string" && value.trim() && value.length <= 512) ids.push(value.trim());
    }
    if (Array.isArray(item.deliverResults)) {
      for (const delivered of item.deliverResults) {
        if (delivered?.success === false) continue;
        if (typeof delivered?.carrierId === "string" && delivered.carrierId.trim() && delivered.carrierId.length <= 512) ids.push(delivered.carrierId.trim());
        ids.push(...extractDingtalkMessageIds(delivered));
      }
    }
  }
  return [...new Set(ids)];
}

/** Webhook 可能以 HTTP 200 返回业务错误；错误回执不能进入引用缓存。 */
export function assertDingtalkMessageDelivered(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const value = payload as Record<string, unknown>;
  if (value.ok === false || value.success === false ||
    (value.errcode !== undefined && Number(value.errcode) !== 0)) {
    throw new Error("钉钉消息投递失败");
  }
}
