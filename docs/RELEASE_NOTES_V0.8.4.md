# Release Notes - v0.8.4

## 🎉 新版本亮点 / Highlights

v0.8.4 是一个兼容性修复版本，核心解决了插件在旧版 OpenClaw Gateway 上无法加载的问题。通过将 `createPluginRuntimeStore` 内联实现，插件现在可以在任意版本的 OpenClaw 上正常运行，无需担心版本兼容性。

v0.8.4 is a compatibility fix release that resolves plugin loading failures on older OpenClaw Gateway versions. By inlining the `createPluginRuntimeStore` implementation, the plugin now works correctly on any version of OpenClaw without version compatibility concerns.

## 🐛 修复 / Fixes

- **兼容旧版 OpenClaw Gateway（createPluginRuntimeStore 缺失）/ Compatible with older OpenClaw Gateway (missing createPluginRuntimeStore)**  
  修复在旧版 OpenClaw Gateway 上加载插件时报错 `TypeError: (0 , _pluginSdk.createPluginRuntimeStore) is not a function` 的问题。根因是 `src/runtime.ts` 直接从 `openclaw/plugin-sdk` 导入 `createPluginRuntimeStore`，而该函数在旧版 SDK 中并不存在。现已将其替换为内联实现的 `createRuntimeStore`，功能完全等价，不再依赖 SDK 版本。  
  Fixed `TypeError: (0 , _pluginSdk.createPluginRuntimeStore) is not a function` when loading the plugin on older OpenClaw Gateway versions. Root cause: `src/runtime.ts` imported `createPluginRuntimeStore` directly from `openclaw/plugin-sdk`, which doesn't exist in older SDK versions. Replaced with an inline `createRuntimeStore` implementation that is fully equivalent and no longer depends on SDK version.

- **openclaw 依赖版本约束放宽 / Relaxed openclaw dependency version constraint**  
  将 `package.json` 中的 `"openclaw": "^2026.3.0"` 改为 `"openclaw": "*"`。openclaw 由框架环境提供，插件不应限制其版本范围，避免版本约束导致安装失败或与用户已安装版本冲突。  
  Changed `"openclaw": "^2026.3.0"` to `"openclaw": "*"` in `package.json`. Since openclaw is provided by the framework environment, the plugin should not restrict its version range to avoid installation failures or conflicts with the user's installed version.

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

**发布日期 / Release Date**：2026-03-24  
**版本号 / Version**：v0.8.4  
**兼容性 / Compatibility**：OpenClaw Gateway 所有版本 / All versions
