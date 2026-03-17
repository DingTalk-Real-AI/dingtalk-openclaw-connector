# Release Notes - v0.7.10

## ✨ 功能与体验改进 / Features & Improvements

- **WebSocket 心跳重连机制优化 / WebSocket Reconnection**  
  WebSocket 会持续尝试重连，保留指数退避策略（1s → 2s → 4s → 8s → 16s → 30s），避免雪崩效应。重连成功后重置计数器，下次失败从 1 秒开始退避。  
  Removed maximum reconnection attempt limit, implemented infinite reconnection mechanism. WebSocket will continuously attempt to reconnect without giving up. Exponential backoff strategy retained (1s → 2s → 4s → 8s → 16s → 30s) to avoid avalanche effect. Counter resets on successful reconnection, starting from 1 second on next failure.

- **配置简化 / Configuration Simplification**  
  从 `SocketManagerConfig` 中移除 `maxReconnectAttempts` 配置项，简化配置复杂度。  
  Removed `maxReconnectAttempts` configuration from `SocketManagerConfig`, simplifying configuration complexity.

- **日志输出优化 / Log Output Optimization**  
  更新重连日志格式，移除最大次数显示（从 "尝试 X/5" 改为 "尝试 X"），更清晰地展示重连进度。  
  Updated reconnection log format, removed maximum attempt display (from "attempt X/5" to "attempt X"), providing clearer reconnection progress.


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

**发布日期 / Release Date**：2026-03-16  
**版本号 / Version**：v0.7.10  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
