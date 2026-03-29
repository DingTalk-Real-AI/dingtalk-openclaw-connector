# Release Notes - v0.8.8

## 🎉 新版本亮点 / Highlights

本次更新专注于**流式响应稳定性**、**Web UI 状态显示**和**媒体发送正确性**三大核心问题的修复。重构了 AI Card 并发创建逻辑，彻底解决多 block 响应产生多条独立气泡的问题；修复了 Web UI 中 Connected / Last inbound 字段始终显示 n/a 的问题；同时修正了文件发送时参数传递错误导致发送失败的 bug。

This release focuses on three core fixes: **streaming response stability**, **Web UI status display**, and **media sending correctness**. It refactors the AI Card concurrent creation logic to eliminate the multi-bubble issue in multi-block responses, fixes the Web UI showing n/a for Connected/Last inbound fields, and corrects a parameter error that caused file sending to fail.

## 🐛 修复 / Fixes

- **多 block 流式响应产生多条独立气泡 / Multi-block streaming response creates multiple bubbles** ([#369](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/369))  
  重构 `startStreaming` 的并发控制逻辑，从 `isCreatingCard` 布尔标志改为 `cardCreationPromise`，`await startStreaming()` 天然等待创建完成，彻底消除多 block 响应场景下每个 block 新建独立 AI Card 气泡的问题。  
  Refactored `startStreaming` concurrency control from a boolean `isCreatingCard` flag to a `cardCreationPromise`. `await startStreaming()` naturally waits for creation to complete, eliminating the issue where each block in a multi-block response created an independent AI Card bubble.

- **Web UI Connected / Last inbound 显示 n/a / Web UI shows n/a for Connected and Last inbound**  
  在 `src/core/connection.ts` 中新增 `onStatusChange` 回调，在连接建立、断开、收到消息时分别上报 `connected`、`lastConnectedAt`、`lastInboundAt` 字段；同时补全 `buildSessionContext` 在 `separateSessionByConversation: false` 分支中 `conversationId` 和 `groupSubject` 字段的透传。  
  Added `onStatusChange` callback in `src/core/connection.ts` to report `connected`, `lastConnectedAt`, and `lastInboundAt` fields on connection established, disconnected, and message received events. Also fixed `buildSessionContext` to correctly pass through `conversationId` and `groupSubject` fields in the `separateSessionByConversation: false` branch.

- **AI Card 函数调用参数错误 / AI Card function call parameter error**  
  修复 `src/reply-dispatcher.ts` 中 `createAICardForTarget`、`streamAICard`、`finishAICard` 的第三个参数从 `params.runtime` 改为 `account.config as DingtalkConfig`，第四个参数补充 `log`，确保函数签名与实现一致。  
  Fixed the third parameter of `createAICardForTarget`, `streamAICard`, and `finishAICard` in `src/reply-dispatcher.ts` from `params.runtime` to `account.config as DingtalkConfig`, and added `log` as the fourth parameter to match the function signatures.

- **sendFileProactive 参数错误导致文件发送失败 / File sending failure due to wrong sendFileProactive parameter**  
  修复 `src/services/media.ts` 中 `processFileMarkers` 和 `processRawMediaPaths` 调用 `sendFileProactive` 时错误地传入 `uploadResult.downloadUrl`，现已改为正确的 `uploadResult.cleanMediaId`，确保主动 API 模式下文件消息能正常发送。  
  Fixed `processFileMarkers` and `processRawMediaPaths` in `src/services/media.ts` incorrectly passing `uploadResult.downloadUrl` to `sendFileProactive`; now correctly uses `uploadResult.cleanMediaId` to ensure file messages are sent successfully in proactive API mode.

- **纯多账号配置下 probe 被跳过 / Probe skipped in pure multi-account config** ([#381](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/381))  
  修复 `src/onboarding.ts` 的 `getStatus()` 中，纯多账号配置（credentials 仅在 `accounts.*` 下）时 probe 被静默跳过，状态永远显示 "configured (connection not verified)" 的问题。现已改用 `resolveDingtalkAccount()` 统一获取账号信息。  
  Fixed `getStatus()` in `src/onboarding.ts` silently skipping probe in pure multi-account configs (credentials only under `accounts.*`), causing status to always show "configured (connection not verified)". Now uses `resolveDingtalkAccount()` for unified account resolution.

## ✨ 改进 / Improvements

- **音频时长提取安全性改进 / Audio duration extraction security improvement** ([#134](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/134))  
  将 `extractAudioDuration` 从直接调用 `child_process.exec` 改为使用 `fluent-ffmpeg` 的 `ffprobe` API，与 `extractVideoMetadata` 保持一致，消除安全扫描误报。  
  Changed `extractAudioDuration` from directly calling `child_process.exec` to using `fluent-ffmpeg`'s `ffprobe` API, consistent with `extractVideoMetadata`, eliminating false positives in security scans.

- **SDK 接口迁移 / SDK interface migration**  
  将 `src/onboarding.ts` 中的类型引用从旧版 `ChannelOnboardingAdapter` 迁移到新版 `ChannelSetupWizardAdapter`，并将 `promptSingleChannelSecretInput` 的导入路径从 `openclaw/plugin-sdk` 更新为 `openclaw/plugin-sdk/setup`，适配最新 SDK 接口。  
  Migrated type references in `src/onboarding.ts` from the legacy `ChannelOnboardingAdapter` to the new `ChannelSetupWizardAdapter`, and updated the import path of `promptSingleChannelSecretInput` from `openclaw/plugin-sdk` to `openclaw/plugin-sdk/setup` to align with the latest SDK interface.

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

**发布日期 / Release Date**：2026-03-29  
**版本号 / Version**：v0.8.8  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
