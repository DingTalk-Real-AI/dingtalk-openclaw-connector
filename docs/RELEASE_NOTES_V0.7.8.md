# Release Notes - v0.7.8

## ✨ 功能与体验改进 / Features & Improvements

- **AI 卡片模版更新与展示效果优化 / AI Card Template & Rendering Improvements**  
  升级钉钉 AI 卡片模版 ID，使卡片样式与最新官方规范保持一致，并优化多终端的展示效果与兼容性。  
  Updated the DingTalk AI card template ID to align with the latest official template standard, improving visual consistency and compatibility across different clients.

- **Markdown 表格渲染修复与自动优化 / Markdown Table Rendering Fix & Auto-Adjustment**  
  新增 Markdown 预处理逻辑，在发送到钉钉前自动为表格头部补充必要的空行，避免因缺少空行导致的表格无法正确渲染问题；支持缩进表格场景。  
  Added a Markdown preprocessing step that automatically inserts a blank line before table headers when needed, ensuring DingTalk renders tables correctly, including indented table cases.

- **统一的 Markdown 修正管道 / Unified Markdown Normalization Pipeline**  
  对 AI 卡片流式更新、AI 卡片最终内容提交、普通 Markdown 消息发送以及卡片 `sampleMarkdown` 内容，统一通过同一套 Markdown 修正函数进行处理，确保所有下发到钉钉的文本在表格渲染等细节上行为一致。  
  Unified the Markdown normalization logic used for streaming AI card updates, final AI card content, regular Markdown messages, and `sampleMarkdown` card payloads, ensuring consistent behavior of table rendering and formatting in DingTalk.

- **AI 卡片状态信息更准确 / More Accurate AI Card Status Content**  
  在完成 AI 卡片时，对用于展示的内容与写入 `cardParamMap` 中的 `msgContent` 同步应用 Markdown 修正逻辑，保证用户看到的内容与卡片内部状态字段保持完全一致。  
  When finalizing AI cards, the same Markdown fixes are now applied both to the displayed content and the `msgContent` stored in `cardParamMap`, keeping the visible card and its internal state in sync.

## 🐛 修复 / Fixes

- **Markdown 表格无法正确显示的问题 / Incorrect Markdown Table Rendering**  
  修复了部分场景下 Markdown 表格前缺少空行，导致钉钉不将其识别为表格而当作普通文本渲染的问题；现在会自动检测表头与分隔行模式并在需要时插入空行。  
  Fixed an issue where missing blank lines before Markdown tables caused DingTalk to render them as plain text; the connector now detects table headers and divider lines and inserts a blank line when necessary.

- **消息去重维度优化 / Message De-duplication Scope Optimization**  
  优化消息去重逻辑，从「按账号+消息 ID」改为仅基于「消息 ID」维度标记与判断，避免在多账号场景中出现某些重复消息未被正确拦截或误判的情况。  
  Improved the message de-duplication mechanism by switching from an account-scoped `(accountId, messageId)` key to a global `messageId` key, preventing edge cases where duplicate messages across accounts might not be handled correctly.

## 📋 技术细节 / Technical Details

### AI 卡片模版 & 内容处理 / AI Card Template & Content Handling

- 更新 `AI_CARD_TEMPLATE_ID` 为新的模版 ID，以匹配最新的钉钉 AI 卡片样式规范。  
- 新增 `ensureTableBlankLines(text: string)` 工具函数：  
  - 将文本按行拆分，识别包含竖线的表格行与 `---` 分隔行。  
  - 当前行看起来像表头、下一行是分隔行、且前一行既不是空行也不是表格行时，会在表头前插入一个空行。  
  - 支持带缩进的表格写法，保持原有内容顺序与缩进风格不变。  
- 在以下路径中统一使用 `ensureTableBlankLines`：  
  - AI 卡片流式内容更新（`streamAICard`）中的 `content` 字段。  
  - AI 卡片结束时（`finishAICard`）的最终内容与日志长度统计。  
  - 普通 Markdown 消息发送（`sendMarkdownMessage`），在追加 `@user` 之前先做表格修正。  
  - `buildMsgPayload` 中 `sampleMarkdown` 类型的 `text` 字段。  
- 为单元测试导出 `__testables.ensureTableBlankLines`，便于在不依赖具体业务逻辑的情况下验证 Markdown 修正规则。

### 消息去重逻辑 / Message De-duplication Logic

- 去重检查由 `isMessageProcessed(accountId, messageId)` 简化为 `isMessageProcessed(messageId)`，对同一消息 ID 统一判重。  
- 标记逻辑由 `markMessageProcessed(accountId, messageId)` 更新为 `markMessageProcessed(messageId)`，减少多账号场景下可能出现的重复处理路径。  
- 保持原有日志信息与跳过处理分支不变，仅调整内部去重键值结构。

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

- **向下兼容 / Backward Compatible**：本次为小版本修复和体验优化更新，在保留 v0.7.x 既有行为的前提下增强了 Markdown 表格渲染与消息去重逻辑，对现有配置完全兼容。  
- **Markdown 表格渲染更稳定 / More Robust Markdown Tables**：即便原始内容中未严格遵守表格前空行的写法，Connector 也会自动做最小化修正，以提高在钉钉中的可读性。  
- **消息去重语义更清晰 / Clearer De-duplication Semantics**：以 `messageId` 为唯一维度进行去重，更贴合钉钉消息唯一标识的语义。

### 验证步骤 / Verification Steps

升级到此版本后，建议进行以下验证：

1. **AI 卡片模版与渲染验证 / AI Card Template & Rendering Verification**  
   - 触发一次典型的 AI 卡片对话，观察新模版下的卡片布局与字段展示是否符合预期。  
   - 在含有多段文字与表格的回复中，确认卡片内 Markdown 表格渲染正常。  

2. **Markdown 表格兼容性验证 / Markdown Table Compatibility Verification**  
   - 通过机器人发送包含 Markdown 表格的消息（包含表头、分隔行与多列数据），且故意在表格前省略空行。  
   - 在移动端及 PC 端查看，确认钉钉能够正确以表格形式渲染内容。  

3. **消息去重行为验证 / Message De-duplication Behavior Verification**  
   - 在相同会话中模拟重复推送同一个 `messageId` 的回调（或快速重复发送同一条消息）。  
   - 确认日志中出现去重命中提示，并且业务处理逻辑只执行一次。

## 🔗 相关链接 / Related Links

- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档 / Documentation](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)
- [问题反馈 / Issue Feedback](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)

---

**发布日期 / Release Date**：2026-03-13  
**版本号 / Version**：v0.7.8  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+

