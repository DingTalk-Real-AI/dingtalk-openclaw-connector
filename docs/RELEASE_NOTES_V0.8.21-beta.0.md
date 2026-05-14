# Release Notes - v0.8.21-beta.0

## 🎉 本次重点 / Highlights

抑制上游 `dingtalk-stream@2.1.4` SDK 在 30 秒负载均衡断连周期里的日志刷屏问题（#571 / #536 / #573），并在启动时给出一次性协议机制说明，消除"看起来在故障"的误导。

Silence the log-spamming behavior of upstream `dingtalk-stream@2.1.4` SDK during the 30s load-balance reconnect cycle (#571 / #536 / #573), and print a one-time protocol-mechanism notice at startup to remove the "looks-like-failure" misperception.

## 🐛 修复 / Fixes

### 上游 SDK 30s 负载均衡日志刷屏 (#571 / #536 / #573)

**现象**：日志反复出现
```
[2026-05-09T07:04:42.420Z] connect success
Disconnecting.
[2026-05-09T07:05:12.483Z] connect success
Disconnecting.
...
```
每约 30 秒一次，看起来像连接频繁掉线。

**根因**：
1. 钉钉 Stream 服务端会周期性下发 `disconnect` topic（约 30s/次）做负载均衡，客户端必须立即断开重连 —— 这是钉钉协议设计
2. 上游 `dingtalk-stream@2.1.4` SDK 在 `client.cjs:138 / :185` 直接 `console.info("Disconnecting.")` / `[time] connect success`，绕过 logger，单 bot 也会刷屏
3. 我们的 connector 早就在 `src/core/connection.ts:setupMessageListener` / `setupCloseListener` 中正确处理了重连，消息收发实际无感

**修复**：
- 在 `src/core/connection.ts` 新增 `silenceDingtalkStreamConsoleNoise()`：模块级一次性 patch `console.info`，**只过滤 `Disconnecting.` 和 `[time] connect success` 两条精确字符串**，其他 `console.info` 不受影响
- 在首个账号连上时通过 `printLoadBalanceNoticeOnce()` 打印一次「30s 周期断连属正常机制」说明，多 bot 启动时不会重复
- `setupMessageListener` 收到 `disconnect` topic 时加一行 `logger.debug`，便于排查时查看完整生命周期

## 🔒 兼容性 / Compatibility

- **不改动** `startKeepAlive` / `setupPongListener` / `lastSocketAvailableTime` 写入时机
- **不影响** #437 的心跳超时检测修复（dead connection 仍在 20~30s 内被检测并自动重连）
- 配置 schema 无变化
- API 无变化

## ⏭ 下一步 / Next steps (under evaluation)

- 多 bot 重连错峰（jitter），降低同 gateway 内集中重连压力
- 重连窗口内消息缓存与重投递评估
- 与钉钉 Stream 服务端对齐单实例驻留时间策略

进展持续在 #506 同步。

## 📥 安装升级 / Installation & Upgrade

```bash
npx openclaw@latest add @dingtalk-real-ai/dingtalk-connector@0.8.21-beta.0
```

## 🔗 相关链接 / Related Links

- [完整变更日志](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- 关联 issues: #571 / #536 / #573 / #545

---

**发布日期 / Release Date**：2026-05-14  
**版本号 / Version**：v0.8.21-beta.0  
**兼容性 / Compatibility**：OpenClaw Gateway 2026.4.9+
