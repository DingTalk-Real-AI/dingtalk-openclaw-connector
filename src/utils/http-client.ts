/**
 * HTTP 客户端配置模块
 * 
 * 提供统一的 axios 实例，用于钉钉 API 请求。
 * 
 * 使用方式：
 * ```typescript
 * import { dingtalkHttp } from './utils/http-client.ts';
 * 
 * const response = await dingtalkHttp.post('/api/endpoint', data);
 * ```
 */

import axios, { type AxiosInstance } from 'axios';

/** 钉钉专用 HTTP 客户端（30 秒超时） */
export const dingtalkHttp: AxiosInstance = axios.create({
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** 钉钉 OAPI 专用 HTTP 客户端（60 秒超时，用于媒体上传等） */
export const dingtalkOapiHttp: AxiosInstance = axios.create({
  timeout: 60000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/** 文件上传专用 HTTP 客户端（120 秒超时，无 body 大小限制） */
export const dingtalkUploadHttp: AxiosInstance = axios.create({
  timeout: 120000,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
});
