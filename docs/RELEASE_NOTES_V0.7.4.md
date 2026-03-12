# Release Notes - v0.7.4

## 🎉 功能增强版本 / Feature Enhancement Release

本次更新主要新增了按会话区分 Session 的功能，支持单聊、群聊、不同群分别维护独立会话，并提供了记忆隔离/共享的配置选项，让会话管理更加灵活和精细。

This update primarily adds session separation by conversation feature, supporting separate sessions for direct chat, group chat, and different groups, and provides memory isolation/sharing configuration options for more flexible and fine-grained session management.

## ✨ 新增功能 / Added Features

### 1. 按会话区分 Session / Session by Conversation

**功能描述 / Feature Description**：  
支持按单聊、群聊、不同群分别维护独立会话，单聊与群聊、不同群之间的对话上下文互不干扰。  
Support separate sessions for direct chat, group chat, and different groups; conversation context is isolated between DMs, group chats, and different groups.

**使用场景 / Use Cases**：
- ✅ 同一机器人在多个群中服务，希望每个群的对话互不干扰  
  Same bot serves multiple groups, with isolated conversations per group
- ✅ 用户既在私聊也在群聊中使用机器人，希望私聊与群聊上下文分离  
  Users interact with bot in both DMs and group chats, with separated contexts
- ✅ 不同群之间的对话历史完全隔离  
  Complete isolation of conversation history between different groups

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
Enabled by default, all users automatically get session isolation capability. To maintain old behavior (session per user), set `separateSessionByConversation: false`.

### 2. 记忆隔离/共享配置 / Memory Isolation/Sharing Configuration

**功能描述 / Feature Description**：  
新增 `sharedMemoryAcrossConversations` 配置，控制单 Agent 场景下是否在不同会话间共享记忆；默认 `false` 实现群聊与私聊、不同群之间的记忆隔离。  
Added `sharedMemoryAcrossConversations` option to control whether memory is shared across conversations in single-Agent mode; default `false` isolates memory between DMs, group chats, and different groups.

**配置选项 / Configuration Options**：
- `false`（默认）：不同群聊、群聊与私聊之间的记忆隔离，AI 不会混淆不同场景下的对话历史  
  `false` (default): Memory isolated between different groups and between DMs and groups, AI won't confuse conversation history across scenarios
- `true`：单 Agent 场景下，同一用户在不同会话间共享记忆  
  `true`: In single-Agent mode, same user shares memory across different sessions

**配置方式 / Configuration**：
```json5
{
  "channels": {
    "dingtalk-connector": {
      "sharedMemoryAcrossConversations": false  // 默认：false
    }
  }
}
```

**影响范围 / Impact**：  
默认关闭，确保不同场景下的记忆隔离。如需跨会话共享记忆，可设置 `sharedMemoryAcrossConversations: true`。  
Disabled by default, ensuring memory isolation across scenarios. To share memory across sessions, set `sharedMemoryAcrossConversations: true`.

### 3. Gateway Session 格式增强 / Gateway Session Format Enhancement

**功能描述 / Feature Description**：  
Session key 支持 `group:conversationId` 格式，便于 Gateway 识别群聊场景。  
Session key supports `group:conversationId` format for Gateway to identify group chat scenarios.

**技术细节 / Technical Details**：
- 单聊会话：使用 `direct:{userId}` 格式  
  Direct chat sessions: Use `direct:{userId}` format
- 群聊会话：使用 `group:{conversationId}` 格式  
  Group chat sessions: Use `group:{conversationId}` format
- Gateway 可以根据 Session key 格式识别会话类型  
  Gateway can identify session type based on Session key format

**影响范围 / Impact**：  
内部实现改进，不影响用户使用，但提高了 Gateway 对会话类型的识别能力。  
Internal implementation improvement, does not affect user usage, but improves Gateway's ability to identify session types.

### 4. X-OpenClaw-Memory-User 支持 / X-OpenClaw-Memory-User Support

**功能描述 / Feature Description**：  
向 Gateway 传递记忆归属用户标识，支持 Gateway 侧记忆管理。  
Pass memory user identifier to Gateway for memory management.

**技术细节 / Technical Details**：
- 在请求 Gateway 时，自动添加 `X-OpenClaw-Memory-User` header  
  Automatically add `X-OpenClaw-Memory-User` header when requesting Gateway
- Header 值为发送消息的用户 ID，便于 Gateway 进行记忆归属管理  
  Header value is the user ID who sent the message, facilitating Gateway's memory ownership management

**影响范围 / Impact**：  
内部实现改进，支持 Gateway 侧更精细的记忆管理能力。  
Internal implementation improvement, supporting Gateway-side fine-grained memory management capabilities.

## 📋 配置变更 / Configuration Changes

### 新增配置项 / New Configuration Options

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `separateSessionByConversation` | `boolean` | `true` | 是否按单聊/群聊/群区分 session |
| `sharedMemoryAcrossConversations` | `boolean` | `false` | 是否在不同会话间共享记忆 |

### 配置示例 / Configuration Example

```json5
{
  "channels": {
    "dingtalk-connector": {
      "enabled": true,
      "clientId": "dingxxxxxxxxx",
      "clientSecret": "your_secret_here",
      "separateSessionByConversation": true,      // 按会话区分 Session
      "sharedMemoryAcrossConversations": false    // 记忆隔离（默认）
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

- **向下兼容**：本次更新完全向下兼容，现有配置无需修改即可正常工作  
  **Backward Compatible**: This update is fully backward compatible, existing configurations work without modification
- **默认行为变更**：默认启用 `separateSessionByConversation`，会话将按单聊/群聊/群区分  
  **Default Behavior Change**: `separateSessionByConversation` is enabled by default, sessions will be separated by direct/group/different groups
- **如需旧行为**：如需保持按用户维度维护 session 的旧行为，可设置 `separateSessionByConversation: false`  
  **For Old Behavior**: To maintain old behavior of session per user, set `separateSessionByConversation: false`

### 迁移指南 / Migration Guide

升级到此版本后：
After upgrading to this version:

1. **默认启用会话隔离**：无需任何配置，会话将自动按单聊/群聊/群区分  
   **Session isolation enabled by default**: No configuration needed, sessions will automatically be separated by direct/group/different groups
2. **检查会话行为**：确认新的会话隔离行为是否符合预期  
   **Check session behavior**: Verify that the new session isolation behavior meets expectations
3. **配置记忆共享**：如需跨会话共享记忆，可设置 `sharedMemoryAcrossConversations: true`  
   **Configure memory sharing**: To share memory across sessions, set `sharedMemoryAcrossConversations: true`
4. **恢复旧行为**：如需恢复按用户维度维护 session 的旧行为，设置 `separateSessionByConversation: false`  
   **Restore old behavior**: To restore old behavior of session per user, set `separateSessionByConversation: false`

## 📋 技术细节 / Technical Details

### 内部实现变更 / Internal Implementation Changes

**变更前 / Before**：
- Session key 使用用户 ID：`{userId}`
- 所有会话共享同一个 Session，不区分单聊/群聊
- 记忆在所有会话间共享

**变更后 / After**：
- Session key 支持格式：
  - 单聊：`direct:{userId}`
  - 群聊：`group:{conversationId}`
- 默认按单聊/群聊/群区分 Session
- 默认记忆隔离，可通过配置共享

### 相关代码位置 / Related Code Locations

主要修改文件：
- `plugin.ts` - 核心逻辑修改

关键变更点：
- Session key 生成逻辑
- `streamFromGateway` 函数中的 Session 处理
- 记忆用户标识传递
- 配置项解析和验证

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
