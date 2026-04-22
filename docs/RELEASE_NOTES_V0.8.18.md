# Release Notes - v0.8.18

## 🎉 新版本亮点 / Highlights

本次版本聚焦 **流式中断故障恢复** 和 **多 Agent 安装保护**。新增 `fixStuckCards` Gateway Method 解决 Gateway 重启后 AI Card 卡住和表情残留问题；安装向导增加多 Agent 配置检测，防止已有路由配置被意外覆盖。

This release focuses on **streaming interruption recovery** and **multi-Agent install protection**. Added `fixStuckCards` Gateway Method to fix stuck AI Cards and lingering emotion tags after gateway restart; install wizard now detects existing multi-Agent config to prevent accidental overwrite.

## 🐛 修复 / Fixes

- **AI Card 流式中断残留修复 (#463) / AI Card stuck state fix**
  Gateway 重启导致流式响应中断时，AI Card 停留在"思考中"动画、用户消息上的🤔表情标签未自动撤回。新增 `dingtalk-connector.fixStuckCards` Gateway Method，支持手动修复卡住的 AI Card 和/或撤回残留表情。
  When streaming is interrupted by gateway restart, AI Card stays in "thinking" animation and 🤔 emotion tag is not auto-recalled. Added `dingtalk-connector.fixStuckCards` Gateway Method for manual recovery.

  ```typescript
  // 修复卡住的 AI Card
  await gateway.call('dingtalk-connector.fixStuckCards', {
    cardInstanceId: 'card_1713600000000_abc12345',
    content: '（回复中断，请重新提问）'
  });

  // 撤回残留的🤔表情
  await gateway.call('dingtalk-connector.fixStuckCards', {
    msgId: 'msgXXX',
    conversationId: 'cidXXX'
  });
  ```

- **多 Agent 配置覆盖保护 / Multi-Agent config overwrite protection**
  安装向导检测到 `openclaw.json` 中已有钉钉 channels + bindings 配置（多 Agent 场景）时，**跳过自动写入**，展示本次选择的机器人凭证信息，让用户自行决定是否修改配置。避免多 Agent 路由被意外覆盖。
  Install wizard detects existing DingTalk channels + bindings config (multi-Agent scenario), skips auto-write, and displays credentials for user to decide. Prevents accidental multi-Agent routing breakage.

## ✅ 改进 / Improvements

- **OpenClaw 版本兼容性 / OpenClaw version compatibility**
  `peerDependency` 从 `>=2026.3.23` 升级到 `>=2026.4.9`，兼容 OpenClaw 2026.4.15 中的 plugin-sdk 变更。
  `peerDependency` bumped from `>=2026.3.23` to `>=2026.4.9`, compatible with OpenClaw 2026.4.15 plugin-sdk changes.

- **README 能力展示优化 / README capability display**
  已支持的业务能力（待办任务、AI 表格、日历日程）从独立区块整合到主能力表格，Coming Soon 区域同步更新。
  Supported business capabilities (Todo, AI Table, Calendar) consolidated into main capability table; Coming Soon section updated.

## 📥 安装升级 / Installation & Upgrade

```bash
npx openclaw@latest add @dingtalk-real-ai/dingtalk-connector
```

或指定版本：
```bash
npx openclaw@latest add @dingtalk-real-ai/dingtalk-connector@0.8.18
```

## 🔗 相关链接 / Related Links

- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档 / Documentation](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)
- [故障排查 / Troubleshooting](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/docs/TROUBLESHOOTING.md)

---

**发布日期 / Release Date**：2026-04-21
**版本号 / Version**：v0.8.18
**兼容性 / Compatibility**：OpenClaw Gateway 2026.4.9+
