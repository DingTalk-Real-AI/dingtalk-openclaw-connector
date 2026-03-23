# Release Notes - v0.8.3

## 🎉 新版本亮点 / Highlights

本次更新修复了五个问题：与 OpenClaw Gateway 新版本（2026.3.22+）的兼容性问题、多 Agent 路由在 `sharedMemoryAcrossConversations` 配置下的路由错误、发送图片时的异常问题、发送人昵称和群名称未正确传递给 AI 的问题，以及 AI 卡片流式更新（progressive updates）失效的问题。

This release fixes five issues: a compatibility issue with newer OpenClaw Gateway versions (2026.3.22+), incorrect multi-Agent routing when `sharedMemoryAcrossConversations` is enabled, an image sending failure, sender nickname and group name not being correctly passed to the AI, and AI card progressive updates not working.

## 🐛 修复 / Fixes

- **兼容 OpenClaw Gateway 新版本 / Compatible with Newer OpenClaw Gateway Versions**  
  修复在 OpenClaw Gateway 2026.3.22+ 版本下安装插件时报错 `ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './plugin-sdk/compat' is not defined by "exports"` 的问题。根因是 `src/runtime.ts` 使用了已被新版 SDK 移除的 `openclaw/plugin-sdk/compat` 子路径，现已改为从 `openclaw/plugin-sdk` 主入口导入，对所有版本（2026.3.1+）均兼容。  
  Fixed an error `ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './plugin-sdk/compat' is not defined by "exports"` when installing the plugin under OpenClaw Gateway 2026.3.22+. The root cause was `src/runtime.ts` importing from the `openclaw/plugin-sdk/compat` sub-path which was removed in newer SDK versions. Now imports from the `openclaw/plugin-sdk` main entry, compatible with all versions (2026.3.1+).

- **AI 卡片流式更新延迟 / AI Card Progressive Updates Delayed**  
  优化了 AI 卡片流式更新的响应速度。改动前，`onReplyStart` 中 `await startStreaming()` 串行等待 AI Card 创建完成（约 500ms~1s），期间收到的 partial reply 全部被丢弃，Card 创建好之后才开始流式更新；同时节流间隔 1000ms 过于保守，对于 2 秒内完成的短回复几乎跳过所有中间更新。改动后，AI Card 创建改为 fire-and-forget 模式与 AI 生成并行，`onPartialReply` 到来时等待 Card 就绪后立即更新，节流间隔调整为 500ms，流式内容能更早、更频繁地呈现给用户。  
  Improved AI card progressive update responsiveness. Previously, `await startStreaming()` in `onReplyStart` waited serially for AI Card creation (~500ms–1s), discarding all partial replies received during that window; additionally, the 1000ms throttle interval was too conservative, skipping nearly all intermediate updates for short replies. After the fix, AI Card creation runs in fire-and-forget mode in parallel with AI generation; `onPartialReply` waits for the card to be ready and then updates immediately, with the throttle interval reduced to 500ms for earlier and more frequent streaming updates.

- **消息重复处理（钉钉服务端重发穿透）/ Duplicate Message Processing on DingTalk Server Resend**  
  修复了 AI 处理耗时超过 ~60 秒时，钉钉服务端重发消息导致 Bot 重复处理的问题。根因是去重逻辑仅使用 `headers.messageId`（WebSocket 协议层投递 ID，每次重发都是新值），未检查 `data.msgId`（业务层消息 ID，重发时保持不变），导致重发消息穿透去重缓存。修复后引入双层去重：协议层（`headers.messageId`）拦截同一次投递的重复回调，业务层（`data.msgId`）拦截服务端重发，两个 ID 同时标记，任意一个命中即可拦截。  
  Fixed an issue where DingTalk server resent messages (triggered when AI processing exceeds ~60 seconds) caused the Bot to process the same message twice. The root cause was that deduplication only checked `headers.messageId` (WebSocket protocol-layer delivery ID, which changes on every resend), ignoring `data.msgId` (business-layer message ID, which stays the same on resend). After the fix, a two-layer deduplication is applied: protocol-layer (`headers.messageId`) blocks duplicate callbacks from the same delivery, and business-layer (`data.msgId`) blocks server resends. Both IDs are marked simultaneously so either one can trigger deduplication.

- **多 Agent 路由与 sharedMemoryAcrossConversations 冲突 / Multi-Agent Routing Conflict with sharedMemoryAcrossConversations**  
  修复了配置 `sharedMemoryAcrossConversations: true` 时，多群分配不同 Agent 的 bindings 全部路由到同一个 Agent 的问题。根因是路由匹配错误地使用了 `sessionPeerId`（已被覆盖为 `accountId`）而非真实的 peer 标识。修复后，路由匹配使用专用的 `peerId` 字段（不受会话隔离配置影响），session 构建使用 `sessionPeerId`，两者职责严格分离。  
  Fixed an issue where all bindings routing different groups to different Agents would resolve to the same Agent when `sharedMemoryAcrossConversations: true` was configured. The root cause was that routing matched against `sessionPeerId` (overridden to `accountId`) instead of the real peer identifier. After the fix, routing uses the dedicated `peerId` field (unaffected by session isolation config), while session construction uses `sessionPeerId`, with strict separation of responsibilities.

- **发送图片失败 / Image Sending Failure**  
  修复了发送图片时出现异常的问题。([#316](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/316))  
  Fixed an issue where sending images would fail with an error. ([#316](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/316))

- **发送人昵称与群名称未正确传递给 AI / Sender Nickname and Group Name Not Passed to AI**  
  修复了会话上下文中 `SenderName` 字段错误传入用户 ID（而非昵称）、`GroupSubject` 字段错误传入群 ID（而非群名称）的问题。修复后，AI 能正确获取发送人的钉钉昵称和所在群的名称，有助于 AI 更好地理解对话场景。  
  Fixed an issue where the `SenderName` field in the session context was incorrectly set to the user ID instead of the display name, and `GroupSubject` was set to the group ID instead of the group title. After the fix, the AI correctly receives the sender's DingTalk nickname and the group name, enabling better contextual understanding.

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

---

**发布日期 / Release Date**：2026-03-23  
**版本号 / Version**：v0.8.3  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+