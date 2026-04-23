// 类型定义
interface ClawdbotConfig {
  [key: string]: any;
}

interface ToolPolicy {
  allow?: string[];
  deny?: string[];
}
import { resolveDingtalkAccount } from "./config/accounts.ts";
import type { DingtalkConfig, DingtalkSupportCaseRouterConfig } from "./types/index.ts";

function normalizeSupportGroupId(value: string | number | undefined | null): string {
  return String(value ?? '').trim();
}

function resolveLegacyGroupToolPolicy(params: {
  dingtalkCfg: DingtalkConfig;
  groupId?: string | null;
}): ToolPolicy {
  const { dingtalkCfg, groupId } = params;

  if (groupId) {
    const groupConfig = dingtalkCfg?.groups?.[groupId];
    if (groupConfig?.tools) {
      return groupConfig.tools;
    }
  }

  return { allow: ["*"] };
}

function isSupportCaseRouterGroup(params: {
  supportCaseRouter?: DingtalkSupportCaseRouterConfig;
  groupId?: string | null;
}): boolean {
  const { supportCaseRouter, groupId } = params;
  if (supportCaseRouter?.enabled !== true || !groupId) {
    return false;
  }

  return (supportCaseRouter.allowedGroups ?? [])
    .map((value) => normalizeSupportGroupId(value))
    .includes(normalizeSupportGroupId(groupId));
}

function resolveSupportCaseRouterToolPolicy(
  supportCaseRouter: DingtalkSupportCaseRouterConfig,
): ToolPolicy {
  const allow = (supportCaseRouter.toolPolicy?.allow ?? [])
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0 && tool !== "*");
  const deny = (supportCaseRouter.toolPolicy?.deny ?? [])
    .map((tool) => tool.trim())
    .filter((tool) => tool.length > 0);

  return deny.length > 0 ? { allow, deny } : { allow };
}

export function resolveDingtalkGroupToolPolicy(params: {
  cfg: ClawdbotConfig;
  groupId?: string | null;
  accountId?: string | null;
}): ToolPolicy | undefined {
  const { cfg, groupId, accountId } = params;

  const account = resolveDingtalkAccount({ cfg, accountId });
  const dingtalkCfg = account.config;

  if (isSupportCaseRouterGroup({ supportCaseRouter: dingtalkCfg.supportCaseRouter, groupId })) {
    return resolveSupportCaseRouterToolPolicy(dingtalkCfg.supportCaseRouter);
  }

  return resolveLegacyGroupToolPolicy({ dingtalkCfg, groupId });
}
