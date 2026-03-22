# Release Notes - v0.8.3

## 🎉 新版本亮点 / Highlights

本次更新聚焦于多账号场景下的稳定性与正确性：修复了多账号配置时重复建立连接的问题，优化了 WebSocket 连接管理机制，并改进了消息处理逻辑，使长连接场景下的整体可靠性显著提升。

This release focuses on stability and correctness in multi-account scenarios: it fixes duplicate connection creation when multiple accounts are configured, improves WebSocket connection management, and refines message processing logic for significantly better reliability in long-lived connection scenarios.

## 🐛 修复 / Fixes

- **多账号重复启动问题 / Multi-account Duplicate Startup**  
  修复了配置多个钉钉账号时，`enabled: false` 的账号仍会建立 WebSocket 连接的问题。现在插件会在启动时正确检查账号的 `enabled` 状态，禁用账号将保持 pending 状态直到 Gateway 停止，不再建立任何连接。  
  Fixed an issue where accounts with `enabled: false` would still establish WebSocket connections when multiple DingTalk accounts were configured. The plugin now correctly checks the `enabled` state at startup; disabled accounts remain in a pending state until the Gateway stops and no longer create any connections.

- **相同 clientId 账号去重 / Duplicate clientId Deduplication**  
  修复了多个账号配置相同 `clientId` 时会建立重复连接的问题。通过静态配置分析，同一 `clientId` 只有列表中排在最前面的启用账号才会建立连接，后续重复账号会被自动跳过并记录日志。  
  Fixed an issue where multiple accounts sharing the same `clientId` would create duplicate connections. Using static configuration analysis, only the first enabled account with a given `clientId` in the list will establish a connection; subsequent duplicates are automatically skipped and logged.

## ✨ 功能与体验改进 / Features & Improvements

- **Onboarding 配置向导优化 / Onboarding Configuration Wizard Improvement**  
  改进了钉钉连接器的配置引导逻辑：调整了凭据输入顺序（先 Client ID 后 Client Secret），优化了引导文案，使配置流程更清晰易懂。  
  Improved the DingTalk connector onboarding wizard: adjusted credential input order (Client ID first, then Client Secret), and refined the guidance text for a clearer and more intuitive setup experience.

- **会话 Key 构成遵循 OpenClaw 规范 / Session Key Follows OpenClaw Convention**  
  会话上下文（sessionKey）的构成现在严格遵循 OpenClaw 标准规则，通过 `channel`、`accountId`、`chatType`、`peerId` 等字段组合唯一标识会话，并支持 `sharedMemoryAcrossConversations` 配置实现跨会话记忆共享。  
  The session context (sessionKey) now strictly follows OpenClaw conventions, uniquely identifying sessions via `channel`, `accountId`, `chatType`, and `peerId` fields. Also supports `sharedMemoryAcrossConversations` for cross-conversation memory sharing.

- **消息处理逻辑优化 / Message Processing Logic Optimization**  
  重构消息处理流程，提升消息响应速度和处理可靠性，确保消息按序正确处理。  
  Refactored message processing flow to improve response speed and reliability, ensuring messages are processed correctly in order.

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

**发布日期 / Release Date**：2026-03-22  
**版本号 / Version**：v0.8.3  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
