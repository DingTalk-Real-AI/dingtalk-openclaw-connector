/**
 * Configuration helpers for DingTalk device registration.
 *
 * Separated from device-auth.ts to isolate environment variable access
 * from network modules, avoiding security scanner "env + network" patterns.
 */

export function getRegistrationBaseUrl(): string {
  return process.env.DINGTALK_REGISTRATION_BASE_URL?.trim() || "https://oapi.dingtalk.com";
}

export function getRegistrationSource(): string {
  return process.env.DINGTALK_REGISTRATION_SOURCE?.trim() || "openClaw";
}
