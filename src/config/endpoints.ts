import type { DingtalkConfig } from "../types/index.ts";

export const DEFAULT_DINGTALK_API_ENDPOINT = "https://api.dingtalk.com";
export const DEFAULT_DINGTALK_GATEWAY_ENDPOINT = DEFAULT_DINGTALK_API_ENDPOINT;
export const DEFAULT_DINGTALK_TOKEN_ENDPOINT = DEFAULT_DINGTALK_API_ENDPOINT;
export const DEFAULT_DINGTALK_OAPI_ENDPOINT = "https://oapi.dingtalk.com";

export type DingtalkEndpointKey =
  | "gatewayEndpoint"
  | "tokenEndpoint"
  | "apiEndpoint"
  | "oapiEndpoint";

export type DingtalkEndpoints = Record<DingtalkEndpointKey, string>;
export type DingtalkEndpointConfig = Partial<
  Pick<DingtalkConfig, DingtalkEndpointKey | "endpoint">
>;

function normalizeEndpoint(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/\/+$/, "");
}

export function resolveDingtalkEndpoints(config?: DingtalkEndpointConfig): DingtalkEndpoints {
  return {
    gatewayEndpoint: normalizeEndpoint(
      config?.gatewayEndpoint ?? config?.endpoint,
      DEFAULT_DINGTALK_GATEWAY_ENDPOINT,
    ),
    tokenEndpoint: normalizeEndpoint(
      config?.tokenEndpoint,
      DEFAULT_DINGTALK_TOKEN_ENDPOINT,
    ),
    apiEndpoint: normalizeEndpoint(config?.apiEndpoint, DEFAULT_DINGTALK_API_ENDPOINT),
    oapiEndpoint: normalizeEndpoint(config?.oapiEndpoint, DEFAULT_DINGTALK_OAPI_ENDPOINT),
  };
}

export function dingtalkApiUrl(config: DingtalkEndpointConfig | undefined, path: string): string {
  return `${resolveDingtalkEndpoints(config).apiEndpoint}${path}`;
}

export function dingtalkOapiUrl(config: DingtalkEndpointConfig | undefined, path: string): string {
  return `${resolveDingtalkEndpoints(config).oapiEndpoint}${path}`;
}

export function dingtalkTokenUrl(config: DingtalkEndpointConfig | undefined, path: string): string {
  return `${resolveDingtalkEndpoints(config).tokenEndpoint}${path}`;
}
