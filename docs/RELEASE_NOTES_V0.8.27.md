# v0.8.27 发布说明

发布日期：2026-10-20。

本版本合入消息与会话能力对齐，以及旧 WebSocket 延迟关闭引发重复重连的修复。最低宿主版本仍为 OpenClaw `2026.8.1`；v2 卡片和实验多助手需要显式配置开启。

## 新增能力

来自 [PR #673](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/673)：

- 按账号、会话和精确消息 ID 恢复已观察到的引用消息，支持有界持久缓存与常见 UTF-8 文本附件抽取。
- 可选 v2 结构化流式 AI 卡片，提供工具状态、内联图片和宿主实际提供的运行元数据；随包提供可导入模板与第三方许可声明。
- 原生 `dingtalk_ask_user_question` 工具，支持确认、单选、多选及多字段表单；提交后在原 Agent 会话开启新一轮续聊。
- 可选显式 `@别名` 多助手路由，以及 `/btw` 旁路快答和停止生成入口。
- 标准入口与 bundled 入口共用能力注册，并声明宿主要求的工具契约。

配置方法、表单生命周期、会话隔离及权限要求见 [社区能力对齐使用说明](COMMUNITY_CAPABILITY_ALIGNMENT.md)。

## 重连修复

来自 [PR #678](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/pull/678)：

服务端触发重连后，旧连接的 `close` 事件可能晚于新连接建立。现在仅处理当前连接的关闭事件，并在排队回调执行前再次核对连接身份，避免旧回调把健康的新连接标记离线并再次关闭。当前连接正常关闭和停止后的行为保留原有语义。

## 本轮验证

验证环境：macOS arm64、Node `22.22.3`、OpenClaw `2026.8.1`。

- 两个 PR 的最终合并组合构建通过，`git diff --check` 通过。
- 同一套依赖下，固定主分支基线为 539 通过、5 失败、11 跳过；合并组合为 715 通过、相同 5 失败、11 跳过。原有测试状态没有变化，增加的 176 个通过执行项均通过。
- 5 个既有失败均在 `tests/probe/probe.test.ts`，其 fetch mock 与 axios 调用路径不一致。
- 类型检查从基线的 21 条既有诊断降为 20 条，没有新增诊断；仍包含 `toSorted` 库版本、SDK 私有 socket 和 `pdf-parse` 声明问题。
- 本轮未完成生产钉钉模板权限、客户端视觉及真实消息收件的端到端验收。

## 安装与升级

```bash
openclaw plugins install @dingtalk-real-ai/dingtalk-connector@0.8.27 --force --accept-capabilities
openclaw gateway restart
openclaw plugins doctor
```

通过 npm 安装包：

```bash
npm install @dingtalk-real-ai/dingtalk-connector@0.8.27
```

## 回退

需要恢复到上一正式版时，安装 `@dingtalk-real-ai/dingtalk-connector@0.8.26` 并重启 Gateway。插件版本回退不会自动撤销已发送的消息或其他外部操作。
