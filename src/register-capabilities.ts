import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { resolveStateDir } from 'openclaw/plugin-sdk/state-paths';
import { join } from 'node:path';
import { initializeMessageContextStore } from './message-context.ts';
import { registerDingtalkQuestionTool } from './questions/index.ts';
import { registerDingtalkRunMetadata } from './run-metadata.ts';

/** 标准入口与 bundled 入口共用注册流程，避免只有一种安装方式具备新能力。 */
export function registerDingtalkConversationCapabilities(api: OpenClawPluginApi): void {
  try { initializeMessageContextStore(join(resolveStateDir(), 'dingtalk-connector', 'message-context.json')); }
  catch { api.logger?.warn?.('引用缓存不可用，本进程使用内存缓存'); }
  registerDingtalkQuestionTool(api);
  registerDingtalkRunMetadata(api);
}
