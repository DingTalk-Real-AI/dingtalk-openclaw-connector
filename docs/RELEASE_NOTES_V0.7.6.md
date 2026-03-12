# Release Notes - v0.7.6

## 🔧 修复版本 / Bug Fix Release

本次更新修复了 Gateway 端口连接和新会话命令的问题，确保配置中的 Gateway 端口能够正确生效，并修复了新会话命令未真正清理会话的 bug。

This update fixes Gateway port connection and new session command issues, ensuring that the Gateway port configured in settings takes effect correctly, and fixes the bug where new session commands did not actually clear sessions.

## 🐛 修复 / Fixes

### Gateway 端口连接修复 / Gateway Port Connection Fix

**问题描述 / Issue Description**：  
当用户在配置中指定了 Gateway 端口（`gateway.port`）后，连接器仍然使用运行时检测到的端口，导致无法连接到正确配置的 Gateway 端口。  
When users specify Gateway port (`gateway.port`) in configuration, the connector still uses the runtime-detected port, causing connection failures to the correctly configured Gateway port.

**修复内容 / Fix**：
- 在 `streamFromGateway` 函数中添加 `gatewayPort` 参数支持  
  Added `gatewayPort` parameter support in `streamFromGateway` function
- 优先使用配置中的 `gateway.port`，其次使用运行时检测的端口，最后使用默认端口 18789  
  Prioritize `gateway.port` from configuration, then use runtime-detected port, finally fallback to default port 18789
- 在所有调用 `streamFromGateway` 的地方传递配置的端口信息  
  Pass configured port information in all `streamFromGateway` calls

**技术实现 / Technical Implementation**：
```typescript
// 修复前 / Before
const gatewayUrl = `http://127.0.0.1:${rt.gateway?.port || 18789}/v1/chat/completions`;

// 修复后 / After
const port = gatewayPort || rt.gateway?.port || 18789;
const gatewayUrl = `http://127.0.0.1:${port}/v1/chat/completions`;
```

**影响范围 / Impact**：  
影响所有在配置中指定了 `gateway.port` 的用户。修复后，配置的 Gateway 端口将正确生效，连接器能够连接到正确配置的 Gateway 实例。  
Affects all users who specified `gateway.port` in configuration. After the fix, the configured Gateway port will take effect correctly, and the connector can connect to the correctly configured Gateway instance.

### 2. 新会话命令修复 / New Session Command Fix

**问题描述 / Issue Description**：  
钉钉 Connector 之前在本地通过 `isNewSessionCommand` 拦截 `/new`、`/reset`、`/clear`、`新会话` 等指令，命中后由插件直接回复固定文案「✨ 已开启新会话，之前的对话已清空。」并提前 return，不再往 Gateway 发送消息。实际上 Connector 本身并没有真正清理会话上下文，也没有触发 Gateway 的 `session.reset`，导致用户以为会话已清空，但后续对话仍然带着旧上下文继续。  
Previously, DingTalk Connector intercepted commands like `/new`, `/reset`, `/clear`, `新会话` locally via `isNewSessionCommand`. When matched, the plugin directly replied with a fixed message "✨ 已开启新会话，之前的对话已清空。" and returned early without sending messages to Gateway. In reality, the Connector did not actually clear session context or trigger Gateway's `session.reset`, causing users to think the session was cleared while subsequent conversations still carried old context.

**修复内容 / Fix**：
- 新增 `normalizeSlashCommand` 工具方法，将 `/new`、`/reset`、`/clear`、`新会话`、`重新开始`、`清空对话` 等别名统一归一为标准指令 `/new`  
  Added `normalizeSlashCommand` utility method to normalize aliases like `/new`, `/reset`, `/clear`, `新会话`, `重新开始`, `清空对话` to standard command `/new`
- 在构造 `userContent` 时，先对文本部分调用 `normalizeSlashCommand`，再将结果连同图片、本地文件内容一并发送给 Gateway  
  When constructing `userContent`, first call `normalizeSlashCommand` on text, then send the result along with images and local file content to Gateway
- 删除 `handleDingTalkMessage` 中原有的"本地拦截 + 假提示"逻辑（`forceNewSession` 判断 + 直接回复「已开启新会话」并提前 return），不再在 Connector 层吞掉命令  
  Removed the original "local interception + fake prompt" logic in `handleDingTalkMessage` (`forceNewSession` check + direct reply "已开启新会话" and early return), commands are no longer swallowed at Connector layer

**行为变化 / Behavior Changes**：
- **修复前**：用户发送新会话类命令时，Connector 直接回复固定文案并提前 return，会话实际上未被清理  
  **Before**: When users sent new session commands, Connector directly replied with fixed message and returned early, session was not actually cleared
- **修复后**：用户发送新会话类命令时，消息会以 `/new` 的形式完整透传到 Gateway，由 Gateway 统一决定是否重置会话以及返回何种提示文案，从而真正清理会话  
  **After**: When users send new session commands, messages are forwarded to Gateway in `/new` format, Gateway decides whether to reset session and what prompt to return, truly clearing the session

**影响范围 / Impact**：  
影响所有使用新会话命令的用户。修复后，新会话命令将真正清理会话上下文，确保后续对话从全新状态开始。  
Affects all users who use new session commands. After the fix, new session commands will truly clear session context, ensuring subsequent conversations start from a fresh state.

## 📋 技术细节 / Technical Details

### 内部实现变更 / Internal Implementation Changes

#### Gateway 端口连接修复 / Gateway Port Connection Fix

**变更前 / Before**：
- `streamFromGateway` 函数仅使用运行时检测的端口 `rt.gateway?.port`
- 配置中的 `gateway.port` 被忽略
- 修改 Gateway 端口后需要重启才能生效

**变更后 / After**：
- `GatewayOptions` 接口新增 `gatewayPort?: number` 可选参数
- `streamFromGateway` 函数优先使用传入的 `gatewayPort` 参数
- 端口优先级：`gatewayPort` > `rt.gateway?.port` > `18789`（默认）
- 所有调用 `streamFromGateway` 的地方传递 `cfg.gateway?.port`

#### 新会话命令修复 / New Session Command Fix

**变更前 / Before**：
- `isNewSessionCommand` 函数检查消息是否为新会话命令
- `handleDingTalkMessage` 中拦截新会话命令，直接回复固定文案并提前 return
- 新会话命令不会发送到 Gateway，会话实际上未被清理

**变更后 / After**：
- `normalizeSlashCommand` 函数将所有新会话命令别名统一归一为 `/new`
- 删除 `handleDingTalkMessage` 中的本地拦截逻辑
- 新会话命令完整透传到 Gateway，由 Gateway 统一处理会话重置
- 在构造 `userContent` 时调用 `normalizeSlashCommand` 处理文本

**代码变更示例 / Code Change Example**：
```typescript
// 修复前 / Before
function isNewSessionCommand(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  return NEW_SESSION_COMMANDS.some(cmd => trimmed === cmd.toLowerCase());
}

// 在 handleDingTalkMessage 中
const forceNewSession = isNewSessionCommand(content.text);
if (forceNewSession) {
  await sendMessage(..., '✨ 已开启新会话，之前的对话已清空。', ...);
  return;  // 提前返回，不发送到 Gateway
}

// 修复后 / After
function normalizeSlashCommand(text: string): string {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (NEW_SESSION_COMMANDS.some(cmd => lower === cmd.toLowerCase())) {
    return '/new';  // 统一归一为标准命令
  }
  return text;
}

// 在 handleDingTalkMessage 中
const rawText = content.text || '';
let userContent = normalizeSlashCommand(rawText) || ...;
// 发送到 Gateway，由 Gateway 处理会话重置
```

### 相关代码位置 / Related Code Locations

主要修改文件：
- `plugin.ts` - Gateway 连接逻辑和新会话命令处理逻辑修改

关键变更点：
- `GatewayOptions` 接口定义（新增 `gatewayPort` 参数）
- `streamFromGateway` 函数中的端口选择逻辑
- `handleDingTalkMessage` 函数中所有 `streamFromGateway` 调用点（同步模式、异步模式、流式模式）
- `normalizeSlashCommand` 函数实现（替换 `isNewSessionCommand`）
- `handleDingTalkMessage` 函数中删除本地拦截逻辑，改为透传命令到 Gateway

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
- **推荐升级**：在配置中指定了 `gateway.port` 的用户强烈建议升级到此版本，以确保端口配置正确生效  
  **Recommended Upgrade**: Users who specified `gateway.port` in configuration are strongly recommended to upgrade to this version to ensure port configuration takes effect correctly
- **新会话命令行为变更**：新会话命令现在会真正清理会话，由 Gateway 统一处理，提示文案可能有所不同  
  **New Session Command Behavior Change**: New session commands now truly clear sessions, handled by Gateway, prompt messages may differ
- **无需配置变更**：现有配置无需修改，修复会自动生效  
  **No Configuration Changes Required**: Existing configurations work without modification, fix will automatically take effect

### 验证步骤 / Verification Steps

升级到此版本后：
After upgrading to this version:

1. **Gateway 端口验证**（如果配置了 `gateway.port`）：  
   **Gateway Port Verification** (if `gateway.port` is configured):
   - 检查配置：确认 `gateway.port` 配置正确  
     Check Configuration: Verify that `gateway.port` is correctly configured
   - 测试连接：发送一条消息，确认能够正常连接到 Gateway  
     Test Connection: Send a message to verify normal connection to Gateway
   - 验证端口：确认连接使用的是配置的端口，而不是默认端口  
     Verify Port: Confirm that the connection uses the configured port, not the default port

2. **新会话命令验证**：  
   **New Session Command Verification**:
   - 发送新会话命令（如 `/new`、`/reset`、`新会话` 等）  
     Send new session command (e.g., `/new`, `/reset`, `新会话`, etc.)
   - 确认收到 Gateway 返回的会话重置提示（提示文案可能有所不同）  
     Confirm receipt of Gateway's session reset prompt (prompt message may differ)
   - 发送后续消息，确认会话已真正清空，不包含之前的对话上下文  
     Send follow-up message, confirm session is truly cleared, no previous conversation context included

### 配置示例 / Configuration Example

```json5
{
  "channels": {
    "dingtalk-connector": {
      "enabled": true,
      "clientId": "dingxxxxxxxxx",
      "clientSecret": "your_secret_here",
      "gateway": {
        "port": 18888  // 自定义 Gateway 端口
      }
    }
  }
}
```

## 🔗 相关链接 / Related Links

- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档 / Documentation](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)
- [问题反馈 / Issue Feedback](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)
- [Pull Request #139](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/139) - Gateway 端口连接修复
- [Pull Request #170](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/170) - 新会话命令修复

## 🙏 致谢 / Acknowledgments

感谢所有贡献者和用户的支持与反馈！
Thanks to all contributors and users for their support and feedback!

---

**发布日期 / Release Date**：2026-03-12  
**版本号 / Version**：v0.7.6  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
