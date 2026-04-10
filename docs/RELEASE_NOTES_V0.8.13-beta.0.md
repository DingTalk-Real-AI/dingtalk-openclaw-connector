# Release Notes - v0.8.13-beta.0

## 🎉 新版本亮点 / Highlights

本次更新修复了**多账号凭据解析错误**（SecretInput 对象未展开导致发送失败）、**连接错误无法被正确捕获**（async 回调中 throw 无效），以及**消息路由支持 `group:`/`user:` 前缀**，同时兼容 pdf-parse v1/v2 双版本 API，并修复了 QPS 限流后立即重试的问题。

This release fixes **multi-account credential resolution** (SecretInput objects not unwrapped before sending), **connection errors not propagating correctly** (throw inside async callbacks replaced with reject), and adds **`group:`/`user:` prefix support in message routing**, along with pdf-parse v1/v2 compatibility and a QPS throttle retry fix.

## 🐛 修复 / Fixes

- **修复多账号场景下发送消息时凭据未解析 / Fix unresolved credentials in sendText/sendMedia**  
  `sendText` 和 `sendMedia` 在多账号模式下，`clientId`/`clientSecret` 可能为 `SecretInput` 对象或 `undefined`，导致 API 请求携带无效凭据。现已在调用前用 `resolveDingtalkAccount` 返回的已解析值覆盖原始 config。  
  In multi-account mode, `clientId`/`clientSecret` could be `SecretInput` objects or `undefined`, causing API requests with invalid credentials. Now the resolved values from `resolveDingtalkAccount` are used to override the raw config.

- **修复连接错误在 async 回调中无法传播 / Fix connection errors not propagating in async callback**  
  `connection.ts` 的错误处理在 async 回调内使用 `throw` 抛出错误，但错误无法被外层 Promise 捕获，导致 400/401 等连接失败被静默忽略。已改为 `reject(new Error(...))` 确保错误正确传播。  
  Error handlers in `connection.ts` used `throw` inside async callbacks, making errors uncatchable by the outer Promise. Changed to `reject(new Error(...))` to ensure proper error propagation for 400/401 and other connection failures.

- **修复 QPS 限流后立即重试导致再次触发限流 / Fix QPS rate limit immediate retry**  
  收到 403 QpsLimit 响应后，`lastUpdateTime` 未更新，导致下一次节流检查立即放行并再次触发限流。现已在跳过更新时同步 `lastUpdateTime`。  
  After receiving a 403 QpsLimit response, `lastUpdateTime` was not updated, causing the throttle check to immediately allow the next attempt. Now `lastUpdateTime` is synced when skipping an update.

- **修复 `resolveAllowFrom` 全局过滤误拦截群消息 / Fix resolveAllowFrom global filter incorrectly blocking group messages**  
  框架层使用 `resolveAllowFrom` 对所有消息（含群消息）做全局发送者过滤，但 `allowFrom` 原意只用于私聊白名单。群消息有独立的 `groupAllowFrom` 字段控制，由 `message-handler.ts` 内部处理。现已将 `resolveAllowFrom` 改为返回空列表，禁用框架层全局过滤。  
  The framework used `resolveAllowFrom` to filter all incoming messages (including group messages), but `allowFrom` was intended only for DM whitelisting. Group messages have a separate `groupAllowFrom` field handled internally by `message-handler.ts`. Now returns `[]` to disable framework-level global filtering.

## ✨ 功能改进 / Improvements

- **消息路由支持 `group:`/`user:` 前缀 / Message routing supports `group:`/`user:` prefix targets**  
  `sendTextToDingTalk` 和 `sendMediaToDingTalk` 新增对 `group:<openConversationId>` 和 `user:<userId>` 格式的目标解析，与 `gateway-methods.ts` 中的逻辑保持一致，兼容旧版裸 `cid` 前缀格式。  
  `sendTextToDingTalk` and `sendMediaToDingTalk` now support `group:<openConversationId>` and `user:<userId>` prefixed targets, consistent with `gateway-methods.ts` logic, while maintaining backward compatibility with bare `cid`-prefixed targets.

- **兼容 pdf-parse v1 和 v2 API / Support both pdf-parse v1 and v2 API**  
  `parsePdfFile` 现在自动检测 pdf-parse 模块导出格式：v2.x 使用 `PDFParse` 类（class API），v1.x 使用 `default` 函数，均可正确解析 PDF 文件。  
  `parsePdfFile` now auto-detects the pdf-parse export format: v2.x uses the `PDFParse` class API, v1.x uses the `default` function — both are handled correctly.

- **将 `enableMediaUpload`/`systemPrompt` 移至共享配置 / Move `enableMediaUpload`/`systemPrompt` to shared config shape**  
  这两个字段现在位于 `DingtalkSharedConfigShape`，在多账号模式下每个账号可独立配置，而不是只能在顶层配置。  
  These fields are now in `DingtalkSharedConfigShape`, allowing per-account configuration in multi-account mode instead of only top-level.

## 📝 文档 / Documentation

- **优化 README 安装验证说明 / Improve README plugin verification instructions**  
  移除了版本号硬编码（`v0.8.6`），改为通用版本占位符，并新增"如果没看到 `loaded`"的警示提示，避免用户在插件未正确加载时继续配置步骤。  
  Removed hardcoded version number (`v0.8.6`), replaced with generic version placeholder, and added a warning for when `loaded` is not shown to prevent users from proceeding with configuration before the plugin is properly loaded.

## 📥 安装升级 / Installation & Upgrade

```bash
# 安装 beta 版本 / Install beta version
openclaw plugins install @dingtalk-real-ai/dingtalk-connector@0.8.13-beta.0

# 或升级现有版本 / Or upgrade existing version
openclaw plugins update dingtalk-connector

# 通过 Git 安装 / Install via Git
openclaw plugins install https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector.git#v0.8.13
```

## 🔗 相关链接 / Related Links

- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档 / Documentation](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)

---

**发布日期 / Release Date**：2026-04-06  
**版本号 / Version**：v0.8.13-beta.0  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
