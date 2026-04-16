# Release Notes - v0.8.15

## 🎉 新版本亮点 / Highlights

本次更新带来**一键扫码安装**体验：用户只需执行一条 `npx` 命令，通过钉钉扫码即可自动完成机器人创建、凭证获取、插件安装和配置写入，实现零手动配置。同时全面重写了 README 文档，新增手动配置指南和故障排查文档。

This release introduces a **one-click QR install** experience: users run a single `npx` command, scan with DingTalk to automatically create a bot, obtain credentials, install the plugin, and write config — zero manual configuration. Also includes a complete README overhaul and new manual setup and troubleshooting guides.

## ✨ 新功能 / New Features

- **一键扫码安装 / One-click QR install**  
  新增 `npx -y @dingtalk-real-ai/dingtalk-connector install` 命令，通过钉钉扫码一键完成：机器人创建 → 凭证获取 → 插件安装 → 配置写入 → 重启提示。  
  Added `npx` CLI command for one-click DingTalk bot setup via QR scan: bot creation → credential acquisition → plugin install → config write → restart guidance.

- **Device Authorization Flow**  
  新增 `device-auth.ts` 模块，实现钉钉 Device Flow 授权（init → begin → poll），支持 QR 码终端渲染（`qrcode-terminal`）、2 分钟瞬时错误重试窗口。  
  New `device-auth.ts` module implementing DingTalk Device Flow (init → begin → poll) with terminal QR rendering and 2-minute transient error retry window.

- **Onboarding 扫码授权集成 / Onboarding QR auth integration**  
  `onboarding.ts` 配置向导首选一键扫码授权，失败时自动降级为手动输入 Client ID / Client Secret。  
  Setup wizard now prefers one-click QR authorization, with automatic fallback to manual credential input on failure.

- **CLI 凭证暂存与恢复 / Credential staging & recovery**  
  当插件安装失败时，凭证保存到独立的 `.dingtalk-staging.json`，避免污染 `openclaw.json`；下次运行安装成功后自动恢复凭证并清理暂存文件。  
  Credentials saved to separate staging file on plugin install failure to avoid config pollution; auto-recovered on next successful install.

- **CLI 安装前自动清理 / Pre-install cleanup**  
  安装前自动删除旧版插件目录（`~/.openclaw/extensions/dingtalk-connector`），清理 `openclaw.json` 中的过期 channel/plugin/allow 配置，避免 "unknown channel id" 等验证错误。  
  Auto-removes old plugin directory and stale config entries before install to prevent validation errors.

- **CLI 429 限流重试 / Rate limit retry**  
  插件安装遇到 ClawHub 429 限流时，使用 `Atomics.wait` 同步等待（15s/30s）后重试，最多 3 次。  
  Plugin install retries up to 3 times with synchronous backoff (15s/30s) on ClawHub 429 rate limiting.

## ✅ 改进 / Improvements

- **Prerelease 版本自动识别 / Prerelease version auto-detection**  
  CLI `install` 命令自动检测当前 package 是否为 prerelease 版本（alpha/beta/rc/canary），若是则传递精确版本号给 `openclaw plugins install`。  
  CLI auto-detects prerelease versions and passes exact version spec to `openclaw plugins install`.

- **手动配置文档拆分 / Manual setup docs separation**  
  手动创建机器人和手动配置流程从 README 拆分到独立的 `docs/DINGTALK_MANUAL_SETUP.md`，README 精简为快速入门。  
  Manual bot creation and config steps extracted to `docs/DINGTALK_MANUAL_SETUP.md`.

- **README 全面重写 / README overhaul**  
  参考飞书 OpenClaw 插件风格重写中英文 README，精简结构，突出核心功能，常见问题迁移到独立文档。  
  Rewrote Chinese and English README following Lark plugin style, streamlined structure.

- **GitHub 索引优化 / GitHub index optimization**  
  新增 `.gitattributes` 排除 `coverage/` 和 `docs/` 的语言统计；优化 `package.json` keywords、description、openclaw channel 元数据；`openclaw.plugin.json` 移除冗余字段。  
  Added `.gitattributes` for language detection; optimized package metadata; cleaned plugin manifest.

## 📝 文档 / Documentation

- 新增 `docs/DINGTALK_MANUAL_SETUP.md` — 完整的手动创建机器人和配置 OpenClaw 流程
- 新增 `docs/TROUBLESHOOTING.md` — 常见问题排查（机器人不回复、配置校验、HTTP 401/400、安装失败、国内网络等）
- Added `docs/DINGTALK_MANUAL_SETUP.md` — Complete manual bot creation and OpenClaw config guide
- Added `docs/TROUBLESHOOTING.md` — Troubleshooting guide for common issues

## 📥 安装升级 / Installation & Upgrade

```bash
# 一键扫码安装（推荐）/ One-click QR install (recommended)
npx -y @dingtalk-real-ai/dingtalk-connector install

# 从 npm 安装 / Install from npm
openclaw plugins install @dingtalk-real-ai/dingtalk-connector

# 更新 / Update
openclaw plugins update dingtalk-connector

# 从 GitHub 安装 / Install from GitHub
openclaw plugins install https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector.git
```

## 🔗 相关链接 / Related Links

- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档 / Documentation](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)
- [故障排查 / Troubleshooting](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/docs/TROUBLESHOOTING.md)

---

**发布日期 / Release Date**：2026-04-15  
**版本号 / Version**：v0.8.15  
**兼容性 / Compatibility**：OpenClaw ≥ 2026.4.9
