# Changelog

本文档记录所有重要的变更。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

This document records all significant changes. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and version numbers follow [Semantic Versioning](https://semver.org/).

## [0.7.8] - 2026-03-13

### 修复 / Fixes
- 🐛 **AI 卡片模版与渲染优化** - 更新 AI 卡片模版 ID，使卡片样式与最新官方规范保持一致，并提升多终端展示效果  
  **AI card template & rendering optimization** - Updated the AI card template ID to match the latest official standard and improved rendering across clients
- 🐛 **Markdown 表格渲染修复** - 在发送到钉钉前自动为 Markdown 表格头部补充必要空行，避免因缺少空行导致表格被当作普通文本渲染  
  **Markdown table rendering fix** - Automatically inserts required blank lines before Markdown table headers to prevent DingTalk from rendering tables as plain text
- 🐛 **消息去重逻辑优化** - 将消息去重维度从「账号 + 消息 ID」简化为单一「消息 ID」，避免多账号场景下的重复处理或误判  
  **Message de-duplication optimization** - Simplified de-duplication from `(accountId, messageId)` to `messageId` only, preventing duplicate handling or misjudgment in multi-account scenarios

### 改进 / Improvements
- ✅ **统一 Markdown 修正管道** - 对 AI 卡片流式内容、最终内容、普通 Markdown 消息及 `sampleMarkdown` 卡片文本统一应用 Markdown 修正规则，确保表格等格式在各入口行为一致  
  **Unified Markdown normalization pipeline** - Applies the same Markdown normalization to streaming AI card content, final content, regular Markdown messages, and `sampleMarkdown` card text for consistent behavior
- ✅ **AI 卡片状态内容一致性** - 在完成 AI 卡片时，对展示内容和写入 `cardParamMap.msgContent` 的内容使用同一份 Markdown 修正结果，确保用户看到的内容与内部状态一致  
  **Consistent AI card status content** - Ensures the same normalized Markdown is used both for the visible content and `cardParamMap.msgContent` when finishing AI cards

## [0.7.7] - 2026-03-13

### 新增 / Added
- ✨ **自定义 Gateway URL 支持** - 新增 `gatewayBaseUrl` 配置项，支持通过自定义 URL（如 Nginx 反向代理到 TLS/HTTPS Gateway）访问 Gateway  
  **Custom Gateway URL support** - Added `gatewayBaseUrl` option to allow using a custom URL (e.g., Nginx reverse proxy to a TLS/HTTPS Gateway)
- ✨ **钉钉「思考中」表情反馈** - 在处理用户消息期间为原消息贴上「🤔思考中」表情，处理结束后自动撤回，清晰展示处理进度  
  **DingTalk “thinking” emotion feedback** - Attaches a “🤔 Thinking” emotion to the original user message while processing and automatically recalls it after completion to clearly indicate progress
- ✨ **测试基础设施完善** - 引入 Vitest 及多种测试脚本（run/watch/coverage/ui/integration），为后续自动化测试和回归验证提供基础  
  **Improved testing infrastructure** - Introduced Vitest and multiple test scripts (run/watch/coverage/ui/integration) to enable better automated and regression testing
- ✨ **Issue Webhook 工作流** - 新增 GitHub Actions 工作流，将 Issue 变更以统一 JSON 格式推送到配置的 Webhook  
  **Issue webhook workflow** - Added a GitHub Actions workflow to push Issue changes as unified JSON payloads to a configured webhook

### 修复 / Fixes
- 🐛 **媒体元数据与缩略图提取更健壮** - ffprobe 或缩略图生成失败时不再中断主流程，而是返回默认元数据或空缩略图  
  **More robust media metadata & thumbnail extraction** - ffprobe or thumbnail generation failures no longer abort the main flow but return default metadata or a null thumbnail instead
- 🐛 **音频时长提取兼容性改进** - 使用动态 `import('child_process')` 替代 `require('child_process')`，提升在不同运行环境下的兼容性  
  **Audio duration extraction compatibility** - Replaced `require('child_process')` with dynamic `import('child_process')` to improve compatibility across environments
- 🐛 **主动消息用户列表校验** - 为主动消息的 `userIds` 列表增加空值过滤，避免因无效用户 ID 导致请求失败  
  **Proactive message user list validation** - Added empty value filtering for the `userIds` list in proactive messages to prevent request failures caused by invalid IDs

## [0.7.6] - 2026-03-12

### 修复 / Fixes
- 🐛 **Gateway 端口连接修复** - 修复修改 gateway 端口后无法连接的问题，确保配置中的 `gateway.port` 能够正确生效  
  **Gateway port connection fix** - Fixed issue where connection fails after modifying gateway port, ensuring that `gateway.port` in configuration takes effect correctly
- 🐛 **新会话命令修复** - 修复新会话命令（`/new`、`/reset`、`/clear`、`新会话` 等）未真正清理会话的问题，统一将命令透传到 Gateway 由 Gateway 统一处理会话重置  
  **New session command fix** - Fixed issue where new session commands (`/new`, `/reset`, `/clear`, `新会话`, etc.) did not actually clear sessions, commands are now forwarded to Gateway for unified session reset handling

## [0.7.5] - 2026-03-10

### 修复 / Fixes
- 🐛 **修复 Stream 客户端频繁重连问题** - 禁用 `DWClient` 内置的 `autoReconnect`，由框架的 health-monitor 统一管理重连逻辑，避免双重重连机制冲突  
  **Fixed Stream client frequent reconnection issue** - Disabled `DWClient` built-in `autoReconnect`, reconnection is now managed by framework's health-monitor to avoid dual reconnection mechanism conflict
- 🐛 **修复连接关闭不完整问题** - `stop()` 方法现在正确调用 `client.disconnect()` 关闭 WebSocket 连接  
  **Fixed incomplete connection closure** - `stop()` method now correctly calls `client.disconnect()` to close WebSocket connection
- 🐛 **Gateway 端口连接修复** - 修复修改 gateway 端口后无法连接的问题
  **Gateway port connection fix** - Fixed issue where connection fails after modifying gateway port

### 重构 / Refactoring
- ✅ **OpenClaw session.dmScope 机制** - 会话管理由 OpenClaw Gateway 统一处理，插件不再内部管理会话超时  
  **OpenClaw session.dmScope mechanism** - Session management is now handled by OpenClaw Gateway, plugin no longer manages session timeout internally
- ✅ **SessionContext 标准化** - 使用 OpenClaw 标准的 SessionContext JSON 格式传递会话上下文  
  **SessionContext standardization** - Use OpenClaw standard SessionContext JSON format for session context

### 配置变更 / Configuration Changes
- 新增 `groupSessionScope`（默认：`group`）- 群聊会话隔离策略（仅当 separateSessionByConversation=true 时生效）：`group`=群共享，`group_sender`=群内用户独立  
  Added `groupSessionScope` (default: `group`) - Group chat session isolation (only when separateSessionByConversation=true): `group`=shared, `group_sender`=per-user
- ⚠️ **废弃** `sessionTimeout` - 会话超时由 OpenClaw Gateway 的 `session.reset.idleMinutes` 配置控制，详见 [Gateway 配置文档](https://docs.openclaw.ai/gateway/configuration)  
  **Deprecated** `sessionTimeout` - Session timeout is now controlled by OpenClaw Gateway's `session.reset.idleMinutes`, see [Gateway Configuration](https://docs.openclaw.ai/gateway/configuration)

### 向后兼容 / Backward Compatibility
- 旧配置 `sessionTimeout` 仍可使用，但会打印废弃警告日志  
  Old config `sessionTimeout` still works but will print deprecation warning

## [0.7.4] - 2026-03-09

### 新增功能 / Added Features
- ✅ **按会话区分 Session** - 支持按单聊、群聊、不同群分别维护独立会话，单聊与群聊、不同群之间的对话上下文互不干扰  
  **Session by conversation** - Support separate sessions for direct chat, group chat, and different groups; conversation context is isolated between DMs, group chats, and different groups
- ✅ **记忆隔离/共享配置** - 新增 `sharedMemoryAcrossConversations` 配置，控制单 Agent 场景下是否在不同会话间共享记忆；默认 `false` 实现群聊与私聊、不同群之间的记忆隔离  
  **Memory isolation/sharing config** - Added `sharedMemoryAcrossConversations` option to control whether memory is shared across conversations in single-Agent mode; default `false` isolates memory between DMs, group chats, and different groups
- ✅ **Gateway Session 格式增强** - Session key 支持 `group:conversationId` 格式，便于 Gateway 识别群聊场景  
  **Gateway session format enhancement** - Session key supports `group:conversationId` format for Gateway to identify group chat scenarios
- ✅ **X-OpenClaw-Memory-User 支持** - 向 Gateway 传递记忆归属用户标识，支持 Gateway 侧记忆管理  
  **X-OpenClaw-Memory-User support** - Pass memory user identifier to Gateway for memory management

### 配置 / Configuration
- 新增 `separateSessionByConversation`（默认：`true`）- 是否按单聊/群聊/群区分 session  
  Added `separateSessionByConversation` (default: `true`) - Whether to separate sessions by direct/group/different groups  
  Added `separateSessionByConversation` (default: `true`) - Whether to separate sessions by direct/group/different groups (deprecated in 0.7.5)
- 新增 `sharedMemoryAcrossConversations`（默认：`false`）- 单 Agent 场景下是否在不同会话间共享记忆；`false` 时不同群聊、群聊与私聊记忆隔离  
  Added `sharedMemoryAcrossConversations` (default: `false`) - Whether to share memory across conversations in single-Agent mode; when `false`, memory is isolated between different groups and between DMs and groups

## [0.7.3] - 2026-03-09

### 修复 / Fixes
- 🐛 **兼容性修复**：修复 0.7.0 引入的默认 Agent 路由回归问题。0.7.0 之前默认路由到 `main` agent，0.7.0 之后错误地路由到 `default` agent，现已恢复为 `main` agent  
  **Compatibility fix**: Fixed default agent routing regression introduced in 0.7.0. Before 0.7.0 default routed to `main` agent, after 0.7.0 incorrectly routed to `default` agent, now restored to `main` agent
- 🐛 修复用户显式配置名为 `default` 的账号时被错误映射的问题：使用 `__default__` 作为内部默认账号标识  
  Fixed issue where user-configured account named `default` was incorrectly mapped: Use `__default__` as internal default account identifier

### 改进 / Improvements
- 抽取 `DEFAULT_ACCOUNT_ID` 常量到文件顶部，统一管理默认账号标识  
  Extracted `DEFAULT_ACCOUNT_ID` constant to file top, unified management of default account identifier
- 更新 API 文档注释，移除对 `default` 的硬编码引用  
  Updated API documentation comments, removed hardcoded references to `default`

## [0.7.2] - 2026-03-05

### 新增功能 / Added Features
- ✅ 新增异步模式：立即回执用户消息，后台处理任务，然后主动推送最终结果作为独立消息  
  Added async mode: immediately acknowledge user messages, process in background, then push the final result as a separate message
- ✅ 支持自定义回执消息文本，可通过 `ackText` 配置项设置  
  Support custom acknowledgment message text, configurable via `ackText` option

### 修复 / Fixes
- 🐛 修复异步模式下 Agent 路由问题：`streamFromGateway` 调用时缺少 `accountId` 参数，导致会话路由到 undefined agent  
  Fixed agent routing in async mode: `streamFromGateway` was called without `accountId`, causing sessions to route to undefined agent
- 🐛 修复默认 Agent 路由：当 `accountId` 为 `'default'` 时跳过 `X-OpenClaw-Agent-Id` header，让 gateway 路由到其配置的默认 agent  
  Fixed default agent routing: Skip `X-OpenClaw-Agent-Id` header when `accountId` is `'default'`, letting gateway route to its configured default agent
- 🐛 修复异步模式内容处理：使用 `userContent`（包含文件附件）替代原始 `content.text`  
  Fixed async mode content: Use `userContent` (includes file attachments) instead of raw `content.text`
- 🐛 修复异步模式图片支持：将 `imageLocalPaths` 传递给 gateway stream  
  Fixed image support for async mode: Pass `imageLocalPaths` to gateway stream

### 配置 / Configuration
- 新增 `asyncMode` 配置项（默认：`false`）- 启用异步模式  
  Added `asyncMode` configuration option (default: `false`) - Enable async mode
- 新增 `ackText` 配置项（默认：`'🫡 任务已接收，处理中...'`）- 自定义回执消息文本  
  Added `ackText` configuration option (default: `'🫡 任务已接收，处理中...'`) - Custom ack message text

## [0.7.1] - 2026-03-05

### 修复 / Fixes
- 🐛 修复 stream 模式 model 参数错误导致 session 路由失败的问题  
  Fixed issue where incorrect model parameter in stream mode caused session routing failures
- 🐛 将 Gateway 请求中的 model 参数从 `'default'` 更正为 `'main'`，确保正确的 Agent 路由  
  Corrected model parameter in Gateway requests from `'default'` to `'main'` to ensure proper Agent routing

### 改进 / Improvements
- 优化异步模式处理流程，改进错误处理和日志输出  
  Optimized async mode processing flow, improved error handling and log output
- 增强 DM Policy 检查机制，支持白名单配置  
  Enhanced DM Policy check mechanism, supporting allowlist configuration

## [0.7.0] - 2026-03-05

### 新增功能 / Added Features

#### 富媒体接收支持 / Rich Media Reception Support
- ✅ 支持接收 JPEG 图片消息，自动下载到 `~/.openclaw/workspace/media/inbound/` 目录  
  Support receiving JPEG image messages, automatically downloaded to `~/.openclaw/workspace/media/inbound/` directory
- ✅ 支持接收 PNG 图片（在 richText 中），自动提取 URL 和 downloadCode 并下载  
  Support receiving PNG images (in richText), automatically extract URL and downloadCode and download
- ✅ 图片自动传递给视觉模型，AI 可以识别和分析图片内容  
  Images are automatically passed to vision models, AI can recognize and analyze image content
- ✅ 媒体文件统一命名格式：`openclaw-media-{timestamp}.{ext}`  
  Unified naming format for media files: `openclaw-media-{timestamp}.{ext}`

#### 文件附件提取 / File Attachment Extraction
- ✅ 支持解析 `.docx` 文件（通过 `mammoth` 库提取文本内容）  
  Support parsing `.docx` files (extract text content via `mammoth` library)
- ✅ 支持解析 `.pdf` 文件（通过 `pdf-parse` 库提取文本内容）  
  Support parsing `.pdf` files (extract text content via `pdf-parse` library)
- ✅ 支持读取纯文本文件（`.txt`、`.md`、`.json` 等），内容直接注入到 AI 上下文  
  Support reading plain text files (`.txt`, `.md`, `.json`, etc.), content directly injected into AI context
- ✅ 支持处理二进制文件（`.xlsx`、`.pptx`、`.zip` 等），文件保存到磁盘并在消息中报告路径  
  Support processing binary files (`.xlsx`, `.pptx`, `.zip`, etc.), files saved to disk and paths reported in messages

#### 钉钉文档 API / DingTalk Document API
- ✅ 支持创建钉钉文档 (`docs.create`)  
  Support creating DingTalk documents (`docs.create`)
- ✅ 支持在现有文档上追加内容 (`docs.append`)  
  Support appending content to existing documents (`docs.append`)
- ✅ 支持搜索钉钉文档 (`docs.search`)  
  Support searching DingTalk documents (`docs.search`)
- ✅ 支持列举空间下的文档 (`docs.list`)  
  Support listing documents under a space (`docs.list`)
- ⚠️ 注意：读取文档功能 (`docs.read`) 需要 MCP 提供相应的 tool，当前版本暂不支持  
  Note: Document reading functionality (`docs.read`) requires MCP to provide the corresponding tool, currently not supported in this version

#### 多 Agent 路由支持 / Multi-Agent Routing Support
- ✅ 支持一个连接器实例同时连接多个 Agent  
  Support one connector instance connecting to multiple Agents simultaneously
- ✅ 支持多个钉钉机器人分别绑定到不同的 Agent，实现角色分工和专业化服务  
  Support multiple DingTalk bots binding to different Agents, enabling role division and specialized services
- ✅ 每个 Agent 拥有独立的会话空间，实现会话隔离  
  Each Agent has an independent session space, achieving session isolation
- ✅ 向后兼容单 Agent 场景，无需额外配置  
  Backward compatible with single Agent scenarios, no additional configuration required
- ✅ 提供多 Agent 配置说明和示例，支持通过 `accounts` 和 `bindings` 配置多个机器人  
  Provides multi-Agent configuration documentation and examples, supports configuring multiple bots via `accounts` and `bindings`

### 修复 / Fixes
- 🐛 修复机器人发送语音消息播放异常问题，音频进度和播放功能现已正常工作  
  Fixed bot voice message playback issues, audio progress and playback functionality now work correctly

### 改进 / Improvements
- 优化媒体文件下载和存储机制  
  Optimized media file download and storage mechanism
- 改进文件附件处理流程，支持更多文件类型  
  Improved file attachment processing flow, supporting more file types
- 增强错误处理和日志输出  
  Enhanced error handling and log output
- 新增 Markdown 表格自动转换功能，将 Markdown 表格转换为钉钉支持的文本格式，提升消息可读性  
  Added automatic Markdown table conversion, converting Markdown tables to DingTalk-supported text format for better message readability

### 依赖更新 / Dependency Updates
- 新增 `mammoth@^1.8.0` - Word 文档解析  
  Added `mammoth@^1.8.0` - Word document parsing
- 新增 `pdf-parse@^1.1.1` - PDF 文档解析  
  Added `pdf-parse@^1.1.1` - PDF document parsing

### 已知问题 / Known Issues
- ⚠️ 钉钉文档读取功能 (`docs.read`) 当前不可用，因为 MCP 中未提供相应的 tool。代码层面实现正常，等待 MCP 支持。  
  DingTalk document reading functionality (`docs.read`) is currently unavailable because MCP does not provide the corresponding tool. Implementation is correct at the code level, waiting for MCP support.

### 文档更新 / Documentation Updates
- 更新 README.md，添加新功能使用说明  
  Updated README.md, added usage instructions for new features
- 添加富媒体接收、文件附件提取、钉钉文档 API、多 Agent 路由等章节  
  Added sections on rich media reception, file attachment extraction, DingTalk document API, multi-Agent routing, etc.
- 新增"多 Agent 配置"章节，提供详细的配置示例和说明  
  Added "Multi-Agent Configuration" section with detailed configuration examples and instructions
- 补充常见问题解答  
  Added FAQ section

