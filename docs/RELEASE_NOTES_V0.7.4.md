# Release Notes - v0.7.4

## ✨ 功能增强版本 / Feature Enhancement Release

本次更新新增会话与记忆隔离功能，支持按单聊、群聊、不同群分别维护独立会话和记忆，确保同一用户在不同场景下的对话上下文互不干扰。

This update adds session and memory isolation functionality, supporting separate sessions and memories for direct chats, group chats, and different groups, ensuring conversation context isolation for the same user across different scenarios.

## ✨ 新增功能 / New Features

### 1. 按会话隔离 Session / Session Isolation by Conversation

**功能描述 / Feature Description**：  
支持按单聊、群聊、不同群分别维护独立的 session，单聊与群聊、不同群之间的对话上下文互不干扰。  
Support separate sessions for direct chat, group chat, and different groups; conversation context is isolated between DMs, group chats, and different groups.

**Session Key 格式 / Session Key Format**：
- **单聊 / Direct Chat**：`dingtalk-connector:accountId:senderId`  
  **Direct Chat**: `dingtalk-connector:accountId:senderId`
- **群聊 / Group Chat**：`dingtalk-connector:accountId:group:conversationId:senderId`  
  **Group Chat**: `dingtalk-connector:accountId:group:conversationId:senderId`

**配置方式 / Configuration**：

```json5
{
  "channels": {
    "dingtalk-connector": {
      "separateSessionByConversation": true  // 默认：true，按单聊/群聊/群区分 session
    }
  }
}
```

**影响范围 / Impact**：  
默认开启，新部署即按会话隔离 session。关闭后按用户维度维护 session，不区分单聊/群聊（兼容旧行为）。  
Default enabled, new deployments isolate sessions by conversation. When disabled, sessions are maintained by user dimension without distinguishing DMs/groups (compatible with old behavior).

### 2. 记忆隔离/共享配置 / Memory Isolation/Sharing Configuration

**功能描述 / Feature Description**：  
新增 `sharedMemoryAcrossConversations` 配置，控制单 Agent 场景下是否在不同会话间共享记忆。默认 `false` 实现群聊与私聊、不同群之间的记忆隔离。  
Added `sharedMemoryAcrossConversations` option to control whether memory is shared across conversations in single-Agent mode; default `false` isolates memory between DMs, group chats, and different groups.

**配置方式 / Configuration**：

```json5
{
  "channels": {
    "dingtalk-connector": {
      "sharedMemoryAcrossConversations": false  // 默认：false，记忆按 session 隔离
    }
  }
}
```

**记忆归属用户标识 / Memory User Identifier**：
- **`sharedMemoryAcrossConversations: false`**：`memoryUser = sessionKey`，每个 session 独立记忆  
  **`sharedMemoryAcrossConversations: false`**: `memoryUser = sessionKey`, each session has independent memory
- **`sharedMemoryAcrossConversations: true`**：`memoryUser = accountId`，所有会话共享记忆  
  **`sharedMemoryAcrossConversations: true`**: `memoryUser = accountId`, all conversations share memory

**影响范围 / Impact**：  
默认关闭，记忆按 session 隔离。开启后，单 Agent 场景下同一用户在不同会话间共享记忆。  
Default disabled, memory is isolated by session. When enabled, the same user shares memory across conversations in single-Agent mode.

### 3. Gateway Session 格式增强 / Gateway Session Format Enhancement

**功能描述 / Feature Description**：  
Session key 支持 `group:conversationId` 格式，便于 Gateway 识别群聊场景。  
Session key supports `group:conversationId` format for Gateway to identify group chat scenarios.

**技术细节 / Technical Details**：
- Gateway 通过检查 `:group:` 或 `:channel:` 识别群聊  
  Gateway identifies group chats by checking for `:group:` or `:channel:`
- 群聊 session key 格式：`dingtalk-connector:accountId:group:conversationId:senderId`  
  Group chat session key format: `dingtalk-connector:accountId:group:conversationId:senderId`

**影响范围 / Impact**：  
内部实现改进，提升 Gateway 对群聊场景的识别能力。  
Internal implementation improvement, enhancing Gateway's ability to identify group chat scenarios.

### 4. X-OpenClaw-Memory-User 支持 / X-OpenClaw-Memory-User Support

**功能描述 / Feature Description**：  
向 Gateway 传递记忆归属用户标识，支持 Gateway 侧记忆管理。  
Pass memory user identifier to Gateway for memory management.

**实现方式 / Implementation**：
- 通过 HTTP 请求头 `X-OpenClaw-Memory-User` 传递 `memoryUser`  
  Pass `memoryUser` via HTTP header `X-OpenClaw-Memory-User`
- `memoryUser` 的值根据 `sharedMemoryAcrossConversations` 配置决定  
  `memoryUser` value is determined by `sharedMemoryAcrossConversations` configuration

**影响范围 / Impact**：  
支持 Gateway 侧更精细的记忆管理，提升多会话场景下的记忆隔离能力。  
Supports finer-grained memory management on Gateway side, improving memory isolation in multi-session scenarios.

## 🐛 修复 / Fixes

### 1. 会话上下文混淆问题修复 / Session Context Confusion Fix

**问题描述 / Issue Description**：  
原先 session key 为 `dingtalk-connector:accountId:senderId`，同一用户在不同群聊、私聊共享同一 session，导致群 A 和群 B、私聊和群聊的对话上下文混在一起，无法实现按会话的上下文和记忆隔离。  
Previously, session key was `dingtalk-connector:accountId:senderId`, causing the same user to share the same session across different group chats and DMs, mixing conversation context between group A and group B, and between DMs and group chats, preventing session-based context and memory isolation.

**修复内容 / Fix**：
- 新增 `separateSessionByConversation` 配置（默认 `true`），按单聊/群聊/群区分 session  
  Added `separateSessionByConversation` option (default: `true`), separating sessions by direct/group/different groups
- 单聊使用 `dingtalk-connector:accountId:senderId` 格式  
  Direct chats use `dingtalk-connector:accountId:senderId` format
- 群聊使用 `dingtalk-connector:accountId:group:conversationId:senderId` 格式  
  Group chats use `dingtalk-connector:accountId:group:conversationId:senderId` format

**影响范围 / Impact**：  
影响所有用户。修复后，同一用户在不同群聊、私聊将拥有独立的 session，对话上下文不再混淆。  
Affects all users. After the fix, the same user will have independent sessions in different group chats and DMs, conversation context will no longer be confused.

## 🔧 配置更新 / Configuration Updates

### 新增配置项 / New Configuration Options

- **`separateSessionByConversation`**（类型：`boolean`，默认：`true`）- 是否按单聊/群聊/群区分 session  
  **`separateSessionByConversation`** (type: `boolean`, default: `true`) - Whether to separate sessions by direct/group/different groups
- **`sharedMemoryAcrossConversations`**（类型：`boolean`，默认：`false`）- 单 Agent 场景下是否在不同会话间共享记忆；`false` 时不同群聊、群聊与私聊记忆隔离  
  **`sharedMemoryAcrossConversations`** (type: `boolean`, default: `false`) - Whether to share memory across conversations in single-Agent mode; when `false`, memory is isolated between different groups and between DMs and groups

## 📋 技术细节 / Technical Details

### Session Key 构建逻辑 / Session Key Construction Logic

**变更前 / Before**：
- Session key 格式：`dingtalk-connector:accountId:senderId`
- 同一用户在不同群聊、私聊共享同一 session

**变更后 / After**：
- 单聊 session key：`dingtalk-connector:accountId:senderId`
- 群聊 session key：`dingtalk-connector:accountId:group:conversationId:senderId`
- 通过 `separateSessionByConversation` 配置控制是否启用（默认启用）

### Memory User 传递逻辑 / Memory User Passing Logic

**实现方式 / Implementation**：
- 通过 `X-OpenClaw-Memory-User` HTTP 请求头传递 `memoryUser`
- `sharedMemoryAcrossConversations: false` 时，`memoryUser = sessionKey`
- `sharedMemoryAcrossConversations: true` 时，`memoryUser = accountId`

### 相关代码位置 / Related Code Locations

主要修改文件：
- `plugin.ts` - 核心逻辑修改
- `README.md` - 文档更新
- `CHANGELOG.md` - 变更日志更新

关键变更点：
- `getSessionScope` 函数：计算 session scope（单聊/群聊）
- `buildSessionIdForGateway` 函数：构建 Gateway 可识别的 session key
- `getSessionKey` 函数：获取或创建用户 session key
- `handleDingTalkMessage` 函数：处理消息时传递 `X-OpenClaw-Memory-User` header

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

- **向下兼容**：默认行为与旧版本一致（`separateSessionByConversation` 默认 `true`，但旧配置未显式设置时行为与默认值一致）  
  **Backward Compatible**: Default behavior is consistent with old versions (`separateSessionByConversation` defaults to `true`, but when old configurations are not explicitly set, behavior matches default values)
- **推荐升级**：使用多群聊或私聊+群聊混合场景的用户强烈建议升级到此版本，以获得更好的会话隔离体验  
  **Recommended Upgrade**: Users in multi-group chat or DM+group chat mixed scenarios are strongly recommended to upgrade to this version for better session isolation experience
- **配置迁移**：现有配置无需修改即可正常工作，新功能默认启用  
  **Configuration Migration**: Existing configurations work without modification, new features are enabled by default

### 迁移指南 / Migration Guide

如果您希望保持旧版本的 session 行为（不按会话隔离），可以设置：

If you want to maintain old version's session behavior (no session isolation), you can set:

```json5
{
  "channels": {
    "dingtalk-connector": {
      "separateSessionByConversation": false  // 关闭按会话隔离
    }
  }
}
```

如果您希望在不同会话间共享记忆，可以设置：

If you want to share memory across conversations, you can set:

```json5
{
  "channels": {
    "dingtalk-connector": {
      "sharedMemoryAcrossConversations": true  // 开启跨会话记忆共享
    }
  }
}
```

### 适用场景 / Use Cases

- ✅ **同一机器人在多个群中服务**：希望每个群的对话互不干扰  
  **Same bot serving multiple groups**: Want conversations in each group to not interfere with each other
- ✅ **用户既在私聊也在群聊中使用机器人**：希望私聊与群聊上下文分离  
  **User uses bot in both DMs and group chats**: Want DM and group chat contexts separated
- ✅ **需要跨会话共享记忆**：可设置 `sharedMemoryAcrossConversations: true`  
  **Need to share memory across conversations**: Can set `sharedMemoryAcrossConversations: true`

### 注意事项 / Important Notes

⚠️ **记忆存储说明**：如果用户的描述中存在"记住""保存"等字样，模型可能会绕过 Gateway，直接存到本地文件系统，此时配置不生效（此行为需要在模型层面设置，而非插件层面）。  
**Memory Storage Note**: If user descriptions contain words like "remember" or "save", the model may bypass Gateway and save directly to local file system, in which case the configuration does not take effect (this behavior needs to be set at the model level, not the plugin level).

## 🔗 相关链接 / Related Links

- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档 / Documentation](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)
- [问题反馈 / Issue Feedback](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)
- [Pull Request #124](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/124)

## 🙏 致谢 / Acknowledgments

感谢所有贡献者和用户的支持与反馈！  
Thanks to all contributors and users for their support and feedback!

---

**发布日期 / Release Date**：2026-03-10  
**版本号 / Version**：v0.7.4  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
