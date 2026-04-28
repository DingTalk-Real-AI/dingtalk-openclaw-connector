# Release Notes - v0.8.20

## 🎉 新版本亮点 / Highlights

本次版本聚焦 **OpenClaw 兼容性修复** 和 **DWS CLI 版本管理优化**。修复了插件安装到 `~/.openclaw/extensions/` 时因 ESM 裸说明符解析导致的加载崩溃（Issue #527），并重构了 DWS CLI 的版本升级/降级策略，提升安装体验。

This release focuses on **OpenClaw compatibility fixes** and **DWS CLI version management improvements**. Fixes a plugin load crash caused by ESM bare specifier resolution when installed to `~/.openclaw/extensions/` (Issue #527), and refactors DWS CLI upgrade/downgrade logic for a smoother install experience.

## 🐛 修复 / Fixes

- **OpenClaw 插件加载兼容性 (Issue #527) / Plugin load compatibility**
  `configSchema` 改为延迟初始化，通过 `createRequire` 解析 `openclaw/plugin-sdk/core`，修复插件安装到 `~/.openclaw/extensions/` 时 ESM 裸说明符解析失败导致的 "Cannot find package 'openclaw'" 崩溃。
  `configSchema` deferred to lazy init via `createRequire`, fixing "Cannot find package 'openclaw'" crash when plugin is installed to `~/.openclaw/extensions/`.

- **Onboarding 动态导入 / Dynamic import for onboarding**
  `promptSingleChannelSecretInput` 从静态 import 改为动态 `import()`，避免在 ESM 加载阶段触发同样的裸说明符解析错误。
  `promptSingleChannelSecretInput` switched from static to dynamic `import()` to avoid bare specifier resolution error during ESM loading.

## ✅ 改进 / Improvements

- **DWS CLI 版本管理重构 / Version management refactor**
  `ensureDwsCli()` 新增 `compareVersions()` 语义版本比较，支持四种场景：
  - 目标版本更高 → 自动升级 / Auto-upgrade when target is newer
  - 本地版本更高 → 询问是否覆盖 / Prompt before downgrade
  - 版本一致 → 跳过 / Skip when equal
  - 全新安装 → 显示已安装版本号 / Show version on fresh install

## 📥 安装升级 / Installation & Upgrade

```bash
npx openclaw@latest add @dingtalk-real-ai/dingtalk-connector
```

或指定版本：
```bash
npx openclaw@latest add @dingtalk-real-ai/dingtalk-connector@0.8.20
```

## 🔗 相关链接 / Related Links

- [完整变更日志](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)
- [故障排查](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/docs/TROUBLESHOOTING.md)

---

**发布日期 / Release Date**：2026-04-28
**版本号 / Version**：v0.8.20
**兼容性 / Compatibility**：OpenClaw Gateway 2026.4.9+
