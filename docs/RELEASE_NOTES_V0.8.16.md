# Release Notes - v0.8.15-beta.1

## 🎉 新版本亮点 / Highlights

本次 beta 版本主要修复 AI Card 流式更新频繁触发钉钉 QPS 限流的问题，通过引入全局令牌桶限流器，确保多会话并发时不超过钉钉 API 速率限制。

This beta release fixes frequent DingTalk QPS rate limiting during AI Card streaming updates by introducing a global token bucket rate limiter that enforces API rate limits across all concurrent sessions.

## 🐛 修复 / Fixes

- **AI Card 流式更新 QPS 限流 / AI Card streaming QPS rate limiting**  
  新增全局令牌桶限流器（`cardRateLimiter`），所有会话共享同一速率限制（20 QPS），避免多会话并发时总 QPS 叠加超过钉钉 API 限制（~40 次/秒）。遇到 403 QpsLimit 错误时自动退避 2 秒后重试一次，确保 finalize 等关键更新不丢失。  
  Added global token bucket rate limiter (`cardRateLimiter`) shared across all sessions (20 QPS cap). Automatically backs off for 2 seconds and retries once on 403 QpsLimit errors, ensuring critical updates like finalize are not lost.

- **streamAICard null card 崩溃 / streamAICard null card crash**  
  修复 `createAICardForTarget` 创建失败返回 `null` 后，调用方通过 `as any` 绕过类型检查传入 `streamAICard`，导致 `Cannot read properties of null (reading 'tokenExpireTime')` 崩溃的问题。现在 `streamAICard` 入口添加了 null 守卫，安全跳过并打印警告日志。  
  Fixed crash when `createAICardForTarget` returns `null` and callers bypass type checking with `as any`. Added null guard at `streamAICard` entry point.

## ✅ 改进 / Improvements

- **单实例节流间隔优化 / Per-instance throttle interval optimization**  
  `reply-dispatcher.ts` 中的 `updateInterval` 从 500ms 增大到 800ms，配合全局限流器降低单实例发送频率，减少不必要的 API 调用。  
  Increased `updateInterval` from 500ms to 800ms in `reply-dispatcher.ts` to complement the global rate limiter and reduce unnecessary API calls.

## 📥 安装升级 / Installation & Upgrade

```bash
openclaw plugins install @dingtalk-real-ai/dingtalk-connector@0.8.15-beta.1
```

## 🔗 相关链接 / Related Links

- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档 / Documentation](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)

---

**发布日期 / Release Date**：2026-04-16  
**版本号 / Version**：v0.8.16 
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
