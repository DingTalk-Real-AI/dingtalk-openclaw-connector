# Release Notes - v0.8.21-beta.0

## 🎉 本次重点 / Highlights

过滤上游 `dingtalk-stream@2.1.4` SDK 直接走 `console.info` 输出的 `Disconnecting.` / `connect success` 噪音日志（#571 / #536 / #573），并在启动时打印一次连接生命周期说明。

Filter the noisy `Disconnecting.` / `connect success` lines emitted via `console.info` by upstream `dingtalk-stream@2.1.4` SDK (#571 / #536 / #573), and print a one-time connection-lifecycle notice at startup.

## 🐛 修复 / Fixes

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
