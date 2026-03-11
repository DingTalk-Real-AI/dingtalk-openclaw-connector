# Release Notes - v0.7.4

## 🎉 会话隔离与记忆管理增强版本 / Session Isolation & Memory Management Enhancement Release

本次更新引入了强大的会话隔离和记忆管理功能，支持按单聊、群聊、不同群分别维护独立会话，并提供了灵活的记忆共享配置选项。

This update introduces powerful session isolation and memory management features, supporting separate sessions for direct chat, group chat, and different groups, with flexible memory sharing configuration options.

## ✨ 新增功能 / Added Features

### 1. 按会话区分 Session / Session by Conversation

**功能描述 / Feature Description**：  
支持按单聊、群聊、不同群分别维护独立会话，单聊与群聊、不同群之间的对话上下文互不干扰。  
Support separate sessions for direct chat, group chat, and different groups; conversation context is isolated between DMs, group chats, and different groups.

**使用场景 / Use Cases**：
- ✅ 同一机器人在多个群中服务，希望每个群的对话互不干扰  
  Same bot serving multiple groups, with isolated conversations per group
- ✅ 用户既在私聊也在群聊中使用机器人，希望私聊与群聊上下文分离  
  Users using the bot in both DMs and group chats, with separated contexts
- ✅ 不同群聊之间的对话历史完全隔离  
  Complete conversation history isolation between different groups

**配置方式 / Configuration**：
```json5
{
  "channels": {
    "dingtalk-connector": {
      "separateSessionByConversation": true  // 默认：true
    }
  }
}
```

**影响范围 / Impact**：  
默认启用，所有用户自动获得会话隔离能力。如需兼容旧行为（按用户维度维护 session），可设置 `separateSessionByConversation: false`。  
Enabled by default, all users automatically get session isolation capability. To maintain backward compatibility (user-level sessions), set `separateSessionByConversation: false`.

### 2. 记忆隔离/共享配置 / Memory Isolation/Sharing Configuration

**功能描述 / Feature Description**：  
新增 `sharedMemoryAcrossConversations` 配置，控制单 Agent 场景下是否在不同会话间共享记忆。默认 `false` 实现群聊与私聊、不同群之间的记忆隔离。  
Added `sharedMemoryAcrossConversations` option to control whether memory is shared across conversations in single-Agent mode. Default `false` isolates memory between DMs, group chats, and different groups.

**使用场景 / Use Cases**：
- ✅ **记忆隔离**（默认）：不同群聊、群聊与私聊之间的记忆隔离，AI 不会混淆不同场景下的对话历史  
  **Memory Isolation** (default): Memory isolated between different groups and between DMs and groups, AI won't confuse conversation history across scenarios
- ✅ **记忆共享**：单 Agent 场景下，同一用户在不同会话间共享记忆，AI 可以记住用户在不同场景下的偏好  
  **Memory Sharing**: In single-Agent mode, same user shares memory across conversations, AI can remember user preferences across scenarios

**配置方式 / Configuration**：
```json5
{
  "channels": {
    "dingtalk-connector": {
      "sharedMemoryAcrossConversations": false  // 默认：false（记忆隔离）
    }
  }
}
```

**影响范围 / Impact**：  
默认关闭记忆共享，确保不同场景下的记忆隔离。需要跨会话共享记忆的用户可设置 `sharedMemoryAcrossConversations: true`。  
Memory sharing disabled by default, ensuring memory isolation across scenarios. Users needing cross-conversation memory sharing can set `sharedMemoryAcrossConversations: true`.

### 3. Gateway Session 格式增强 / Gateway Session Format Enhancement

**功能描述 / Feature Description**：  
Session key 支持 `group:conversationId` 格式，便于 Gateway 识别群聊场景，实现更精确的会话管理。  
Session key supports `group:conversationId` format for Gateway to identify group chat scenarios, enabling more precise session management.

**技术细节 / Technical Details**：
- 单聊会话：使用 `direct:{senderId}` 格式  
  Direct chat sessions: Use `direct:{senderId}` format
- 群聊会话：使用 `group:{conversationId}` 格式  
  Group chat sessions: Use `group:{conversationId}` format
- Gateway 可以根据会话格式自动识别会话类型  
  Gateway can automatically identify session types based on session format

**影响范围 / Impact**：  
内部实现改进，提升 Gateway 的会话识别能力，用户无需额外配置。  
Internal implementation improvement, enhances Gateway's session identification capability, no additional configuration required.

### 4. X-OpenClaw-Memory-User 支持 / X-OpenClaw-Memory-User Support

**功能描述 / Feature Description**：  
向 Gateway 传递记忆归属用户标识，支持 Gateway 侧记忆管理，实现更精细的记忆控制。  
Pass memory user identifier to Gateway for memory management, enabling finer-grained memory control.

**技术细节 / Technical Details**：
- 在请求 Gateway 时，自动添加 `X-OpenClaw-Memory-User` header  
  Automatically add `X-OpenClaw-Memory-User` header when requesting Gateway
- Header 值为发送者 ID，Gateway 可以根据用户 ID 管理记忆  
  Header value is sender ID, Gateway can manage memory based on user ID
- 支持记忆隔离和共享的灵活配置  
  Supports flexible configuration for memory isolation and sharing

**影响范围 / Impact**：  
内部实现改进，增强 Gateway 的记忆管理能力，用户无需额外配置。  
Internal implementation improvement, enhances Gateway's memory management capability, no additional configuration required.

## 📋 配置说明 / Configuration

### 新增配置项 / New Configuration Options

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `separateSessionByConversation` | `boolean` | `true` | 是否按单聊/群聊/群区分 session |
| `sharedMemoryAcrossConversations` | `boolean` | `false` | 单 Agent 场景下是否在不同会话间共享记忆 |

### 配置示例 / Configuration Example

```json5
{
  "channels": {
    "dingtalk-connector": {
      "enabled": true,
      "clientId": "dingxxxxxxxxx",
      "clientSecret": "your_secret_here",
      // 会话隔离配置
      "separateSessionByConversation": true,  // 按单聊/群聊/群区分 session
      // 记忆管理配置
      "sharedMemoryAcrossConversations": false  // 不同会话间记忆隔离
    }
  }
}
```

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
- **默认行为变更**：默认启用 `separateSessionByConversation: true`，会话将按单聊/群聊/群区分  
  **Default Behavior Change**: `separateSessionByConversation: true` enabled by default, sessions will be separated by direct/group/different groups
- **推荐升级**：所有用户建议升级到此版本，以获得更好的会话隔离和记忆管理能力  
  **Recommended Upgrade**: All users are recommended to upgrade to this version for better session isolation and memory management

### 迁移指南 / Migration Guide

如果您希望保持旧的行为（按用户维度维护 session，不区分单聊/群聊），可以设置：
If you want to maintain old behavior (user-level sessions, no distinction between DMs and group chats), you can set:

```json5
{
  "channels": {
    "dingtalk-connector": {
      "separateSessionByConversation": false
    }
  }
}
```

### 行为对比 / Behavior Comparison

| 配置 | 会话隔离策略 | 适用场景 |
|------|-------------|---------|
| `separateSessionByConversation: true`（默认） | 按单聊/群聊/群区分 | 多群服务、私聊与群聊分离 |
| `separateSessionByConversation: false` | 按用户维度维护 | 兼容旧行为，统一用户会话 |

| 配置 | 记忆策略 | 适用场景 |
|------|---------|---------|
| `sharedMemoryAcrossConversations: false`（默认） | 记忆隔离 | 不同场景记忆独立 |
| `sharedMemoryAcrossConversations: true` | 记忆共享 | 跨场景记忆共享 |

## 📋 技术细节 / Technical Details

### 内部实现变更 / Internal Implementation Changes

**变更前 / Before**：
- Session key 使用简单的用户 ID 格式
- 所有会话共享相同的记忆空间
- 无法区分单聊和群聊场景

**变更后 / After**：
- Session key 支持 `direct:{senderId}` 和 `group:{conversationId}` 格式
- 支持按会话隔离记忆，或跨会话共享记忆
- Gateway 可以根据会话格式自动识别会话类型
- 通过 `X-OpenClaw-Memory-User` header 传递记忆归属用户

### 相关代码位置 / Related Code Locations

主要修改文件：
- `plugin.ts` - 核心逻辑修改

关键变更点：
- `buildSessionContext` 函数 - 构建标准会话上下文
- Session key 生成逻辑 - 支持 `direct:` 和 `group:` 前缀
- Gateway 请求逻辑 - 添加 `X-OpenClaw-Memory-User` header
- 配置解析逻辑 - 新增 `separateSessionByConversation` 和 `sharedMemoryAcrossConversations` 配置项

## 🔗 相关链接 / Related Links

- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档 / Documentation](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)
- [问题反馈 / Issue Feedback](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)

## 🙏 致谢 / Acknowledgments

感谢所有贡献者和用户的支持与反馈！
Thanks to all contributors and users for their support and feedback!

---

**发布日期 / Release Date**：2026-03-09  
**版本号 / Version**：v0.7.4  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
