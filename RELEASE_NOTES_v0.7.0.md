# Release Notes - v0.7.0

## 🎉 新版本亮点 / Highlights

本次更新带来了丰富的富媒体和文档处理能力，让 AI 助手能够更好地理解和处理各种类型的内容。新增了图片识别、文件解析、钉钉文档操作和多 Agent 路由等核心功能。

This update brings rich media and document processing capabilities, enabling AI assistants to better understand and process various types of content. New core features include image recognition, file parsing, DingTalk document operations, and multi-Agent routing.

## ✨ 新增功能 / Added Features

### 富媒体接收支持 / Rich Media Reception Support
- ✅ **JPEG 图片消息** - 支持接收钉钉中直接发送的 JPEG 图片，自动下载到 `~/.openclaw/workspace/media/inbound/` 目录  
  **JPEG Image Messages** - Support receiving JPEG images sent directly in DingTalk, automatically downloaded to `~/.openclaw/workspace/media/inbound/` directory
- ✅ **PNG 图片（富文本）** - 支持接收富文本消息中包含的 PNG 图片，自动提取 URL 和 downloadCode 并下载  
  **PNG Images (Rich Text)** - Support receiving PNG images contained in rich text messages, automatically extract URL and downloadCode and download
- ✅ **视觉模型集成** - 下载的图片自动传递给视觉模型，AI 可以识别和分析图片内容  
  **Vision Model Integration** - Downloaded images are automatically passed to vision models, AI can recognize and analyze image content
- ✅ **媒体文件管理** - 统一的文件命名格式 `openclaw-media-{timestamp}.{ext}`，便于管理和追踪  
  **Media File Management** - Unified file naming format `openclaw-media-{timestamp}.{ext}` for easy management and tracking

### 文件附件提取 / File Attachment Extraction
- ✅ **Word 文档解析** - 支持解析 `.docx` 文件，通过 `mammoth` 库提取文本内容并注入到 AI 上下文  
  **Word Document Parsing** - Support parsing `.docx` files, extract text content via `mammoth` library and inject into AI context
- ✅ **PDF 文档解析** - 支持解析 `.pdf` 文件，通过 `pdf-parse` 库提取文本内容并注入到 AI 上下文  
  **PDF Document Parsing** - Support parsing `.pdf` files, extract text content via `pdf-parse` library and inject into AI context
- ✅ **纯文本文件** - 支持读取 `.txt`、`.md`、`.json` 等纯文本文件，内容直接注入到消息中  
  **Plain Text Files** - Support reading plain text files (`.txt`, `.md`, `.json`, etc.), content directly injected into messages
- ✅ **二进制文件处理** - 支持处理 `.xlsx`、`.pptx`、`.zip` 等二进制文件，文件保存到磁盘并在消息中报告路径  
  **Binary File Processing** - Support processing binary files (`.xlsx`, `.pptx`, `.zip`, etc.), files saved to disk and paths reported in messages

### 钉钉文档 API / DingTalk Document API
- ✅ **创建文档** - `docs.create()` - 在指定空间中创建新的钉钉文档  
  **Create Document** - `docs.create()` - Create new DingTalk documents in specified spaces
- ✅ **追加内容** - `docs.append()` - 在现有文档上追加 Markdown 内容  
  **Append Content** - `docs.append()` - Append Markdown content to existing documents
- ✅ **搜索文档** - `docs.search()` - 根据关键词搜索钉钉文档  
  **Search Documents** - `docs.search()` - Search DingTalk documents by keywords
- ✅ **列举文档** - `docs.list()` - 列举指定空间下的所有文档  
  **List Documents** - `docs.list()` - List all documents under specified spaces
- ⚠️ **读取文档** - `docs.read()` - 当前不可用（见已知问题）  
  **Read Document** - `docs.read()` - Currently unavailable (see Known Issues)

### 多 Agent 路由支持 / Multi-Agent Routing Support
- ✅ **多 Agent 会话隔离** - 支持一个连接器实例同时连接多个 Agent  
  **Multi-Agent Session Isolation** - Support one connector instance connecting to multiple Agents simultaneously
- ✅ **多机器人绑定** - 支持多个钉钉机器人分别绑定到不同的 Agent，实现角色分工和专业化服务  
  **Multi-Bot Binding** - Support multiple DingTalk bots binding to different Agents, enabling role division and specialized services
- ✅ **独立会话空间** - 每个 Agent 拥有独立的会话上下文，互不干扰  
  **Independent Session Space** - Each Agent has an independent session context without interference
- ✅ **灵活配置** - 通过 `accounts` 和 `bindings` 配置多个机器人，提供详细的配置示例和说明  
  **Flexible Configuration** - Configure multiple bots via `accounts` and `bindings`, with detailed configuration examples and instructions
- ✅ **向后兼容** - 单 Agent 场景下功能完全兼容，无需额外配置  
  **Backward Compatible** - Fully compatible with single Agent scenarios, no additional configuration required

## 🐛 修复 / Fixes

- **语音消息播放异常修复** - 修复机器人发送语音消息播放异常问题，音频进度和播放功能现已正常工作  
  **Voice Message Playback Fix** - Fixed bot voice message playback issues, audio progress and playback functionality now work correctly

## 🔧 改进 / Improvements

- **媒体文件处理优化** - 优化了媒体文件下载和存储机制，提升处理效率  
  **Media File Processing Optimization** - Optimized media file download and storage mechanism, improved processing efficiency
- **文件附件流程改进** - 改进了文件附件处理流程，支持更多文件类型，错误处理更完善  
  **File Attachment Process Improvement** - Improved file attachment processing flow, supporting more file types with better error handling
- **Markdown 表格转换** - 自动将 Markdown 表格转换为钉钉支持的文本格式，提升消息可读性  
  **Markdown Table Conversion** - Automatically convert Markdown tables to DingTalk-supported text format for better message readability
- **日志增强** - 增强了错误处理和日志输出，便于问题排查和调试  
  **Log Enhancement** - Enhanced error handling and log output for easier troubleshooting and debugging

## 📦 依赖更新 / Dependency Updates

- 新增 `mammoth@^1.8.0` - Word 文档（.docx）解析库  
  Added `mammoth@^1.8.0` - Word document (.docx) parsing library
- 新增 `pdf-parse@^1.1.1` - PDF 文档解析库  
  Added `pdf-parse@^1.1.1` - PDF document parsing library

## ⚠️ 已知问题 / Known Issues

### 1. 钉钉文档读取功能不可用 / DingTalk Document Reading Unavailable

**问题描述 / Issue Description**：`docs.read()` API 当前无法正常工作  
`docs.read()` API is currently not working properly

**原因 / Cause**：MCP（Model Context Protocol）中未提供读取文档的 tool，虽然代码层面实现正常，但缺少底层支持  
MCP (Model Context Protocol) does not provide the tool for reading documents. While the implementation is correct at the code level, underlying support is missing

**影响范围 / Impact**：仅影响文档读取功能，其他文档操作（创建、追加、搜索、列举）均正常  
Only affects document reading functionality, other document operations (create, append, search, list) work normally

**解决方案 / Solution**：等待 MCP 提供相应的 tool 支持，或使用其他文档操作 API 作为替代方案  
Wait for MCP to provide corresponding tool support, or use other document operation APIs as alternatives

**状态 / Status**：已记录，等待上游支持  
Recorded, waiting for upstream support

## 📚 文档更新 / Documentation Updates

- ✅ 更新 README.md，添加新功能使用说明  
  Updated README.md, added usage instructions for new features
- ✅ 新增"富媒体接收"章节，说明图片消息处理方式  
  Added "Rich Media Reception" section, explaining image message processing
- ✅ 新增"文件附件提取"章节，列出支持的文件类型和处理方式  
  Added "File Attachment Extraction" section, listing supported file types and processing methods
- ✅ 新增"钉钉文档 API"章节，提供 API 使用示例  
  Added "DingTalk Document API" section, providing API usage examples
- ✅ 新增"多 Agent 路由支持"章节，说明多 Agent 会话隔离功能  
  Added "Multi-Agent Routing Support" section, explaining multi-Agent session isolation functionality
- ✅ 新增"多 Agent 配置"章节，提供详细的配置示例和说明（`accounts` 和 `bindings` 配置）  
  Added "Multi-Agent Configuration" section with detailed configuration examples and instructions (`accounts` and `bindings` configuration)
- ✅ 补充常见问题解答，包括新功能的故障排查  
  Added FAQ section, including troubleshooting for new features

## 🔗 相关链接 / Related Links

- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档 / Documentation](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)
- [问题反馈 / Issue Feedback](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)

## 📥 安装升级 / Installation & Upgrade

```bash
# 通过 npm 安装最新版本 / Install latest version via npm
openclaw plugins install @dingtalk-real-ai/dingtalk-connector

# 或升级现有版本 / Or upgrade existing version
openclaw plugins update dingtalk-connector

# 通过 Git 安装 / Install via Git
openclaw plugins install https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector.git
```

## 🙏 致谢 / Acknowledgments

感谢所有贡献者和用户的支持与反馈！  
Thanks to all contributors and users for their support and feedback!

---

**发布日期 / Release Date**：2026-03-05  
**版本号 / Version**：v0.7.0  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
