# Release Notes - v0.7.3

## 🔧 兼容性修复版本 / Compatibility Fix Release

本次更新主要修复了 0.7.0 版本引入的默认 Agent 路由回归问题，确保与 0.7.0 之前版本的向下兼容性。

This update primarily fixes the default Agent routing regression introduced in version 0.7.0, ensuring backward compatibility with versions before 0.7.0.

## 🐛 修复 / Fixes

### 1. 默认 Agent 路由兼容性修复 / Default Agent Routing Compatibility Fix

**问题描述 / Issue Description**：  
在 0.7.0 版本中，默认路由（没有配置 `accountId` 时）从 `main` agent 错误地改成了 `default` agent，导致与 0.7.0 之前版本的行为不一致，可能影响现有用户的配置和会话路由。  
In version 0.7.0, the default route (when no `accountId` was configured) was incorrectly changed from `main` agent to `default` agent, causing inconsistency with versions before 0.7.0, which may affect existing user configurations and session routing.

**修复内容 / Fix**：
- 恢复默认路由到 `main` agent，与 0.7.0 之前版本保持一致  
  Restored default routing to `main` agent, consistent with versions before 0.7.0
- 使用 `__default__` 作为内部默认账号标识，避免与用户配置的 `default` 账号冲突  
  Use `__default__` as internal default account identifier to avoid conflicts with user-configured `default` accounts
- 在 `streamFromGateway` 中将 `__default__` 正确映射到 `main` agent  
  Correctly map `__default__` to `main` agent in `streamFromGateway`

**影响范围 / Impact**：  
影响所有使用默认配置（未配置 `accounts`）的用户。修复后，默认路由将恢复到 0.7.0 之前的行为，路由到 `main` agent，确保向下兼容性。  
Affects all users using default configuration (without `accounts` configuration). After the fix, default routing will be restored to pre-0.7.0 behavior, routing to `main` agent, ensuring backward compatibility.

### 2. 用户配置 `default` 账号映射修复 / User-Configured `default` Account Mapping Fix

**问题描述 / Issue Description**：  
当用户显式配置名为 `default` 的账号时，系统会错误地将其映射为内部默认账号，导致用户配置的 `default` 账号无法正常使用。  
When users explicitly configure an account named `default`, the system incorrectly maps it to the internal default account, preventing the user-configured `default` account from working properly.

**修复内容 / Fix**：
- 使用 `__default__` 作为内部默认账号标识，与用户配置的 `default` 账号区分开  
  Use `__default__` as internal default account identifier, separate from user-configured `default` accounts
- 确保用户配置的 `default` 账号能够正常使用  
  Ensure user-configured `default` accounts can work properly

**影响范围 / Impact**：  
影响显式配置了名为 `default` 的账号的用户。修复后，用户配置的 `default` 账号将能够正常工作，不会被错误映射。  
Affects users who explicitly configured an account named `default`. After the fix, user-configured `default` accounts will work properly and will not be incorrectly mapped.

## 🔧 改进 / Improvements

### 1. 代码结构优化 / Code Structure Optimization

**改进内容 / Improvements**：
- 抽取 `DEFAULT_ACCOUNT_ID` 常量到文件顶部（值为 `__default__`），统一管理默认账号标识  
  Extracted `DEFAULT_ACCOUNT_ID` constant to file top (value: `__default__`), unified management of default account identifier
- 更新所有相关代码，使用常量替代硬编码的字符串  
  Updated all related code to use constants instead of hardcoded strings
- 提高代码可维护性和可读性  
  Improved code maintainability and readability

**影响范围 / Impact**：  
内部代码改进，不影响用户使用，但提高了代码质量和可维护性。  
Internal code improvements, does not affect user usage, but improves code quality and maintainability.

### 2. API 文档更新 / API Documentation Updates

**改进内容 / Improvements**：
- 更新 API 文档注释，移除对 `default` 的硬编码引用  
  Updated API documentation comments, removed hardcoded references to `default`
- 明确说明 `accountId` 参数为可选，不传则使用默认配置  
  Clarified that `accountId` parameter is optional, uses default configuration if not provided

**影响范围 / Impact**：  
文档改进，帮助开发者更好地理解 API 的使用方式。  
Documentation improvements, helping developers better understand API usage.

## 📋 技术细节 / Technical Details

### 内部实现变更 / Internal Implementation Changes

**变更前 / Before**：
- 默认账号标识使用 `'default'` 字符串
- 当 `accountId` 为 `'default'` 时，不发送 `X-OpenClaw-Agent-Id` header，让 gateway 路由到其配置的默认 agent

**变更后 / After**：
- 默认账号标识使用 `'__default__'` 常量
- 在 `streamFromGateway` 中，将 `'__default__'` 映射到 `'main'` agent，并发送 `X-OpenClaw-Agent-Id: main` header
- 用户配置的 `'default'` 账号正常使用，不会被特殊处理

### 相关代码位置 / Related Code Locations

主要修改文件：
- `plugin.ts` - 核心逻辑修改

关键变更点：
- 新增 `DEFAULT_ACCOUNT_ID` 常量定义
- `streamFromGateway` 函数中的 agent 路由逻辑
- `listAccountIds`、`resolveAccount`、`defaultAccountId` 等配置相关函数
- API 方法文档注释

## 📥 安装升级 / Installation & Upgrade

```bash
# 通过 npm 安装最新版本 / Install latest version via npm
openclaw plugins install @dingtalk-real-ai/dingtalk-connector

# 或升级现有版本 / Or upgrade existing version
openclaw plugins update dingtalk-connector

# 通过 Git 安装 / Install via Git
openclaw plugins install https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector.git
```

## ⚠️ 升级注意事项 / Upgrade Notes

### 兼容性说明 / Compatibility Notes

- **向下兼容**：本次更新恢复了 0.7.0 之前版本的默认路由行为，对现有用户完全兼容  
  **Backward Compatible**: This update restores the default routing behavior of versions before 0.7.0, fully compatible with existing users
- **无需配置变更**：现有配置无需修改即可正常工作  
  **No Configuration Changes Required**: Existing configurations work without modification
- **推荐升级**：使用默认配置的用户强烈建议升级到此版本，以确保正确的 Agent 路由  
  **Recommended Upgrade**: Users with default configuration are strongly recommended to upgrade to this version to ensure correct Agent routing

### 迁移指南 / Migration Guide

如果您在 0.7.0 或 0.7.1 版本中遇到了默认路由问题，升级到此版本后：
If you encountered default routing issues in versions 0.7.0 or 0.7.1, after upgrading to this version:

1. **默认路由将自动恢复**：无需任何配置，默认路由将自动恢复到 `main` agent  
   **Default routing will be automatically restored**: No configuration needed, default routing will automatically restore to `main` agent
2. **检查 Agent 配置**：确认您的 Gateway 中 `main` agent 的配置是否正确  
   **Check Agent Configuration**: Verify that your Gateway's `main` agent configuration is correct
3. **验证路由**：升级后测试会话路由，确认消息正确路由到预期的 agent  
   **Verify Routing**: Test session routing after upgrade to confirm messages are correctly routed to the expected agent

## 🔗 相关链接 / Related Links

- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档 / Documentation](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)
- [问题反馈 / Issue Feedback](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)
- [Pull Request #108](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/108)

## 🙏 致谢 / Acknowledgments

感谢所有贡献者和用户的支持与反馈！
Thanks to all contributors and users for their support and feedback! 

---

**发布日期 / Release Date**：2026-03-09  
**版本号 / Version**：v0.7.3  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
