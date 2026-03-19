/**
 * DingTalk Connector Plugin for OpenClaw
 *
 * 钉钉企业内部机器人插件，使用 Stream 模式连接，支持 AI Card 流式响应。
 * 已迁移到 OpenClaw SDK，支持多账号、安全策略等完整功能。
 * 
 * Last updated: 2026-03-18 17:00:00
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { dingtalkPlugin } from "./src/channel.ts";
import { setDingtalkRuntime } from "./src/runtime.ts";
import { registerGatewayMethods } from "./src/gateway-methods.ts";

export default function register(api: OpenClawPluginApi) {
  setDingtalkRuntime(api.runtime);
  api.registerChannel({ plugin: dingtalkPlugin });
  
  // 注册 Gateway Methods
  registerGatewayMethods(api);
}
