# Release Notes - v0.8.17

## 🎉 新版本亮点 / Highlights

本次版本最大亮点是 **钉钉 DWS CLI 集成** 和 **Agent Skills 体系**，让钉钉机器人不仅能聊天，还能直接操作 AI 表格、日历、通讯录、待办、审批等钉钉产品能力。同时引入 `tsdown` 预编译构建，提升插件启动速度和兼容性。

The highlight of this release is **DingTalk Workspace (DWS) CLI integration** and the **Agent Skills system**, enabling the bot to not only chat but also directly operate DingTalk products like AI Table, Calendar, Contacts, Todo, Approval, and more. Additionally, `tsdown` pre-compiled build is introduced for faster startup and better compatibility.

## ✨ 新增 / Added

- **钉钉 DWS CLI 集成 / DWS CLI Integration**  
  安装插件时自动安装 `dws` CLI 工具，支持 AI 表格、日历、通讯录、群聊与机器人、待办、审批、考勤、日志等钉钉产品能力。凭证自动注入，无需手动配置。可通过 `--skip-dws` 参数跳过。  
  Auto-installs `dws` CLI during plugin setup, enabling AI Table, Calendar, Contacts, Chat & Bot, Todo, Approval, Attendance, Report and more. Credentials injected automatically. Use `--skip-dws` to skip.

- **Agent Skills 体系 / Agent Skills System**  
  新增三组内置 Skill 文档，通过 `openclaw.plugin.json` 注册，Agent 可自动引用：  
  - `dingtalk-channel-rules` — 频道能力路由规范，明确 Connector 与 DWS 的职责边界  
  - `dingtalk-troubleshoot` — 常见问题排查指南  
  - `dws-cli` — DWS CLI 使用指南与产品参考（含 AI 表格、日历、通讯录等 9 个产品文档）  
  
  Added three built-in Skill document sets registered via `openclaw.plugin.json`:
  - `dingtalk-channel-rules` — Channel capability routing, Connector vs DWS responsibility boundary  
  - `dingtalk-troubleshoot` — Troubleshooting guide  
  - `dws-cli` — DWS CLI guide with 9 product reference docs (AI Table, Calendar, Contacts, etc.)

## 🐛 修复 / Fixes

- **AI Card finishAICard QPS 限流 / finishAICard QPS rate limiting**  
  `finishAICard` 的 PUT 请求现在也经过全局令牌桶限流器 `waitForToken()`，避免多会话并发结束时触发 403 QpsLimit。  
  `finishAICard` PUT request now goes through global token bucket to prevent 403 QpsLimit on concurrent finishes.

- **Probe 接口迁移到统一 HTTP 客户端 / Probe migrated to HTTP client**  
  `probe.ts` 中的 token 获取和 bot 信息查询从 `fetch` 迁移到统一的 `dingtalkHttp` 客户端，修复潜在的代理和错误处理不一致问题。  
  Token and bot info requests migrated from `fetch` to unified `dingtalkHttp` client.

- **安全扫描误报规避 / Security scanner false positive avoidance**  
  重构环境变量和 fetch 访问方式，避免 OpenClaw 安全扫描将合法凭证读取误报为 "credential harvesting"。  
  Refactored env and fetch access to avoid OpenClaw security scanner false positives.

- **DWS 凭证隔离 / DWS credential isolation**  
  DWS clientId/clientSecret 存储在模块作用域私有 holder 中，不注入 `process.env`，防止子进程泄露凭证。  
  DWS credentials stored in module-scoped holder instead of `process.env`, preventing leaks via child processes.

## ✅ 改进 / Improvements

- **预编译构建 (tsdown) / Pre-compiled build**  
  引入 `tsdown` 构建工具，插件发布为预编译的 `dist/index.mjs`，替代 jiti 运行时 TS 加载，提升启动速度和兼容性。  
  Plugin now ships pre-compiled via `tsdown` instead of relying on jiti runtime TS loading.

- **Channel ID 常量化 / Channel ID as constant**  
  提取 `CHANNEL_ID = "dingtalk-connector"` 为模块级常量，消除全代码库硬编码字符串。  
  Extracted `CHANNEL_ID` as module-level constant, eliminating hardcoded strings.

- **CLI 安装流程增强 / CLI install flow enhancement**  
  新增 `--skip-dws` 参数跳过 DWS CLI 安装；安装成功后提示网关初始化需约 3 分钟。  
  Added `--skip-dws` flag; post-install message mentions ~3 min gateway warm-up.

- **依赖版本锁定 / Dependency version pinning**  
  `form-data`、`qrcode-terminal`、`zod` 从 `^` 范围锁定为精确版本；`openclaw` peerDependency 改为 `>=2026.3.23`。  
  Pinned `form-data`, `qrcode-terminal`, `zod` to exact versions; `openclaw` peer changed to `>=2026.3.23`.

- **npm 发包优化 / npm publish optimization**  
  新增 `prepack`/`postpack` 脚本在发包时自动剥离 `devDependencies`，减小安装体积；`files` 列表新增 `dist/` 和 `skills/`。  
  Added `prepack`/`postpack` scripts to strip `devDependencies` during publish.

## 📥 安装升级 / Installation & Upgrade

```bash
npx -y @dingtalk-real-ai/dingtalk-connector@0.8.17 install
```

或手动安装：
```bash
openclaw plugins install @dingtalk-real-ai/dingtalk-connector
```

## 🔗 相关链接 / Related Links

- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档 / Documentation](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)
- [多 Agent 协作 / Multi-Agent Collaboration](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/docs/MULTI_AGENT_COLLABORATION.md)

---

**发布日期 / Release Date**：2026-04-16  
**版本号 / Version**：v0.8.17  
**兼容性 / Compatibility**：OpenClaw Gateway 2026.3.23+
