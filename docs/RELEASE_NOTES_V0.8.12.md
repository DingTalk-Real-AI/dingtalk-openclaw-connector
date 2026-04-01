# Release Notes - v0.8.12

## 🎉 新版本亮点 / Highlights

本次更新**修复了 v0.8.11 安装后启动崩溃的问题**（[#419](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/419)），同时**大幅精简依赖体积**，移除了约 100MB 的非核心依赖，并**清理了无效的代理禁用代码**。

This release **fixes the startup crash after v0.8.11 installation** ([#419](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/419)), **significantly reduces dependency size** by removing ~100MB of non-core dependencies, and **removes ineffective proxy bypass code**.

## 🐛 修复 / Fixes

- **修复 v0.8.11 安装后启动崩溃 / Fix startup crash after v0.8.11 installation** ([#419](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/419))  
  v0.8.11 将 `mammoth` 和 `pdf-parse` 从 `dependencies` 移至 `optionalDependencies`，但代码中仍使用静态 `import`，导致模块加载阶段立即报错 `Cannot find module 'mammoth'`，插件无法启动。现已改为动态 `import` + 优雅降级：缺失时打印警告并跳过，不影响核心功能。  
  v0.8.11 moved `mammoth` and `pdf-parse` from `dependencies` to `optionalDependencies`, but the code still used static `import`, causing immediate `Cannot find module 'mammoth'` error at module load time. Now uses dynamic `import` with graceful degradation: prints a warning and skips when missing, without affecting core functionality.

## 📦 依赖优化 / Dependency Optimization

- **移除大体积非核心依赖 / Remove large non-core dependencies**  
  将 `pdf-parse`（~21MB）、`fluent-ffmpeg`（~12MB）、`@ffmpeg-installer/ffmpeg`（~70MB）、`@ffprobe-installer/ffprobe` 从 `optionalDependencies` 中移除。这些包均已改为动态 `import`，缺失时优雅降级，需要时用户可手动安装。仅保留 `mammoth`（~2MB）在 `optionalDependencies` 中。  
  Removed `pdf-parse` (~21MB), `fluent-ffmpeg` (~12MB), `@ffmpeg-installer/ffmpeg` (~70MB), `@ffprobe-installer/ffprobe` from `optionalDependencies`. All packages now use dynamic `import` with graceful degradation. Users can manually install them when needed. Only `mammoth` (~2MB) remains in `optionalDependencies`.

## 🧹 代码清理 / Code Cleanup

- **移除无效的代理禁用代码 / Remove ineffective proxy bypass code**  
  经源码分析，`dingtalk-stream` SDK 的 WebSocket 连接使用 `ws` 库直接建立，不经过 axios 也不受 `axios.defaults.proxy` 影响。之前在 `connection.ts` 中设置 `axios.defaults.proxy = false` 以及 `http-client.ts` 中的 `proxy: getProxyConfig()` 对 WebSocket 连接无效。现已移除 `src/utils/proxy-config.ts` 模块及所有相关代理配置代码。  
  Source code analysis revealed that `dingtalk-stream` SDK's WebSocket connection uses the `ws` library directly, bypassing axios entirely. The previous `axios.defaults.proxy = false` in `connection.ts` and `proxy: getProxyConfig()` in `http-client.ts` had no effect on WebSocket connections. Removed `src/utils/proxy-config.ts` module and all related proxy configuration code.

## 📥 安装升级 / Installation & Upgrade

```bash
# 通过 npm 安装最新版本 / Install latest version via npm
openclaw plugins install @dingtalk-real-ai/dingtalk-connector

# 或升级现有版本 / Or upgrade existing version
openclaw plugins update dingtalk-connector

# 通过 Git 安装 / Install via Git
openclaw plugins install https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector.git
```

### 可选依赖手动安装 / Optional Dependencies

```bash
# Word 文档解析（自动安装，~2MB）
# mammoth is auto-installed as optionalDependency

# PDF 文档解析（需手动安装）
npm install pdf-parse

# 视频/音频转码（需手动安装）
npm install fluent-ffmpeg @ffmpeg-installer/ffmpeg @ffprobe-installer/ffprobe
```

## 🔗 相关链接 / Related Links

- [Issue #419](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues/419)
- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档 / Documentation](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)

---

**发布日期 / Release Date**：2026-04-01  
**版本号 / Version**：v0.8.12  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
