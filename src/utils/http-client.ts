/**
 * HTTP 客户端配置模块
 * 
 * 提供统一的 axios 实例，禁用代理以避免系统 PAC 文件影响
 * 
 * 问题背景：
 * - 阿里巴巴内网 PAC 文件会将 *.dingtalk.com 路由到内网代理（如 192.168.1.176:443）
 * - 当不在内网环境时，会导致连接超时
 * 
 * 解决方案：
 * - 创建专用的 axios 实例，禁用代理
 * - 仅影响钉钉插件，不影响 OpenClaw Gateway 和其他插件
 * 
 * 使用方式：
 * ```typescript
 * import { dingtalkHttp } from './utils/http-client.ts';
 * 
 * const response = await dingtalkHttp.post('/api/endpoint', data);
 * ```
 */

import axios, { type AxiosInstance } from 'axios';
import { getProxyConfig } from './proxy-config.ts';

/**
 * 钉钉专用 HTTP 客户端
 * 
 * 特性：
 * - 禁用代理（避免 PAC 文件影响）
 * - 30 秒超时
 * - 仅影响钉钉插件的请求
 */
export const dingtalkHttp: AxiosInstance = axios.create({
  proxy: getProxyConfig(),
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * 钉钉 OAPI 专用 HTTP 客户端（用于媒体上传等）
 */
export const dingtalkOapiHttp: AxiosInstance = axios.create({
  proxy: getProxyConfig(),
  timeout: 60000, // 媒体上传可能需要更长时间
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * 用于文件上传的 HTTP 客户端（支持 multipart/form-data）
 */
export const dingtalkUploadHttp: AxiosInstance = axios.create({
  proxy: getProxyConfig(),
  timeout: 120000, // 文件上传需要更长时间
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
});
