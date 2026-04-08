# Release Notes - v0.8.13

## 🎉 新版本亮点 / Highlights

本次更新聚焦**媒体发送可靠性**和**多账号稳定性**：修复了文件发送时 mediaId 格式不一致导致静默失败的问题，修复了多账号凭据解析错误、连接错误无法传播、QPS 限流重试等多个关键 Bug，同时新增 `group:`/`user:` 前缀路由支持。

This release focuses on **media sending reliability** and **multi-account stability**: fixes silent file sending failures caused by inconsistent mediaId format, resolves multi-account credential resolution errors, connection error propagation, QPS throttle retry issues, and adds `group:`/`user:` prefix routing support.

## 🐛 修复 / Fixes

- **修复文件发送时 mediaId 格式不一致导致静默失败 / Fix inconsistent mediaId format causing silent file send failure**  
  `sendFileProactive` 在不同调用点传入了 `cleanMediaId`（不带 `@`）和 `mediaId`（带 `@`），经实测钉钉 API 统一要求带 `@` 前缀的 `mediaId`。同时修复了 `sendFileMessage`/`sendFileProactive` 的 catch 块吞掉异常导致外层误报成功的问题。  
  `sendFileProactive` was called with `cleanMediaId` (without `@`) in some places and `mediaId` (with `@`) in others. Testing confirmed DingTalk API requires the `@`-prefixed `mediaId`. Also fixed catch blocks swallowing errors, causing false success reports.

- **修复多账号场景下凭据未解析 / Fix unresolved credentials in multi-account mode**  
  `sendText`/`sendMedia` 在多账号模式下 `clientId`/`clientSecret` 可能为 `SecretInput` 对象，导致 API 请求携带无效凭据。现已用 `resolveDingtalkAccount` 返回的已解析值覆盖。  
  In multi-account mode, credentials could be `SecretInput` objects; now resolved values are used.

- **修复连接错误在 async 回调中无法传播 / Fix connection errors not propagating**  
  `connection.ts` 错误处理使用 `throw` 抛出，但在 async 回调内无法被外层 Promise 捕获。改为 `reject(new Error(...))` 确保 400/401 等错误正确传播。  
  Changed `throw` to `reject()` inside async error handlers for proper error propagation.

- **修复 QPS 限流后立即重试 / Fix QPS rate limit immediate retry**  
  收到 403 QpsLimit 后未更新 `lastUpdateTime`，导致节流检查立即放行。现已同步更新。  
  `lastUpdateTime` is now synced when skipping a QPS-limited update.

- **修复 `resolveAllowFrom` 全局过滤误拦截群消息 / Fix resolveAllowFrom blocking group messages**  
  `allowFrom` 仅用于私聊白名单，群消息由 `groupAllowFrom` 在内部处理。将 `resolveAllowFrom` 改为返回空列表，禁用框架层全局过滤。  
  Returns `[]` to disable framework-level filtering; internal policy checks handle DM and group separately.

## ✨ 功能改进 / Improvements

- **消息路由支持 `group:`/`user:` 前缀 / Message routing supports `group:`/`user:` prefix targets**  
  `sendTextToDingTalk` 和 `sendMediaToDingTalk` 新增 `group:<id>` 和 `user:<id>` 格式解析，兼容旧版裸 `cid` 前缀。  
  Now supports `group:<id>` and `user:<id>` prefixed targets, backward compatible with bare `cid` prefix.

- **兼容 pdf-parse v1/v2 API、共享配置字段扩展 / pdf-parse v1/v2 compatibility & shared config fields**  
  `parsePdfFile` 自动检测 pdf-parse 导出格式；`enableMediaUpload`/`systemPrompt` 移至共享配置，支持多账号独立配置。  
  Auto-detects pdf-parse export format; `enableMediaUpload`/`systemPrompt` now configurable per-account.

- **新增出站路由测试 / Add outbound routing tests**  
  新增 `outbound-routing.test.ts`，覆盖 `group:`/`user:` 前缀解析和消息路由场景。  
  Added `outbound-routing.test.ts` covering prefix parsing and message routing scenarios.

## 📥 安装升级 / Installation & Upgrade

```bash
openclaw plugins install @dingtalk-real-ai/dingtalk-connector
openclaw plugins update dingtalk-connector
openclaw plugins install https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector.git
```

## 🔗 相关链接 / Related Links

- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档 / Documentation](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)

---

**发布日期 / Release Date**：2026-04-08  
**版本号 / Version**：v0.8.13  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
