# Release Notes - v0.8.10

## 🎉 新版本亮点 / Highlights

本次更新修复了 **OpenClaw SDK 升级后 Gateway Methods 配置访问失败**的关键问题，并**锁定 axios 版本**以提升依赖稳定性。

This release fixes a **critical Gateway Methods configuration access failure** after OpenClaw SDK upgrade, and **pins the axios version** for improved dependency stability.

## 🐛 修复 / Fixes

- **Gateway Methods 配置访问失败 / Gateway Methods config access failure** ([#397](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/397))  
  修复 SDK 升级后 `GatewayRequestContext.deps` 类型变更（`CliDeps = { [channelId: string]: unknown }`），导致 `context.deps.config` 为 `undefined`，所有 Gateway RPC 方法（sendToUser、sendToGroup、send、docs.*、status、probe）调用时抛出 `Cannot read properties of undefined (reading 'channels')` 错误。现在通过 SDK 提供的 `loadConfig()` 函数（从 `openclaw/plugin-sdk/config-runtime` 导出）获取完整配置，替代原来的 `context.deps.config` 访问方式。  
  Fixed `context.deps.config` being `undefined` after SDK upgrade where `GatewayRequestContext.deps` type changed to `CliDeps = { [channelId: string]: unknown }`. All Gateway RPC methods (sendToUser, sendToGroup, send, docs.*, status, probe) threw `Cannot read properties of undefined (reading 'channels')`. Now uses SDK's `loadConfig()` function (exported from `openclaw/plugin-sdk/config-runtime`) to obtain the full configuration.

- **锁定 axios 版本避免兼容性问题 / Pin axios version to prevent compatibility issues** ([#396](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/396))  
  将 `axios` 依赖从 `^1.6.0` 锁定为 `1.6.0`，避免 npm install 时自动升级到不兼容的新版本导致运行时错误。  
  Pinned `axios` dependency from `^1.6.0` to `1.6.0` to prevent automatic upgrades to incompatible versions during `npm install`.

## 🔧 内部改进 / Internal Improvements

- **connection.ts 动态 import 优化** - 将 `createLoggerFromConfig` 从静态 import 改为动态 import，避免潜在的循环依赖问题。  
  **connection.ts dynamic import optimization** - Changed `createLoggerFromConfig` from static to dynamic import to avoid potential circular dependency issues.

- **单元测试适配** - 更新 Gateway Methods 单元测试，mock `openclaw/plugin-sdk/config-runtime` 的 `loadConfig` 函数，替代原来的 `context.deps.config` mock 方式。  
  **Unit test adaptation** - Updated Gateway Methods unit tests to mock `loadConfig` from `openclaw/plugin-sdk/config-runtime` instead of the deprecated `context.deps.config`.

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

**发布日期 / Release Date**：2026-03-31  
**版本号 / Version**：v0.8.10  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
