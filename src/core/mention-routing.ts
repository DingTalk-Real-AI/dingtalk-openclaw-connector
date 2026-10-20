export interface MentionRoutingConfig {
  enabled?: boolean;
  aliases?: Record<string, string>;
  maxTargets?: number;
}

/** 实验路由只识别管理员显式配置的 @别名，不把任意人名/机器人 ID 当作 Agent。 */
export function resolveMentionTargets(text: string, config: MentionRoutingConfig | undefined, agentIds: string[]): {
  agentIds: string[]; text: string;
} {
  if (!config?.enabled) return { agentIds: [], text };
  const allowed = new Set(agentIds);
  const selected: string[] = [];
  const cleaned = text.replace(/(^|\s)@([^\s@]+)(?=\s|$)/gu, (token, prefix: string, alias: string) => {
    const target = Object.prototype.hasOwnProperty.call(config.aliases ?? {}, alias) ? config.aliases![alias] : undefined;
    if (!target || !allowed.has(target)) return token;
    if (!selected.includes(target)) selected.push(target);
    return prefix;
  }).trim();
  const maximum = Math.min(5, Math.max(1, config.maxTargets ?? 3));
  if (selected.length > maximum) throw new Error(`单条消息最多可指定 ${maximum} 个助手`);
  // 管理命令与旁路命令只进入第一个明确目标，避免多次执行 reset 等操作。
  return { agentIds: cleaned.startsWith('/') ? selected.slice(0, 1) : selected, text: selected.length ? cleaned : text };
}
