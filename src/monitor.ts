import type { ClawdbotConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import * as monitorState from "./monitor.state";

// 只解构 monitorState 的导出
const {
  clearDingtalkWebhookRateLimitStateForTest,
  getDingtalkWebhookRateLimitStateSizeForTest,
  isWebhookRateLimitedForTest,
  stopDingtalkMonitorState,
} = monitorState;

console.log('[monitor.ts] 模块加载完成');

export type MonitorDingtalkOpts = {
  config?: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  accountId?: string;
};

export {
  clearDingtalkWebhookRateLimitStateForTest,
  getDingtalkWebhookRateLimitStateSizeForTest,
  isWebhookRateLimitedForTest,
} from "./monitor.state";

// 只导出类型，不 re-export 函数（避免循环依赖）
export type { DingtalkReactionCreatedEvent } from "./monitor-single";

export async function monitorDingtalkProvider(opts: MonitorDingtalkOpts = {}): Promise<void> {
  const cfg = opts.config;
  if (!cfg) {
    throw new Error("Config is required for DingTalk monitor");
  }

  const log = opts.runtime?.log ?? console.log;

  log?.info?.(`[monitorDingtalkProvider] 开始执行，accountId=${opts.accountId}`);

  // 并行导入所有模块（无循环依赖，可以并行）
  const [accountsModule, monitorAccountModule, monitorSingleModule] = await Promise.all([
    import("./accounts"),
    import("./monitor.account"),
    import("./monitor-single"),
  ]);
  
  const { resolveDingtalkAccount, listEnabledDingtalkAccounts } = accountsModule;
  const { handleDingTalkMessage } = monitorAccountModule;
  const { monitorSingleAccount, resolveReactionSyntheticEvent } = monitorSingleModule;

  if (opts.accountId) {
    log?.info?.(`[monitorDingtalkProvider] 监控单个账号：${opts.accountId}`);
    const account = resolveDingtalkAccount({ cfg, accountId: opts.accountId });
    if (!account.enabled || !account.configured) {
      throw new Error(`DingTalk account "${opts.accountId}" not configured or disabled`);
    }
    log?.info?.(`[monitorDingtalkProvider] 调用 monitorSingleAccount for ${opts.accountId}`);
    log?.info?.(`[monitorDingtalkProvider] monitorSingleAccount 类型：${typeof monitorSingleAccount}`);
    if (typeof monitorSingleAccount !== 'function') {
      log?.error?.(`[monitorDingtalkProvider] monitorSingleAccount 不是函数！类型：${typeof monitorSingleAccount}`);
      throw new Error(`monitorSingleAccount is not a function, type: ${typeof monitorSingleAccount}`);
    }
    return monitorSingleAccount({
      cfg,
      account,
      runtime: opts.runtime,
      abortSignal: opts.abortSignal,
      messageHandler: handleDingTalkMessage,
    });
  }

  const accounts = listEnabledDingtalkAccounts(cfg);
  log?.info?.(`[monitorDingtalkProvider] 找到 ${accounts.length} 个启用的账号`);
  if (accounts.length === 0) {
    throw new Error("No enabled DingTalk accounts configured");
  }

  log?.info?.(
    `dingtalk-connector: starting ${accounts.length} account(s): ${accounts.map((a) => a.accountId).join(", ")}`,
  );

  const monitorPromises: Promise<void>[] = [];
  for (const account of accounts) {
    if (opts.abortSignal?.aborted) {
      log("dingtalk-connector: abort signal received during startup preflight; stopping startup");
      break;
    }

    log?.info?.(`[monitorDingtalkProvider] 准备启动账号：${account.accountId}`);
    monitorPromises.push(
      monitorSingleAccount({
        cfg,
        account,
        runtime: opts.runtime,
        abortSignal: opts.abortSignal,
        messageHandler: handleDingTalkMessage,
      }),
    );
  }

  await Promise.all(monitorPromises);
}

export function stopDingtalkMonitor(accountId?: string): void {
  stopDingtalkMonitorState(accountId);
}