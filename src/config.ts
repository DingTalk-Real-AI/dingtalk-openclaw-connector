/**
 * 配置管理模块
 * 处理配置的读取和验证
 */

import type { ClawdbotConfig } from 'clawdbot/plugin-sdk';

export function getConfig(cfg: ClawdbotConfig) {
  return (cfg?.channels as any)?.['dingtalk-connector'] || {};
}

export function isConfigured(cfg: ClawdbotConfig): boolean {
  const config = getConfig(cfg);
  return Boolean(config.clientId && config.clientSecret);
}
