# Release Notes - v0.8.11

## 🎉 新版本亮点 / Highlights

本次更新**升级 Zod 至 v4**，并通过 SDK 的 `buildChannelConfigSchema` 自动生成 `configSchema`，同时**优化依赖结构**大幅减小安装体积。

This release **upgrades Zod to v4** with auto-generated `configSchema` via SDK's `buildChannelConfigSchema`, and **optimizes dependency structure** to significantly reduce installation size.

## ✨ 功能与体验改进 / Features & Improvements

- **升级 Zod v4 + 自动生成 configSchema / Upgrade Zod v4 + auto-generate configSchema**  
  将 Zod 从 v3 升级至 v4（`zod@^4.3.6`），利用 Zod v4 的 `toJSONSchema()` 能力，通过 SDK 提供的 `buildChannelConfigSchema()` 自动从 Zod Schema 生成 JSON Schema，替代原来手动维护的 `configSchema.schema` 对象，确保配置验证与类型定义始终同步。  
  Upgraded Zod from v3 to v4 (`zod@^4.3.6`), leveraging Zod v4's `toJSONSchema()` capability to auto-generate JSON Schema via SDK's `buildChannelConfigSchema()`, replacing the manually maintained `configSchema.schema` object to ensure config validation stays in sync with type definitions.

## 📦 依赖优化 / Dependency Optimization

- **openclaw 移至 peerDependencies / Move openclaw to peerDependencies**  
  将 `openclaw` 从 `dependencies` 移至 `peerDependencies`（标记为 optional），避免插件安装时重复安装宿主框架，大幅减小 `node_modules` 体积。  
  Moved `openclaw` from `dependencies` to `peerDependencies` (marked as optional), preventing duplicate installation of the host framework and significantly reducing `node_modules` size.

- **ffmpeg 相关包移至 optionalDependencies / Move ffmpeg packages to optionalDependencies**  
  将 `fluent-ffmpeg`、`@ffmpeg-installer/ffmpeg`、`@ffprobe-installer/ffprobe` 移至 `optionalDependencies`，这些包仅在视频/音频转码场景使用（通过动态 require 加载），安装失败不影响核心功能。  
  Moved `fluent-ffmpeg`, `@ffmpeg-installer/ffmpeg`, `@ffprobe-installer/ffprobe` to `optionalDependencies`. These packages are only used for video/audio transcoding (loaded via dynamic require) and won't affect core functionality if installation fails.

- **移除未使用的 pako 依赖 / Remove unused pako dependency**  
  移除了未被任何代码引用的 `pako` 包。  
  Removed the `pako` package which was not referenced by any code.

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

**发布日期 / Release Date**：2026-04-01  
**版本号 / Version**：v0.8.11  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
