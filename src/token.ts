/**
 * Token 管理模块
 * 处理钉钉 Access Token 的获取和缓存
 */

import axios from 'axios';
import { DINGTALK_OAPI } from './constants';

/** Access Token 缓存 */
let accessToken: string | null = null;
let accessTokenExpiry = 0;

/**
 * 获取钉钉 Access Token（新版本 API）
 */
export async function getAccessToken(config: any): Promise<string> {
  const now = Date.now();
  if (accessToken && accessTokenExpiry > now + 60_000) {
    return accessToken;
  }

  const response = await axios.post('https://api.dingtalk.com/v1.0/oauth2/accessToken', {
    appKey: config.clientId,
    appSecret: config.clientSecret,
  });

  accessToken = response.data.accessToken;
  accessTokenExpiry = now + (response.data.expireIn * 1000);
  return accessToken!;
}

/**
 * 获取钉钉 OAPI Access Token（旧版本 API，用于媒体上传等）
 */
export async function getOapiAccessToken(config: any): Promise<string | null> {
  try {
    const resp = await axios.get(`${DINGTALK_OAPI}/gettoken`, {
      params: { appkey: config.clientId, appsecret: config.clientSecret },
    });
    if (resp.data?.errcode === 0) return resp.data.access_token;
    return null;
  } catch {
    return null;
  }
}

/** staffId → unionId 缓存 */
const unionIdCache = new Map<string, string>();

/**
 * 通过 oapi 旧版接口将 staffId 转换为 unionId
 */
export async function getUnionId(staffId: string, config: any, log?: any): Promise<string | null> {
  const cached = unionIdCache.get(staffId);
  if (cached) return cached;

  try {
    const token = await getOapiAccessToken(config);
    if (!token) {
      log?.error?.('[DingTalk] getUnionId: 无法获取 oapi access_token');
      return null;
    }
    const resp = await axios.get(`${DINGTALK_OAPI}/user/get`, {
      params: { access_token: token, userid: staffId },
      timeout: 10_000,
    });
    const unionId = resp.data?.unionid;
    if (unionId) {
      unionIdCache.set(staffId, unionId);
      log?.info?.(`[DingTalk] getUnionId: ${staffId} → ${unionId}`);
      return unionId;
    }
    log?.error?.(`[DingTalk] getUnionId: 响应中无 unionid 字段: ${JSON.stringify(resp.data)}`);
    return null;
  } catch (err: any) {
    log?.error?.(`[DingTalk] getUnionId 失败: ${err.message}`);
    return null;
  }
}
