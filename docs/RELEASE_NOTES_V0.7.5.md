# Release Notes - v0.7.5

## 🔧 连接稳定性与架构优化版本 / Connection Stability & Architecture Optimization Release

本次更新主要修复了 Stream 客户端频繁重连问题，优化了连接关闭机制，并重构了会话管理架构，使其完全遵循 OpenClaw Gateway 的标准机制。

This update primarily fixes Stream client frequent reconnection issues, optimizes connection closure mechanism, and refactors session management architecture to fully comply with OpenClaw Gateway's standard mechanisms.

## 🐛 修复 / Fixes

### 1. Stream 客户端频繁重连问题修复 / Stream Client Frequent Reconnection Fix

**问题描述 / Issue Description**：  
`DWClient` 内置的 `autoReconnect` 机制与框架的 health-monitor 重连机制冲突，导致客户端频繁重连，影响连接稳定性。  
The built-in `autoReconnect` mechanism of `DWClient` conflicts with the framework's health-monitor reconnection mechanism, causing frequent client reconnections and affecting connection stability.

**修复内容 / Fix**：
- 禁用 `DWClient` 内置的 `autoReconnect`，由框架的 health-monitor 统一管理重连逻辑  
  Disabled `DWClient` built-in `autoReconnect`, reconnection is now managed by framework's health-monitor
- 避免双重重连机制冲突，提升连接稳定性  
  Avoid dual reconnection mechanism conflict, improve connection stability
- 统一重连策略，确保重连行为一致  
  Unified reconnection strategy, ensure consistent reconnection behavior

**影响范围 / Impact**：  
影响所有使用 Stream 模式的用户。修复后，连接将更加稳定，不再出现频繁重连问题。  
Affects all users using Stream mode. After the fix, connections will be more stable, no more frequent reconnection issues.

### 2. 连接关闭不完整问题修复 / Incomplete Connection Closure Fix

**问题描述 / Issue Description**：  
`stop()` 方法未正确调用 `client.disconnect()` 关闭 WebSocket 连接，导致连接资源未完全释放。  
The `stop()` method did not correctly call `client.disconnect()` to close WebSocket connection, causing connection resources not being fully released.

**修复内容 / Fix**：
- `stop()` 方法现在正确调用 `client.disconnect()` 关闭 WebSocket 连接  
  `stop()` method now correctly calls `client.disconnect()` to close WebSocket connection
- 确保连接资源完全释放，避免资源泄漏  
  Ensure connection resources are fully released, avoid resource leaks
- 改进连接关闭流程，确保优雅关闭  
  Improve connection closure process, ensure graceful shutdown

**影响范围 / Impact**：  
影响所有使用 Stream 模式的用户。修复后，连接关闭将更加完整，避免资源泄漏。  
Affects all users using Stream mode. After the fix, connection closure will be more complete, avoiding resource leaks.

## 🔧 重构 / Refactoring

### 1. OpenClaw session.dmScope 机制 / OpenClaw session.dmScope Mechanism

**改进内容 / Improvements**：  
会话管理由 OpenClaw Gateway 统一处理，插件不再内部管理会话超时。遵循 OpenClaw 标准架构，提升系统一致性和可维护性。  
Session management is now handled by OpenClaw Gateway, plugin no longer manages session timeout internally. Follows OpenClaw standard architecture, improves system consistency and maintainability.

**技术细节 / Technical Details**：
- 移除插件内部的会话超时管理逻辑  
  Removed internal session timeout management logic from plugin
- 使用 OpenClaw Gateway 的 `session.reset.idleMinutes` 配置控制会话超时  
  Use OpenClaw Gateway's `session.reset.idleMinutes` configuration to control session timeout
- 遵循 OpenClaw session.dmScope 机制，让 Gateway 统一处理会话隔离  
  Follow OpenClaw session.dmScope mechanism, let Gateway handle session isolation uniformly

**影响范围 / Impact**：  
架构改进，提升系统一致性和可维护性。用户需要在 Gateway 配置中设置 `session.reset.idleMinutes` 来控制会话超时。  
Architecture improvement, improves system consistency and maintainability. Users need to set `session.reset.idleMinutes` in Gateway configuration to control session timeout.

### 2. SessionContext 标准化 / SessionContext Standardization

**改进内容 / Improvements**：  
使用 OpenClaw 标准的 SessionContext JSON 格式传递会话上下文，确保与 Gateway 的完全兼容。  
Use OpenClaw standard SessionContext JSON format for session context, ensuring full compatibility with Gateway.

**技术细节 / Technical Details**：
- SessionContext 遵循 OpenClaw 标准格式  
  SessionContext follows OpenClaw standard format
- 包含 `channel`、`accountId`、`chatType`、`peerId`、`conversationId` 等标准字段  
  Includes standard fields like `channel`, `accountId`, `chatType`, `peerId`, `conversationId`
- 支持 `groupSessionScope` 配置，控制群聊会话隔离策略  
  Supports `groupSessionScope` configuration to control group chat session isolation strategy

**影响范围 / Impact**：  
内部实现改进，提升与 Gateway 的兼容性，用户无需额外配置。  
Internal implementation improvement, improves compatibility with Gateway, no additional configuration required.

## 📋 配置变更 / Configuration Changes

### 新增配置项 / New Configuration Options

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `groupSessionScope` | `'group'` \| `'group_sender'` | `'group'` | 群聊会话隔离策略（仅当 `separateSessionByConversation=true` 时生效）：`group`=群共享，`group_sender`=群内用户独立 |

### 废弃配置项 / Deprecated Configuration Options

| 配置项 | 状态 | 替代方案 | 说明 |
|--------|------|---------|------|
| `sessionTimeout` | ⚠️ 已废弃 | Gateway 的 `session.reset.idleMinutes` | 会话超时由 OpenClaw Gateway 统一管理，详见 [Gateway 配置文档](https://docs.openclaw.ai/gateway/configuration) |

### 配置示例 / Configuration Example

```json5
{
  "channels": {
    "dingtalk-connector": {
      "enabled": true,
      "clientId": "dingxxxxxxxxx",
      "clientSecret": "your_secret_here",
      // 群聊会话隔离策略（仅当 separateSessionByConversation=true 时生效）
      "groupSessionScope": "group",  // 'group'=群共享（默认），'group_sender'=群内用户独立
      // ⚠️ 已废弃：sessionTimeout
      // 请使用 Gateway 的 session.reset.idleMinutes 配置
    }
  }
}
```

### Gateway 配置示例 / Gateway Configuration Example

```json5
{
  "session": {
    "reset": {
      "idleMinutes": 30  // 会话超时时间（分钟）
    }
  }
}
```

## ⚠️ 向后兼容 / Backward Compatibility

### 兼容性说明 / Compatibility Notes

- **旧配置兼容**：旧配置 `sessionTimeout` 仍可使用，但会打印废弃警告日志  
  **Old Config Compatible**: Old config `sessionTimeout` still works but will print deprecation warning
- **推荐迁移**：建议尽快迁移到 Gateway 的 `session.reset.idleMinutes` 配置  
  **Recommended Migration**: Recommended to migrate to Gateway's `session.reset.idleMinutes` configuration as soon as possible
- **无需立即迁移**：现有配置无需立即修改，但建议在下次配置更新时迁移  
  **No Immediate Migration Required**: Existing configurations don't need immediate modification, but recommended to migrate during next configuration update

### 迁移指南 / Migration Guide

如果您当前使用了 `sessionTimeout` 配置，请按以下步骤迁移：
If you are currently using `sessionTimeout` configuration, please migrate as follows:

1. **移除插件配置中的 `sessionTimeout`**  
   **Remove `sessionTimeout` from plugin configuration**
   ```json5
   {
     "channels": {
       "dingtalk-connector": {
         // 移除这行：❌ "sessionTimeout": 30
       }
     }
   }
   ```

2. **在 Gateway 配置中添加 `session.reset.idleMinutes`**  
   **Add `session.reset.idleMinutes` to Gateway configuration**
   ```json5
   {
     "session": {
       "reset": {
         "idleMinutes": 30  // 原 sessionTimeout 的值
       }
     }
   }
   ```

3. **重启 Gateway 和 Connector**  
   **Restart Gateway and Connector**

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

- **向下兼容**：本次更新完全向后兼容，现有配置无需修改即可正常工作  
  **Backward Compatible**: This update is fully backward compatible, existing configurations work without modification
- **推荐升级**：所有用户建议升级到此版本，以获得更好的连接稳定性和架构一致性  
  **Recommended Upgrade**: All users are recommended to upgrade to this version for better connection stability and architecture consistency
- **配置迁移**：使用 `sessionTimeout` 的用户建议迁移到 Gateway 配置，但非必需  
  **Configuration Migration**: Users using `sessionTimeout` are recommended to migrate to Gateway configuration, but not required

### 升级后验证 / Post-Upgrade Verification

升级到此版本后，建议进行以下验证：
After upgrading to this version, it is recommended to verify the following:

1. **检查连接稳定性**：观察是否还有频繁重连问题  
   **Check Connection Stability**: Observe if there are still frequent reconnection issues
2. **验证连接关闭**：停止服务时，确认连接正确关闭  
   **Verify Connection Closure**: When stopping service, confirm connections are properly closed
3. **测试会话超时**：确认会话超时功能正常工作（如果配置了 Gateway 的 `session.reset.idleMinutes`）  
   **Test Session Timeout**: Confirm session timeout works correctly (if Gateway's `session.reset.idleMinutes` is configured)

## 📋 技术细节 / Technical Details

### 内部实现变更 / Internal Implementation Changes

**变更前 / Before**：
- `DWClient` 启用 `autoReconnect`，与框架的 health-monitor 冲突
- `stop()` 方法未调用 `client.disconnect()`
- 插件内部管理会话超时
- SessionContext 格式不标准

**变更后 / After**：
- `DWClient` 禁用 `autoReconnect`，由框架统一管理重连
- `stop()` 方法正确调用 `client.disconnect()` 关闭连接
- 会话超时由 Gateway 的 `session.reset.idleMinutes` 控制
- SessionContext 使用 OpenClaw 标准格式
- 支持 `groupSessionScope` 配置，控制群聊会话隔离策略

### 相关代码位置 / Related Code Locations

主要修改文件：
- `plugin.ts` - 核心逻辑修改

关键变更点：
- `DWClient` 初始化 - 禁用 `autoReconnect`
- `stop()` 方法 - 添加 `client.disconnect()` 调用
- 会话超时管理 - 移除内部管理逻辑
- `buildSessionContext` 函数 - 使用标准 SessionContext 格式
- 配置解析逻辑 - 新增 `groupSessionScope`，废弃 `sessionTimeout`

## 🔗 相关链接 / Related Links

- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档 / Documentation](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)
- [Gateway 配置文档 / Gateway Configuration](https://docs.openclaw.ai/gateway/configuration)
- [问题反馈 / Issue Feedback](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)

## 🙏 致谢 / Acknowledgments

感谢所有贡献者和用户的支持与反馈！
Thanks to all contributors and users for their support and feedback!

---

**发布日期 / Release Date**：2026-03-10  
**版本号 / Version**：v0.7.5  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
