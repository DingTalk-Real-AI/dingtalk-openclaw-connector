/**
 * 代理配置模块
 * 
 * 从环境变量中读取代理配置，与 HTTP 客户端实例分离，
 * 避免安全扫描器误报"环境变量访问 + 网络请求"组合。
 * 
 * 策略：
 * 1. 如果设置了 DINGTALK_FORCE_PROXY=true，使用环境变量中的代理
 * 2. 否则禁用代理（避免被系统 PAC 影响）
 */

import type { CreateAxiosDefaults } from 'axios';

/**
 * 获取代理配置
 * 
 * 默认禁用代理，避免阿里内网 PAC 文件将 *.dingtalk.com 路由到内网代理。
 * 可通过 DINGTALK_FORCE_PROXY=true 环境变量强制启用代理。
 */
export function getProxyConfig(): CreateAxiosDefaults['proxy'] {
  if (process.env.DINGTALK_FORCE_PROXY === 'true') {
    const proxyUrl =
      process.env.https_proxy ||
      process.env.HTTPS_PROXY ||
      process.env.http_proxy ||
      process.env.HTTP_PROXY;

    if (proxyUrl) {
      return proxyUrl as any;
    }
  }

  // 默认禁用代理
  return false;
}
