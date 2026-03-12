# Release Notes - v0.7.5

## 🔧 稳定性修复与架构优化版本 / Stability Fixes & Architecture Optimization Release

本次更新主要修复了 Stream 客户端频繁重连和连接关闭不完整的问题，并重构了会话管理机制，采用 OpenClaw Gateway 统一的 session.dmScope 机制，提升了系统的稳定性和可维护性。

This update primarily fixes Stream client frequent reconnection and incomplete connection closure issues, and refactors the session management mechanism to use OpenClaw Gateway's unified session.dmScope mechanism, improving system stability and maintainability.

## 🐛 修复 / Fixes

### 1. Stream 客户端频繁重连问题修复 / Stream Client Frequent Reconnection Fix

**问题描述 / Issue Description**：  
`DWClient` 内置的 `autoReconnect` 与框架的 health-monitor 重连机制冲突，导致客户端频繁重连，影响系统稳定性。  
`DWClient` built-in `autoReconnect` conflicts with framework's health-monitor reconnection mechanism, causing frequent client reconnections and affecting system stability.

**修复内容 / Fix**：
- 禁用 `DWClient` 内置的 `autoReconnect`  
  Disabled `DWClient` built-in `autoReconnect`
- 由框架的 health-monitor 统一管理重连逻辑  
  Reconnection is now managed by framework's health-monitor
- 避免双重重连机制冲突  
  Avoid dual reconnection mechanism conflict

**影响范围 / Impact**：  
影响所有使用 Stream 模式的用户。修复后，重连逻辑更加稳定，不再出现频繁重连的问题。  
Affects all users using Stream mode. After the fix, reconnection logic is more stable, no longer experiencing frequent reconnection issues.

### 2. 连接关闭不完整问题修复 / Incomplete Connection Closure Fix

**问题描述 / Issue Description**：  
`stop()` 方法未正确关闭 WebSocket 连接，导致资源泄漏和连接状态异常。  
`stop()` method did not correctly close WebSocket connection, causing resource leaks and connection state anomalies.

**修复内容 / Fix**：
- `stop()` 方法现在正确调用 `client.disconnect()` 关闭 WebSocket 连接  
  `stop()` method now correctly calls `client.disconnect()` to close WebSocket connection
- 确保连接资源正确释放  
  Ensure connection resources are properly released

**影响范围 / Impact**：  
影响所有使用连接器的用户。修复后，连接关闭更加完整，避免资源泄漏。  
Affects all users using the connector. After the fix, connection closure is more complete, avoiding resource leaks.

### 3. Gateway 端口连接修复 / Gateway Port Connection Fix

**问题描述 / Issue Description**：  
修改 gateway 端口后无法连接的问题。  
Issue where connection fails after modifying gateway port.

**修复内容 / Fix**：
- 修复端口配置更新后的连接逻辑  
  Fixed connection logic after port configuration update
- 确保端口变更后能够正确连接  
  Ensure correct connection after port changes

**影响范围 / Impact**：  
影响修改了 Gateway 端口的用户。修复后，端口变更后能够正常连接。  
Affects users who modified Gateway port. After the fix, connection works normally after port changes.

## 🔄 重构 / Refactoring

### 1. OpenClaw session.dmScope 机制 / OpenClaw session.dmScope Mechanism

**重构内容 / Refactoring**：
- 会话管理由 OpenClaw Gateway 统一处理  
  Session management is now handled by OpenClaw Gateway
- 插件不再内部管理会话超时  
  Plugin no longer manages session timeout internally
- 使用 Gateway 的 `session.reset.idleMinutes` 配置控制会话超时  
  Use Gateway's `session.reset.idleMinutes` configuration to control session timeout

**优势 / Benefits**：
- ✅ 统一会话管理，减少重复逻辑  
  Unified session management, reducing duplicate logic
- ✅ 配置更加集中和标准化  
  More centralized and standardized configuration
- ✅ 降低插件复杂度，提高可维护性  
  Reduce plugin complexity, improve maintainability

**影响范围 / Impact**：  
架构层面的改进，不影响用户使用，但提高了系统的可维护性和一致性。  
Architecture-level improvement, does not affect user usage, but improves system maintainability and consistency.

### 2. SessionContext 标准化 / SessionContext Standardization

**重构内容 / Refactoring**：
- 使用 OpenClaw 标准的 SessionContext JSON 格式传递会话上下文  
  Use OpenClaw standard SessionContext JSON format for session context
- 统一会话上下文的数据结构  
  Unify session context data structure
- 提高与 Gateway 的兼容性  
  Improve compatibility with Gateway

**优势 / Benefits**：
- ✅ 标准化格式，便于 Gateway 解析和处理  
  Standardized format, easier for Gateway to parse and process
- ✅ 提高数据一致性和可预测性  
  Improve data consistency and predictability
- ✅ 便于未来扩展和维护  
  Facilitate future expansion and maintenance

**影响范围 / Impact**：  
内部实现改进，不影响用户使用，但提高了与 Gateway 的兼容性和数据一致性。  
Internal implementation improvement, does not affect user usage, but improves compatibility with Gateway and data consistency.

## 📋 配置变更 / Configuration Changes

### 新增配置项 / New Configuration Options

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `groupSessionScope` | `'group'` \| `'group_sender'` | `'group'` | 群聊会话隔离策略（仅当 separateSessionByConversation=true 时生效）：`group`=群共享，`group_sender`=群内用户独立 |

### 废弃配置项 / Deprecated Configuration Options

| 配置项 | 状态 | 替代方案 | 说明 |
|--------|------|----------|------|
| `sessionTimeout` | ⚠️ 已废弃 | Gateway 的 `session.reset.idleMinutes` | 会话超时由 OpenClaw Gateway 统一管理，详见 [Gateway 配置文档](https://docs.openclaw.ai/gateway/configuration) |

### 配置示例 / Configuration Example

```json5
{
  "channels": {
    "dingtalk-connector": {
      "enabled": true,
      "clientId": "dingxxxxxxxxx",
      "clientSecret": "your_secret_here",
      "separateSessionByConversation": true,
      "groupSessionScope": "group",  // 新增：群聊会话隔离策略
      // "sessionTimeout": 30  // ⚠️ 已废弃，请使用 Gateway 配置
    }
  },
  // Gateway 配置示例
  "gateway": {
    "session": {
      "reset": {
        "idleMinutes": 30  // 会话超时配置
      }
    }
  }
}
```

### 群聊会话隔离策略说明 / Group Session Scope Explanation

`groupSessionScope` 配置仅在 `separateSessionByConversation=true` 时生效：

- **`group`**（默认）：整个群共享一个会话，群内所有用户共用同一个对话上下文  
  **`group`** (default): Entire group shares one session, all users in the group share the same conversation context
- **`group_sender`**：群内每个用户独立会话，不同用户的对话上下文互不干扰  
  **`group_sender`**: Each user in the group has an independent session, conversation contexts of different users do not interfere

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

- **向下兼容**：本次更新完全向下兼容，现有配置无需修改即可正常工作  
  **Backward Compatible**: This update is fully backward compatible, existing configurations work without modification
- **sessionTimeout 废弃**：旧配置 `sessionTimeout` 仍可使用，但会打印废弃警告日志，建议迁移到 Gateway 配置  
  **sessionTimeout Deprecated**: Old config `sessionTimeout` still works but will print deprecation warning, recommend migrating to Gateway configuration
- **推荐升级**：使用 Stream 模式的用户强烈建议升级到此版本，以修复重连和连接关闭问题  
  **Recommended Upgrade**: Users using Stream mode are strongly recommended to upgrade to this version to fix reconnection and connection closure issues

### 迁移指南 / Migration Guide

升级到此版本后：
After upgrading to this version:

1. **检查重连行为**：确认重连逻辑是否正常，不再出现频繁重连  
   **Check reconnection behavior**: Verify reconnection logic is normal, no longer experiencing frequent reconnections
2. **迁移 sessionTimeout**：如有使用 `sessionTimeout` 配置，建议迁移到 Gateway 的 `session.reset.idleMinutes` 配置  
   **Migrate sessionTimeout**: If using `sessionTimeout` configuration, recommend migrating to Gateway's `session.reset.idleMinutes` configuration
3. **配置群聊会话隔离**：如需群内用户独立会话，可设置 `groupSessionScope: "group_sender"`  
   **Configure group session isolation**: To have independent sessions per user in group, set `groupSessionScope: "group_sender"`
4. **验证连接关闭**：确认 `stop()` 方法能够正确关闭连接  
   **Verify connection closure**: Verify that `stop()` method correctly closes connection

### sessionTimeout 迁移步骤 / sessionTimeout Migration Steps

**迁移前 / Before**：
```json5
{
  "channels": {
    "dingtalk-connector": {
      "sessionTimeout": 30  // ⚠️ 已废弃
    }
  }
}
```

**迁移后 / After**：
```json5
{
  "channels": {
    "dingtalk-connector": {
      // 移除 sessionTimeout 配置
    }
  },
  "gateway": {
    "session": {
      "reset": {
        "idleMinutes": 30  // 使用 Gateway 配置
      }
    }
  }
}
```

## 📋 技术细节 / Technical Details

### 内部实现变更 / Internal Implementation Changes

**变更前 / Before**：
- `DWClient` 启用 `autoReconnect`，与框架重连机制冲突
- 插件内部管理会话超时
- `stop()` 方法未正确关闭 WebSocket 连接
- SessionContext 格式不统一

**变更后 / After**：
- `DWClient` 禁用 `autoReconnect`，由框架统一管理重连
- 会话超时由 Gateway 统一管理
- `stop()` 方法正确调用 `client.disconnect()` 关闭连接
- SessionContext 使用 OpenClaw 标准格式

### 相关代码位置 / Related Code Locations

主要修改文件：
- `plugin.ts` - 核心逻辑修改

关键变更点：
- `DWClient` 初始化时的 `autoReconnect` 配置
- `stop()` 方法中的连接关闭逻辑
- SessionContext 格式标准化
- 会话超时配置移除

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
