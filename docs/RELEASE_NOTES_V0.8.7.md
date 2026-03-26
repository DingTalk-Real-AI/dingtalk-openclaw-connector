# Release Notes - v0.8.7

## 🎉 新版本亮点 / Highlights

本次更新专注于**账号配置兼容性**与**网络代理控制**两大核心问题的修复。修复了驼峰命名账号 ID（如 `zhizaoDashuIP`）因大小写规范化导致配置查找失败的问题，同时统一了 WebSocket 连接与媒体下载的代理控制逻辑，确保 `DINGTALK_FORCE_PROXY` 环境变量在所有网络请求中生效一致。

This release focuses on two critical fixes: **account configuration compatibility** and **network proxy control**. It resolves an issue where camelCase account IDs (e.g., `zhizaoDashuIP`) failed to match their configurations due to forced lowercasing, and unifies proxy control logic across WebSocket connections and media downloads so that the `DINGTALK_FORCE_PROXY` environment variable is consistently respected.

## 🐛 修复 / Fixes

- **账号 ID 大小写敏感修复 / Account ID case-sensitivity fix**  
  修复 `normalizeAccountId` 函数强制将账号 ID 转为小写（`.toLowerCase()`）导致驼峰命名账号（如 `zhizaoDashuIP`）无法匹配配置的问题。现在账号 ID 仅做 `trim()` 处理，保留原始大小写，与配置文件中的 key 严格匹配。  
  Fixed `normalizeAccountId` forcibly lowercasing account IDs (`.toLowerCase()`), which caused camelCase account IDs (e.g., `zhizaoDashuIP`) to fail configuration lookup. Account IDs are now only trimmed, preserving original casing for strict matching against config keys.

- **WebSocket 连接代理控制统一 / Unified proxy control for WebSocket connections**  
  修复 `src/core/connection.ts` 中 WebSocket 连接未遵循 `DINGTALK_FORCE_PROXY` 环境变量的问题，现在与 HTTP 请求保持一致的代理控制逻辑。  
  Fixed WebSocket connections in `src/core/connection.ts` not respecting the `DINGTALK_FORCE_PROXY` environment variable; proxy control is now consistent with HTTP requests.

- **媒体下载代理控制统一 / Unified proxy control for media downloads**  
  修复 `src/core/message-handler.ts` 中图片/文件下载时代理配置与 HTTP 客户端不一致的问题，确保所有媒体下载请求统一遵循代理控制策略。  
  Fixed inconsistent proxy configuration for image/file downloads in `src/core/message-handler.ts`; all media download requests now follow the unified proxy control policy.

- **多账号消息去重误判修复 / Multi-account message deduplication false positive fix**  
  修复多账号（多机器人）场景下，同一条群消息 @多个机器人时，第二个机器人因消息去重缓存未按账号隔离，误将自己收到的消息判定为重复而跳过处理的问题。现在 `checkAndMarkDingtalkMessage` 的去重 key 带有 `accountId` 前缀，不同机器人账号的去重缓存完全隔离。  
  Fixed a false positive in multi-account (multi-bot) scenarios where a group message mentioning multiple bots caused the second bot to incorrectly skip processing, because the deduplication cache was not scoped per account. The deduplication key in `checkAndMarkDingtalkMessage` now includes an `accountId` prefix, fully isolating each bot's deduplication cache.

## 📥 安装升级 / Installation & Upgrade

```bash
# 通过 npm 安装最新版本 / Install latest version via npm
openclaw plugins install @dingtalk-real-ai/dingtalk-connector

# 或升级现有版本 / Or upgrade existing version
openclaw plugins update dingtalk-connector

# 通过 Git 安装 / Install via Git
openclaw plugins install https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector.git
```

## 🔗 相关链接 / Related Links

- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档 / Documentation](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)

---

**发布日期 / Release Date**：2026-03-26  
**版本号 / Version**：v0.8.7  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
