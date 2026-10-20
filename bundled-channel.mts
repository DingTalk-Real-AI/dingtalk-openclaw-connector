import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import { dingtalkPlugin, initDingtalkPluginConfigSchema } from './src/channel.ts';
import { registerDingtalkConversationCapabilities } from './src/register-capabilities.ts';
import { registerGatewayMethods } from './src/gateway-methods.ts';
import { installDingtalkCardBridge, registerDingtalkCardGatewayMethods } from './src/services/card-bridge.ts';

// SDK 注册 channel 之前必须取得完整 schema；此 sidecar 不含会隐藏具名导出的 default。
initDingtalkPluginConfigSchema();
export { dingtalkPlugin };
export { setDingtalkRuntime } from './src/runtime.ts';

export function registerDingtalkFull(api: OpenClawPluginApi): void {
  registerDingtalkConversationCapabilities(api);
  registerGatewayMethods(api);
  installDingtalkCardBridge(api);
  registerDingtalkCardGatewayMethods(api);
}
