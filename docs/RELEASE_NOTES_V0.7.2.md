# Release Notes - v0.7.2

## ✨ 功能增强版本 / Feature Enhancement Release

本次更新新增异步模式功能，并修复了多个关键问题，提升了连接器的稳定性和用户体验。

This update adds async mode functionality and fixes several critical issues, improving connector stability and user experience.

## ✨ 新增功能 / New Features

### 1. 异步模式 / Async Mode

**功能描述 / Feature Description**：立即回执用户消息，后台处理任务，然后主动推送最终结果作为独立消息  
Immediately acknowledge user messages, process in background, then push the final result as a separate message

**使用场景 / Use Cases**：
- 处理耗时较长的任务（如文档分析、代码生成等）  
  Processing time-consuming tasks (e.g., document analysis, code generation)
- 需要给用户即时反馈的场景  
  Scenarios requiring immediate user feedback
- 希望将处理过程和结果分离的场景  
  Scenarios where separating processing and results is desired

**配置方式 / Configuration**：

```json5
{
  "channels": {
    "dingtalk-connector": {
      "asyncMode": true,              // 启用异步模式 / Enable async mode
      "ackText": "🫡 任务已接收"  // 可选：自定义回执消息 / Optional: Custom ack message
    }
  }
}
```

**工作流程 / Workflow**：
1. **立即回执** - 用户发送消息后，连接器立即发送回执消息  
   **Immediate Acknowledgment** - Connector immediately sends acknowledgment message after user sends message
2. **后台处理** - 连接器在后台调用 Gateway 处理任务，支持文件附件和图片  
   **Background Processing** - Connector processes task in background via Gateway, supports file attachments and images
3. **推送结果** - 处理完成后，连接器主动推送最终结果作为独立消息  
   **Push Result** - After processing completes, connector proactively pushes final result as separate message

**影响范围 / Impact**：所有用户均可选择启用此功能，默认关闭，不影响现有使用方式  
All users can optionally enable this feature. Default is off, does not affect existing usage.

## 🐛 修复 / Fixes

### 1. 异步模式下 Agent 路由问题修复 / Agent Routing Fix in Async Mode

**问题描述 / Issue Description**：异步模式下 `streamFromGateway` 调用时缺少 `accountId` 参数，导致会话路由到 undefined agent  
In async mode, `streamFromGateway` was called without `accountId`, causing sessions to route to undefined agent

**修复内容 / Fix**：
- 修复 `streamFromGateway` 调用，正确传递 `accountId` 参数  
  Fixed `streamFromGateway` call to correctly pass `accountId` parameter
- 确保异步模式下 Agent 路由正常工作  
  Ensures Agent routing works correctly in async mode

**影响范围 / Impact**：影响使用异步模式的用户，修复后异步模式下的 Agent 路由将正常工作  
Affects users using async mode. After the fix, Agent routing in async mode will work correctly.

### 2. 默认 Agent 路由修复 / Default Agent Routing Fix

**问题描述 / Issue Description**：当 `accountId` 为 `'default'` 时，仍然发送 `X-OpenClaw-Agent-Id` header，导致路由异常  
When `accountId` is `'default'`, `X-OpenClaw-Agent-Id` header was still sent, causing routing issues

**修复内容 / Fix**：
- 当 `accountId` 为 `'default'` 时跳过 `X-OpenClaw-Agent-Id` header  
  Skip `X-OpenClaw-Agent-Id` header when `accountId` is `'default'`
- 让 gateway 路由到其配置的默认 agent  
  Let gateway route to its configured default agent

**影响范围 / Impact**：影响使用默认 Agent 配置的用户，修复后默认 Agent 路由将正常工作  
Affects users with default Agent configuration. After the fix, default Agent routing will work correctly.

### 3. 异步模式内容处理修复 / Async Mode Content Fix

**问题描述 / Issue Description**：异步模式使用原始 `content.text`，未包含文件附件内容  
Async mode used raw `content.text`, did not include file attachment content

**修复内容 / Fix**：
- 使用 `userContent`（包含文件附件）替代原始 `content.text`  
  Use `userContent` (includes file attachments) instead of raw `content.text`
- 确保文件附件内容正确传递给 Gateway  
  Ensures file attachment content is correctly passed to Gateway

**影响范围 / Impact**：影响使用异步模式且发送文件附件的用户，修复后文件附件将正确处理  
Affects users using async mode and sending file attachments. After the fix, file attachments will be processed correctly.

### 4. 异步模式图片支持修复 / Async Mode Image Support Fix

**问题描述 / Issue Description**：异步模式下未将图片路径传递给 Gateway stream  
Image paths were not passed to Gateway stream in async mode

**修复内容 / Fix**：
- 将 `imageLocalPaths` 传递给 gateway stream  
  Pass `imageLocalPaths` to gateway stream
- 确保图片在异步模式下正确处理  
  Ensures images are processed correctly in async mode

**影响范围 / Impact**：影响使用异步模式且发送图片的用户，修复后图片将正确处理  
Affects users using async mode and sending images. After the fix, images will be processed correctly.

## 🔧 配置更新 / Configuration Updates

### 新增配置项 / New Configuration Options

- **`asyncMode`**（类型：`boolean`，默认：`false`）- 启用异步模式  
  **`asyncMode`** (type: `boolean`, default: `false`) - Enable async mode
- **`ackText`**（类型：`string`，默认：`'🫡 任务已接收，处理中...'`）- 自定义回执消息文本  
  **`ackText`** (type: `string`, default: `'🫡 任务已接收，处理中...'`) - Custom ack message text

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
- [问题反馈 / Issue Feedback](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)

## 🙏 致谢 / Acknowledgments

感谢所有贡献者和用户的支持与反馈！  
Thanks to all contributors and users for their support and feedback!

---

**发布日期 / Release Date**：2026-03-05  
**版本号 / Version**：v0.7.2  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
