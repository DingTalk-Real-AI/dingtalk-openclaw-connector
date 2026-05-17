# Release Notes - v0.8.21-beta.0

> **社区验证版本** — 计划经过 ~3 天社区验证后晋升为正式版 `v0.8.21`。  
> **Community validation release** — planned to promote to GA `v0.8.21` after ~3 days of community validation.

## 🎉 本次重点 / Highlights

本版本聚焦 WebSocket 连接稳定性 + 群聊体验：

1. 修掉本仓 listener 注册时机错乱导致的 ~30s 一次幽灵重连（社区贡献 #566）
2. 修掉消息处理保活 interval 与 `TIMEOUT_THRESHOLD` 不匹配的兜底失效（#594）
3. 过滤上游 `dingtalk-stream@2.1.4` SDK 直接走 `console.info` 的噪音（#571 / #536 / #573）
4. 群聊 @ 机器人空回复时，把无信息的「任务执行完成」改为带 `openclaw.json` 修复指引的可操作文案（#589）

This release focuses on WebSocket stability + group-chat UX:

1. Fix root cause of ~30s phantom reconnect cycle caused by listener-registration timing (community contribution, #566)
2. Fix message-processing keepalive interval mismatch with `TIMEOUT_THRESHOLD` (#594)
3. Filter noisy `console.info` calls from upstream `dingtalk-stream@2.1.4` (#571 / #536 / #573)
4. Group `@` mention's empty-reply fallback now embeds an actionable `openclaw.json` fix hint (#589)

## 🐛 修复 / Fixes

### WebSocket phantom reconnect 根因修复 (#566)

**现象**：约每 30 秒一次的 WebSocket 重连，`Disconnecting.` / `connect success` 成对出现，看起来像连接频繁掉线。

**根因**：`setupPongListener` / `setupMessageListener` / `setupCloseListener` 在 `client.connect()` 之前被调用，此时 `client.socket === undefined`，函数体里 `client.socket?.on(...)` 的可选链让调用静默成 no-op——三个 listener 实际从未挂上。

- pong listener 缺失 → `lastSocketAvailableTime` 不刷新 → 命中 `TIMEOUT_THRESHOLD = 20s` → `doReconnect()` 触发
- message listener 缺失 → 服务端真实下发的 disconnect topic 也无法响应
- close listener 缺失 → socket close 不能立即触发重连

**修复**：

- 删除模块初始化时的 no-op setup 调用
- 初次 `client.connect()` 成功后立即注册三个 listener
- `doReconnect()` 里把 setup 挪到 `client.connect()` 之后、`await for OPEN` 之前——避免 keepAlive 期间 ping 的 pong 回来时 listener 还没挂被丢的 race window

**致谢**：感谢 [@Majorshi](https://github.com/Majorshi) 提交 [PR #566](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/566)，并感谢 [@lizhiyao](https://github.com/lizhiyao) / [@edokeh](https://github.com/edokeh) / [@jeikl](https://github.com/jeikl) 提前验证修复有效。

### 消息处理保活 interval 兜底 bug (#594)

**根因**：`markMessageProcessingStart` 启动的兜底定时器原本 30s 间隔，但 `TIMEOUT_THRESHOLD` 已在 `d90916b` 中从 90s 降到 20s——30s 间隔无法在 AI 长任务期间防住超时（AI 任务跑到约 21s 就可能触发 keepAlive 幽灵重连，下次刷新还要等 9 秒）。

**修复**：interval 调整为 15s（< `TIMEOUT_THRESHOLD = 20s`），让保活真正生效。同时清理文件头 docstring 与相关注释里的 stale `90 秒超时` 文案。

### 上游 SDK `console.info` 噪音过滤 (#571 / #536 / #573)

**现象**：日志反复出现
```
[2026-05-09T07:04:42.420Z] connect success
Disconnecting.
[2026-05-09T07:05:12.483Z] connect success
Disconnecting.
...
```
看起来像连接频繁掉线。

**根因**：
1. 上游 `dingtalk-stream@2.1.4` SDK 在 `client.cjs:138 / :185` 每次 `disconnect()` / `connect()` 时直接 `console.info(...)`，绕过 logger，在频繁重连场景下会刷屏
2. 钉钉服务端在 LB / 实例切换等场景下可能下发 `disconnect` topic，客户端需断开重连——这是协议机制
3. connector 在 `src/core/connection.ts:setupMessageListener` / `setupCloseListener` 中正确处理了重连，消息收发无感

**修复**：
- 在 `src/core/connection.ts` 新增 `silenceDingtalkStreamConsoleNoise()`：模块级一次性 patch `console.info`，**只过滤 `Disconnecting.` 和 `[time] connect success` 两条精确字符串**，其他 `console.info` 不受影响
- 在首个账号连上时通过 `printConnectionNoticeOnce()` 打印一次连接生命周期说明，解释过滤动机以及「高频重连不正常」的预期，多 bot 启动时不重复
- `setupMessageListener` 收到 `disconnect` topic 时加一行 `logger.debug`，便于排查时查看完整生命周期

## 🩹 改进 / Improvements

### 群聊空回复兜底文案带修复指引 (#589)

**现象**：群聊 @ 机器人时只看到「✅ 任务执行完成（无文本输出）」，没有任何模型回复内容。

**根因**：当 OpenClaw `messages.groupChat.visibleReplies` 未设为 `"automatic"` 时，上游 `source-reply-delivery-mode.ts` 对群聊默认走 `message_tool_only`：
- 不调 `onPartialReply` → connector `accumulatedText` 始终为空
- 大多数情况下也不调 `deliver(final)` → 三处空 final 兜底全部打到原文案

用户看到的只是一句无信息的「任务执行完成」，完全没线索去查 `openclaw.json`。

**修复**：
- 新增 `src/utils/empty-reply.ts` 集中兜底文案
- `reply-dispatcher.ts` 的 `closeStreaming` / `deliver` 空 final 分支：群聊改用带 `openclaw.json` 修复指引的可操作文案
- 新增 `maybeSendGroupVisibleRepliesIdleNudge`：在 `onIdle` / `onError` 时若本轮无任何用户可见输出（覆盖上游 `message_tool_only` 根本不调 `deliver()` 的盲区），主动 nudge 一条配置指引
- `core/message-handler.ts` 异步模式同点位分流
- warn 日志同步打印完整 `openclaw.json` 修复片段，便于运维直接复制
- **单聊文案保持不变**（`✅ 任务执行完成（无文本输出）`）：单聊空 final 通常是模型本身输出空，不需要指引噪音

### 新群聊兜底文案

```
ℹ️ 暂未收到模型回复内容。
若群聊频繁出现该提示，请联系机器人管理员检查 OpenClaw 配置：
`messages.groupChat.visibleReplies` 需设为 `"automatic"`
（详见 README / TROUBLESHOOTING.md）。
```

### 用户/运维侧修复

`~/.openclaw/openclaw.json` 加上：

```json
{
  "messages": {
    "groupChat": { "visibleReplies": "automatic" }
  }
}
```

然后 `openclaw gateway restart`。

> 跟进调研：插件侧直接覆盖 `sourceReplyDeliveryMode: "automatic"` 让用户不需要改 `openclaw.json` 的方案在 [Issue #591](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/591) 跟踪。

## 📚 文档 / Docs

- **TROUBLESHOOTING.md**：新增「群聊 @ 机器人只返回『任务执行完成（无文本输出）』」条目，给出修复步骤
- `silenceDingtalkStreamConsoleNoise` 周边的注释 / 函数命名 / banner 文案统一收紧（#592）
- 清理 `src/core/connection.ts` 中的 stale `90 秒超时` 文档残留（#594）

## 🔒 兼容性 / Compatibility

- **API 无变化**、配置 schema 无变化、导出符号无变化
- 不影响 #437 的心跳超时检测修复语义
- 单聊行为完全不变（兜底文案、流式行为都保持原样）
- 已配置 `messages.groupChat.visibleReplies = "automatic"` 的群聊行为完全不变

## 🧪 验证 / Verification

- 单测：`tests/empty-reply.unit.test.ts` 7/7 + `tests/reply-dispatcher` 7/7 通过
- 多位社区用户已对 #566 修复 +1 验证有效（@lizhiyao / @edokeh / @jeikl）
- 本机回归（macOS / OpenClaw 2026.5.7）：
  - 群聊 @ + `messages: {}` → 看到新的可操作指引
  - 群聊 @ + `visibleReplies = "automatic"` → 恢复正常流式
  - 单聊空 final → 文案不变

## ⏭ 下一步 / Next steps

- 社区验证 ~3 天稳定后晋升 GA `v0.8.21`
- [Issue #591](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/591)：插件侧 `sourceReplyDeliveryMode` 调研——下个迭代评估

## 📥 安装升级 / Installation & Upgrade

```bash
npx openclaw@latest add @dingtalk-real-ai/dingtalk-connector@0.8.21-beta.0
```

或：

```bash
npm install @dingtalk-real-ai/dingtalk-connector@beta
```

## 🔗 相关链接 / Related Links

- [完整变更日志](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- 关联 PRs / issues：#566 / #589 / #592 / #594 / #571 / #536 / #573 / #545

---

**发布日期 / Release Date**：2026-05-17  
**版本号 / Version**：v0.8.21-beta.0  
**兼容性 / Compatibility**：OpenClaw Gateway 2026.4.9+
