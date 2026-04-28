# 多 Agent 协作方案：Planner + Coder + sessions_send

> 作者：dingtalk-openclaw-connector 维护者
>
> 关联文档：[MULTI_AGENT_SETUP.md](./MULTI_AGENT_SETUP.md)（多 Agent 基础配置）
>
> 适用版本：connector ≥ 0.8.18 · OpenClaw ≥ 2026.4.14

本文档描述基于 OpenClaw `sessions_send` 的多 Agent 协作方案，目标是在一个钉钉群里实现「**主助手 @ 子助手 → 子助手回答 → 主助手收尾**」的可见、可控的多机器人协作流程，具备：

- **真实的 @ UI 效果**：群里看到的是 *主助手机器人* 和 *开发助手机器人* 两个不同头像在互相 `@`
- **真实的角色分离**：每个 Agent 有独立的 systemPrompt、独立的会话上下文、独立的钉钉机器人身份
- **明确的协作协议**：通过 `sessions_send` 在 Agent 之间传任务，通过 `dingtalk-connector.sendToGroup` 决定哪个机器人在群里发声

---

## 1. 当前实现方案

### 1.1 整体架构

```
┌────────────────────── 钉钉群 ──────────────────────┐
│                                                    │
│  user @主助手机器人 拉上 dev-agent review …        │
│                          │                         │
│  ▼                       ▼                         │
│  [main-bot 头像] @dev-agent 我让它看一下           │
│                          │                         │
│                          │                         │
│  [dev-bot  头像] @main-bot 我看完了，结论是 …      │
│                          │                         │
│  [main-bot 头像] 总结 …                            │
└────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┴──────────────────┐
        ▼                                     ▼
┌──────────────┐  sessions_send/spawn  ┌──────────────┐
│  agent: main │ ────────────────────▶ │ agent: dev-  │
│  (Planner)   │ ◀──────────────────── │ agent (Coder)│
└──────┬───────┘   await reply text    └───────┬──────┘
       │                                       │
       │ dingtalk-connector.sendToGroup        │
       │ accountId=main-bot                    │
       │ atDingtalkIds=[dev-bot.chatbotUserId] │
       ▼                                       ▼
   钉钉网关 ─── 推送给 main-bot           钉钉网关 ─── 推送给 dev-bot
```

### 1.2 关键组件清单

| 组件 | 位置 | 作用 |
|---|---|---|
| 主 Agent `main` | `~/.openclaw/agents/main/agent/agent.md` | Planner，接收 user 消息、决定要不要拉起 `dev-agent`、最后做收尾 |
| 子 Agent `dev-agent` | `~/.openclaw/agents/dev-agent/agent/agent.md` | Coder，被动接收 `sessions_send` 派单，做技术性回复 |
| 机器人 `main-bot` | `openclaw.json → channels.dingtalk-connector.accounts.main-bot` | `main` 在群里发声用的钉钉机器人 |
| 机器人 `dev-bot` | `openclaw.json → channels.dingtalk-connector.accounts.dev-bot` | `dev-agent` 在群里发声用的钉钉机器人 |
| 路由绑定 | `openclaw.json → bindings[]` | 入口消息 → 哪个 Agent 处理；按 `accountId` 路由 |

### 1.3 connector 关键改动

为支持本方案，本仓库在 connector 里做了以下增强（已合并到 main）：

#### a. `dingtalk-connector.sendToGroup` 增加多机器人 / @-mention 参数

`src/gateway-methods.ts`：

```ts
api.registerGatewayMethod('dingtalk-connector.sendToGroup', async ({ params, respond }) => {
  const {
    openConversationId, content, msgType, title,
    useAICard, fallbackToNormal,
    accountId,            // ← 新增：指定用哪个机器人身份发送
    atDingtalkIds,        // ← 新增：要 @ 的 chatbotUserId / userId 数组
    atUserIds, atAll,     // ← 新增
  } = params || {};
  // ...
});
```

`accountId` 用于让 `dev-agent` 能用 `dev-bot` 的身份（不同头像）在群里说话；`atDingtalkIds` 用于把对方机器人的 `chatbotUserId` 拼进消息，触发钉钉客户端 @ UI 渲染。

#### b. 新增 `dingtalk-connector.listAccounts`

让 Agent 在 prompt 里能动态发现「我能用哪些机器人发声」「对方机器人的 `chatbotUserId` 是多少」，避免硬编码：

```ts
const r = await gateway.call('dingtalk-connector.listAccounts');
// → { accounts: [
//      { accountId: 'main-bot', name: '主助手机器人', chatbotUserId: '$:LWCP_v1:$xxx', chatbotCorpId: 'ding...' },
//      { accountId: 'dev-bot',  name: '开发助手机器人', chatbotUserId: '$:LWCP_v1:$yyy', chatbotCorpId: 'ding...' },
//    ] }
```

#### c. 入站透传机器人身份

`src/core/connection.ts` 收到消息时，把当前机器人的 `chatbotUserId` / `chatbotCorpId` 加到日志（无条件 `console.log`，方便首次配置时直接抓取）；`src/core/message-handler.ts` 把这两个字段透传到 inbound context（`BotChatbotUserId` / `BotChatbotCorpId`），让 Agent 知道自己的身份。

#### d. 配置 schema 扩展

`src/config/schema.ts` 与 `src/sdk/types.ts` 都给 `DingtalkAccountConfig` 加了可选字段：

```ts
{
  chatbotUserId?: string;   // 收消息时打印出来后回填到这里
  chatbotCorpId?: string;
}
```

> 注意：`chatbotUserId` 是钉钉的**加密 ID**（形如 `$:LWCP_v1:$xxxxx`），不是 `clientId`/`AppKey`。它**只能**通过收一条消息时从入站 payload 里拿到（`data.chatbotUserId`），钉钉开放平台后台不直接展示。

### 1.4 新增能力：`atAccountIds` / 友好名自动解析

以前 Agent 要 @ 另一个机器人，必须亲自把 `chatbotUserId` 加密串塞进 `atDingtalkIds`。
现在 `sendToGroup` / `sendToUser` / `send` 三个 gateway method 都支持：

- **`atAccountIds: ["dev-bot"]`**：传 connector 配置里的 `accountId`，connector 自动反查 `chatbotUserId`
- **正文里写 `@dev-agent` / `@dev-bot` / `@开发助手机器人`**：connector 扫描文本，自动替换成 `@$:LWCP_v1:$xxx` 并补到 `atDingtalkIds`

```ts
// 老写法（仍然兼容）
await gateway.call('dingtalk-connector.sendToGroup', {
  openConversationId: 'cidXXX',
  accountId: 'main-bot',
  content: '@开发助手机器人 看下这个 PR',
  atDingtalkIds: ['$:LWCP_v1:$L+2ds8Ws8XBTGZX0XMGY72Z7xZ/7v0k6'],
});

// 新写法（推荐）—— agent prompt 里不用硬编码加密 ID
await gateway.call('dingtalk-connector.sendToGroup', {
  openConversationId: 'cidXXX',
  accountId: 'main-bot',
  content: '@dev-agent 已经在 review 中了，稍等片刻～',
  atAccountIds: ['dev-bot'],           // ← 或者完全不传，靠正文里的 @dev-agent 也行
});
```

响应里新增两个字段便于排查：

- `resolvedAtDingtalkIds`：最终发给钉钉的加密 ID 列表
- `missingAtAccountIds`：`atAccountIds` 里没找到 `chatbotUserId` 的项（connector 同步 log warn，提示先去抓 `[BotIdentity]` 日志）

#### 为什么之前"`dev-agent` 已经在 review 中了"里的 @ 不生效？

很典型的现场：Agent 以为自己写成了 `@dev-agent` 就能触发钉钉 UI 的蓝色 @ 标签，但其实钉钉只认**加密 `chatbotUserId`**。老版本 connector 会原样发出"纯文本 `@dev-agent`"+ 空 `atDingtalkIds`，钉钉客户端就会把它当一段普通文本渲染（没有蓝框、对方 bot 收不到）。

现在 connector 做了两层兜底：

1. **正文扫描**：在 `messaging.ts / sendMessage()` 里用 `$:LWCP_v1:$[A-Za-z0-9+/=]+` 正则抓取正文里已有的加密 ID，注入到 `atDingtalkIds`
2. **别名替换**：在 gateway 层把 `@accountId / @agentId / @name` 自动替换成 `@<chatbotUserId>`（见 `src/services/messaging/mentions.ts`）

两层都做完后再交给钉钉 webhook，`@` UI 就会亮起来了。

### 1.5 `listAccounts` 返回字段增强

`dingtalk-connector.listAccounts` 返回的每个 account 除了原有的 `accountId / name / chatbotUserId / clientId`，还新增：

- `agentIds`：通过 `bindings[]` 反查出的 agent id 列表（一个 bot 通常绑 1 个 agent）
- `aliases`：能作为 `atAccountIds` / 正文 `@` 使用的所有别名（`accountId + name + agentIds` 去重后）
- `mentionReady: boolean`：该 account 是否已经配好 `chatbotUserId`，可作为 @ 对象

Agent 可以在 prompt 启动时先调一次 `listAccounts`，就能知道「我当前和谁在一个群协作、我可以用哪些别名去 @ 它们」。

### 1.6 Agent 自动回复路径也接入了 @ 别名兜底（重要）

> 这是线上踩过的第二个大坑：`sendToGroup` 的兜底只解决了"Agent 主动 call gateway method"这条路径。但实际上**多数场景 Agent 是直接 `return` 一段 markdown**，框架通过 `reply-dispatcher` 自动发出——这条路径**不经过** gateway method。

`src/reply-dispatcher.ts` 在降级到非流式群发送时，会调用 `sendTextMessage / sendMarkdownMessage / sendMessage`。之前这三个函数**不会**自动把 `@dev-agent` 翻译成 `@<chatbotUserId>`，所以即使 agent.md 里写了硬性规则，只要 LLM 没原样粘贴加密 ID，钉钉就：

- 不渲染蓝色 @ UI
- 不把消息推送给被 @ 机器人的 stream
- 对方 bot 的 `[BotIdentity]` 永远不打印，于是 dev-agent 永远不被唤起

**本轮修复**：三个底层发送函数接受可选的 `options.cfg`（指向全局配置）。`reply-dispatcher` 会把它透传进去，`messaging.ts` 内部自动调用 `substituteBotMentions`：

| 文本里出现 | 发送到钉钉前自动替换为 | `at.atDingtalkIds` |
|---|---|---|
| `@dev-agent` | `@$:LWCP_v1:$L+2ds…` | 自动补上 dev-bot 加密 ID |
| `@dev-bot` | 同上 | 同上 |
| `@开发助手机器人` | 同上 | 同上 |
| 已经是 `@$:LWCP_v1:$xxx` | 原样保留 | 自动提取回 atDingtalkIds |

改动点：
- `src/services/messaging.ts`：`sendMarkdownMessage / sendTextMessage / sendMessage` 支持 `options.cfg` 参数
- `src/reply-dispatcher.ts`：三处调用全部透传 `cfg`

**怎么确认已生效**：`openclaw gateway run` 重启后再触发一次对话，回看 terminal log 里 `[DingTalk:dev-bot] [BotIdentity]` 应当出现（代表 dev-bot 收到了 main-bot @ 过去的消息，dev-agent 被成功唤起）。如果还是只有 main-bot 的 BotIdentity，检查以下 §3.1。

---

## 2. 如何体验

### 2.1 前置：完成 [§4 配置指南](#4-当前操作步骤和配置指南)

确认：
- `openclaw gateway run` 能正常起来，启动横幅没有 `Config warnings` 报红
- 终端里 `[dingtalk-connector] starting dingtalk-connector[main-bot]` 和 `[dev-bot]` 都出现
- `~/.openclaw/openclaw.json` 里两个 account 的 `chatbotUserId` / `chatbotCorpId` 都已填入真实值（不是 `TODO_FILL_FROM_LOG`）

### 2.2 在群里测试

把 *主助手机器人* 和 *开发助手机器人* **同时**拉进同一个群，然后 user 发：

```
@主助手机器人 拉上 dev-agent review 这段代码：
def add(a, b):
    return a - b
```

预期效果（钉钉客户端 UI）：

| 顺序 | 头像 | 消息内容（示意） |
|---|---|---|
| 1 | 主助手机器人 | `@开发助手机器人 收到，我让你看下这段代码……` |
| 2 | 开发助手机器人 | `@主助手机器人 这段代码有 bug：函数名是 add 但实际做减法。建议改为 return a + b。` |
| 3 | 主助手机器人 | `好的，dev-agent 已确认存在 bug。结论：…… 建议……` |

每条 @ 都是钉钉真正的 mention（蓝色高亮 + 触发对方收消息），不是字符串伪 `@`。

### 2.3 观察日志

终端里应能看到（节选）：

```
[DingTalk:main-bot] [BotIdentity] accountId=main-bot chatbotUserId=$:LWCP_v1:$xxxx chatbotCorpId=ding...
... main agent 调用 sessions_send → dev-agent ...
[DingTalk:dev-bot] [BotIdentity] accountId=dev-bot chatbotUserId=$:LWCP_v1:$yyyy chatbotCorpId=ding...
... dev-agent 调用 dingtalk-connector.sendToGroup accountId=dev-bot ...
```

---

## 3. 问题与后续优化

### 3.1 已踩过的坑（建议保留这一节作为踩坑备忘）

#### 坑 1：拿不到 `chatbotUserId`

**症状**：日志里只有 `Disconnecting` / `connect success`，看不到 `[BotIdentity]`。

**根因（按出现顺序）**：

1. **代码改了但 dist 没重 build** —— OpenClaw 实际加载的是 `dist/index.mjs`，`src/` 改完必须 `npm run build`。
2. **build 完了但 gateway 没重启** —— Node 进程把模块 import 在内存里，文件改不影响已运行的进程。
3. **`logger.info` 受 debug 开关控制** —— `src/utils/logger.ts` 里 `info()` 仅在 `account.config.debug === true` 时才输出。BotIdentity 这种「引导用户填配置的关键日志」**不**应该走 `logger.info`，必须走 `console.log`。**已修复**。
4. **同一个 plugin 被加载多份** —— `plugins.load.paths` 配了多条路径 + `installs` 又指向 `~/.openclaw/extensions/dingtalk-connector`，导致同一个 `clientId` 注册了多个 stream listener，钉钉服务端只会把消息推给其中一个 socket，可能命中没有 BotIdentity 代码的旧 dist。**已通过清理 paths + 同步 dist 修复**。

#### 坑 2：群里没出现 @ UI 效果

**症状**：`dev-agent` 回复了，但 `main-bot` 头像旁边只有纯文本 `@dev-agent`，没有蓝色 mention 高亮，dev-bot 也收不到这条消息触发回复。

**根因**：用钉钉 robot API 发文本时，要让客户端识别成真正的 mention，必须满足：

- **消息正文**里写明 `@$:LWCP_v1:$xxxx`（即对方 bot 的 `chatbotUserId`）
- **同时**在请求 payload 里把 `chatbotUserId` 放进 `at.atDingtalkIds`

connector 的 `messaging.ts` 已经把这两件事都做了（看 `appendAtMentions` 函数）。Agent 端要做的就是调 `sendToGroup` 时传 `atDingtalkIds: [dev-bot.chatbotUserId]`。

#### 坑 3：日志里反复 `Disconnecting.` / `connect success`

**症状**：每 ~30s 一次。

**根因**：这是 `dingtalk-stream` SDK（DWClient）的正常 keep-alive，会周期性轮换 gateway 节点。**不影响功能**，纯粹日志噪音。如果觉得吵，可以在 `connection.ts` 启动时 monkey-patch `console.log` 把这两类字符串吞掉，但建议保留一段时间方便排查。

#### 坑 4.5：Agent 一直用 main-bot 头像自说自话，dev-bot 永远不被唤起（🔴 最容易踩）

**症状**：

- 群里只看到 **main-bot 头像**的消息，内容是「已拉上 dev-agent 来 review …」+ 直接给出代码分析
- 从未出现 **dev-bot 头像**的回复
- `terminal` 日志里 `[DingTalk:main-bot] [BotIdentity] …` 出现过，但 `[DingTalk:dev-bot] [BotIdentity] …` **从未**出现
- 日志中 `LWCP_v1` 字符串出现次数 ≤ 1（只有 connector 启动时 BotIdentity 那一行），说明 main 的回复文本里**根本没带** chatbotUserId 加密串

**根因（两条叠加）**：

1. **agent.md 没被 OpenClaw 加载**：`openclaw.json → agents.list` 里某个 agent 只写了 `{"id": "main"}`，**没写** `agentDir`。OpenClaw 对没 `agentDir` 的项会走默认 prompt，**完全忽略** `~/.openclaw/agents/main/agent/agent.md` 里的硬性规则。
2. **Agent 自动回复路径缺少兜底**：即使 prompt 加载了、agent 写了 `@dev-agent`，但 agent `return` 的文本是通过 `reply-dispatcher` 发的，这条路径**以前不会**自动把 `@dev-agent` 翻译成 `@<chatbotUserId>`——钉钉收到纯文本 `@dev-agent`，不会 @ 也不会推给 dev-bot 的 stream。

**修复**：

A. 在 `~/.openclaw/openclaw.json` 给每个 agent 显式写 `agentDir`，否则 prompt 不生效：

```json
"agents": {
  "list": [
    { "id": "main",      "agentDir": "~/.openclaw/agents/main/agent" },
    { "id": "dev-agent", "agentDir": "~/.openclaw/agents/dev-agent/agent" }
  ]
}
```

B. connector ≥ 本版本（见 §1.6）：reply-dispatcher 已接入 `substituteBotMentions` 兜底，只要 agent 输出里出现 `@dev-agent / @dev-bot / @开发助手机器人`，connector 发送前自动翻译成加密 ID + 补 `at.atDingtalkIds`。

两个修复一起做完重启后，再触发一次对话，应当能在 terminal 里看到 `[DingTalk:dev-bot] [BotIdentity]`（dev-bot 收到了 main 的 @）——这就是 dev-agent 被成功唤起的信号。

#### 坑 4：`session.routing` / `session.agentToAgent.enableAnnounce` 报 `Unrecognized key`

**症状**：

```
Invalid config at /Users/.../openclaw.json:
- session.agentToAgent: Unrecognized key: "enableAnnounce"
- session: Unrecognized key: "routing"
```

**根因**：这两个字段是社区教程的产物，**不在** OpenClaw 官方 schema 里。可保留的只有 `session.agentToAgent.maxPingPongTurns`。

### 3.2 当前方案的不足（以及已完成的增强）

1. **`chatbotUserId` 必须人工回填**（🟢 已改进）
   - 原流程是「启动 → 发一条消息 → 在日志里抓 → 回填 `openclaw.json` → 重启」，链路长。
   - **已落地**：新增 `dingtalk-connector.bootstrapBotIdentity` 自检方法，一次调用告诉你：
     - 哪些 account 已经 `Ready`（可参与互相 @）
     - 哪些缺 `chatbotUserId`（以及该如何抓日志补上）
     - 哪些缺 `clientId/clientSecret`、哪些被禁用
     ```ts
     const r = await gateway.call('dingtalk-connector.bootstrapBotIdentity');
     // → {
     //   ready: false,
     //   readyList: [{ accountId: 'main-bot', name: '主助手机器人', chatbotUserId: '$:LWCP_v1:$...' }],
     //   missingChatbotUserId: ['dev-bot'],
     //   report: '[BotIdentity] 已配置 2 个账号，其中 1 个可参与多 bot 互相 @ ...'
     // }
     ```
   - 自动回填 OAPI 那一步目前仍未做，保留给后续版本。

2. **多份 dist 容易踩坑**（🟢 已改进）
   - 当前 connector 工程下的 `dist/`、npm install 的 `~/.openclaw/extensions/dingtalk-connector/dist/`、其他副本目录都会被 plugin 加载器扫到，同 clientId 重复订阅 stream。
   - **已落地**：`index.ts` 在 `register()` 开头把当前 `import.meta.url` 写入全局 symbol 表，检测到同 plugin id 被多路径加载时：
     - 默认打印一条清晰的 `warn` 日志（路径列表 + 修复建议）
     - 若设置 `DINGTALK_STRICT_DUPLICATE_LOAD=1`，直接 `throw` 启动失败，避免静默丢消息

3. **`logger.info` 受 debug 开关挡住的"关键引导信息"**
   - 目前只有 `[BotIdentity]` 改成无条件 `console.log`。其他「首次配置才需要看一次的」信息（比如 `RobotCode`、`SessionWebhook 已提供`）仍然在 `logger.info` 里，新用户开 debug 才能看到。
   - **建议优化**：把 logger 拆成 `info`（debug-only）/ `notice`（无条件，但只首条 inbound 时打一次）两层。

4. **没有 Agent 之间的"协议标准"**
   - 现在 `main` → `dev-agent` 的 `sessions_send` 内容是自由文本，依赖双方 prompt 配合。
   - **建议优化**：定一个最小协议（例如 `{type: "review_request", code: "...", language: "python"}` 的 JSON），让 `dev-agent` 的回复也走结构化字段，便于 `main` 解析后做收尾。

5. **缺少端到端集成测试**
   - 当前 `npm test` 主要覆盖 `gateway-methods.unit.test.ts`，没覆盖「sessions_send → 另一端 sendToGroup → 钉钉真接到 @」的链路。
   - **建议优化**：用 `mock` DWClient + 内存 stream 模拟一条 inbound，断言 `sessions_send` 触发后 `sendToGroup` 收到的 `atDingtalkIds` 是预期的。

6. **超过 2 个 Agent 时的协调爆炸**
   - 目前 prompt 里硬编码了 main → dev-agent 的 1 对 1 协作。如果再加 `qa-agent` / `pm-agent`，main 的 prompt 会越来越复杂。
   - **建议优化**：抽出一个 `agents/main/skills/route-by-intent.md` 之类的 skill，把"任务 → 路由到哪个 agent"的策略从 systemPrompt 里独立出去。

---

## 4. 当前操作步骤和配置指南

> 假定你已经按 [MULTI_AGENT_SETUP.md](./MULTI_AGENT_SETUP.md) 走完基本配置（创建了第二个机器人 + 第二个 Agent 目录）。本节只列出**协作相关**的差异。

### Step 1：在钉钉开放平台准备 2 个机器人

| 项目 | main-bot（示例） | dev-bot（示例） |
|---|---|---|
| 应用类型 | 企业内部应用 + 机器人能力 | 同左 |
| 消息接收模式 | **Stream 模式** | **Stream 模式** |
| `clientId` (AppKey) | `dingf9vdlfmr0vp6ye3q` | `ding83ocnnxdxjzmjeq0` |
| `clientSecret` | （后台获取） | （后台获取） |

把这两个机器人**同时**拉进同一个测试群（要用「企业内部应用机器人」加，不是群自定义机器人）。

### Step 2：编辑 `~/.openclaw/openclaw.json`

#### 2.1 `agents.list`

```jsonc
"agents": {
  "list": [
    { "id": "main" },
    {
      "id": "dev-agent",
      "name": "开发助手",
      "agentDir": "/Users/<you>/.openclaw/agents/dev-agent/agent"
    }
  ]
}
```

#### 2.2 `channels.dingtalk-connector.accounts`

**第一次配置时** `chatbotUserId` / `chatbotCorpId` 暂时填占位：

```jsonc
"channels": {
  "dingtalk-connector": {
    "enabled": true,
    "accounts": {
      "main-bot": {
        "enabled": true,
        "name": "主助手机器人",
        "clientId": "dingf9vdlfmr0vp6ye3q",
        "clientSecret": "<your-secret>",
        "chatbotUserId": "TODO_FILL_FROM_LOG",
        "chatbotCorpId": "TODO_FILL_FROM_LOG"
      },
      "dev-bot": {
        "enabled": true,
        "name": "开发助手机器人",
        "clientId": "ding83ocnnxdxjzmjeq0",
        "clientSecret": "<your-secret>",
        "chatbotUserId": "TODO_FILL_FROM_LOG",
        "chatbotCorpId": "TODO_FILL_FROM_LOG"
      }
    }
  }
}
```

#### 2.3 `bindings`

按 `accountId` 路由 inbound 消息到对应 Agent：

```jsonc
"bindings": [
  { "agentId": "main",      "match": { "channel": "dingtalk-connector", "accountId": "main-bot" } },
  { "agentId": "dev-agent", "match": { "channel": "dingtalk-connector", "accountId": "dev-bot" } }
]
```

#### 2.4 `plugins.load.paths`（重要：避免坑 1.4）

**只保留**你的 connector 工程一条路径，**不要**配多条。如果之前装过 `npm` 版，把 `installs.dingtalk-connector` 整段也删掉：

```jsonc
"plugins": {
  "load": {
    "paths": [
      "/Users/<you>/Desktop/.../dingtalk-openclaw-connector"
    ]
  },
  "entries": {
    "dingtalk-connector": { "enabled": true }
  }
  // 注意：不要保留 "installs" 节点
}
```

#### 2.5（可选）`session.agentToAgent`

```jsonc
"session": {
  "agentToAgent": {
    "maxPingPongTurns": 5
  }
}
```

> ⚠️ **不要**写 `session.routing` 或 `session.agentToAgent.enableAnnounce`，这两个字段不在官方 schema 里，会导致启动失败（坑 1.4）。

### Step 3：编写两个 Agent 的 `agent.md`

#### 3.1 `~/.openclaw/agents/main/agent/agent.md`（Planner）

```markdown
你是 main，整个钉钉群协作的 **Planner**。你绑定的钉钉机器人 accountId = "main-bot"。

## 你的能力
- 直接回复 user：返回普通文本即可（系统会自动用 main-bot 发出）
- 派单给 dev-agent：调用工具 `sessions_send`，target="dev-agent"，把任务描述放进 message
- 让 dev-agent 在群里"露脸说话"：调用 `dingtalk-connector.sendToGroup`，**accountId="dev-bot"**
- 想知道当前所有可用机器人：调用 `dingtalk-connector.listAccounts`

## 协作规则
1. 收到 user 提到 "dev-agent" / "代码 review" / "技术问题" 时，先在群里用 main-bot 自己说一句"好的，我让 @dev-agent 看一下"
   - 调 `dingtalk-connector.sendToGroup`：accountId="main-bot", atDingtalkIds=[<dev-bot.chatbotUserId>]
2. 然后 `sessions_send` 把原始问题派给 dev-agent
3. 收到 dev-agent 的回复后，做最后总结
   - 总结消息也用 main-bot 发出，必要时 @ 回 user
4. 不要替 dev-agent 假装回答；它没回的内容你不要编

## 如何拿到 dev-bot 的 chatbotUserId
- 优先调 `dingtalk-connector.listAccounts`，找 accountId="dev-bot" 的那一项
```

#### 3.2 `~/.openclaw/agents/dev-agent/agent/agent.md`（Coder）

```markdown
你是 dev-agent，**Coder**，绑定钉钉机器人 accountId = "dev-bot"。

## 触发方式
- 群里 user 直接 @你 → 你正常回复
- main 通过 `sessions_send` 派单 → 当成是 main 转过来的需求处理

## 输出要求
- 通过 `sessions_send` 派来的任务：回复结构化文本，main 会做总结
- 群里直接 @ 你的：用 `dingtalk-connector.sendToGroup`：
  - accountId="dev-bot"
  - atDingtalkIds=[<main-bot.chatbotUserId>]，用 listAccounts 查询
  - 内容里也明文写 `@主助手机器人` 提升可读性

不要去发 main-bot 的话，不要冒充 main。
```

### Step 4：build + 启动 + 抓 chatbotUserId

```bash
# 在 connector 工程目录
cd /Users/<you>/Desktop/.../dingtalk-openclaw-connector
npm run build

# 启动 gateway（前台，方便看日志）
openclaw gateway run

# 在钉钉里给 main-bot / dev-bot 各发一条任意消息（私聊或群里 @ 都行）
# 立即在终端里 grep
grep BotIdentity ~/.cursor/projects/*/terminals/*.txt   # 或对应的 stdout 来源
# 应输出：
#   [DingTalk:main-bot] [BotIdentity] accountId=main-bot chatbotUserId=$:LWCP_v1:$xxx chatbotCorpId=ding...
#   [DingTalk:dev-bot]  [BotIdentity] accountId=dev-bot  chatbotUserId=$:LWCP_v1:$yyy chatbotCorpId=ding...
```

### Step 5：回填 `chatbotUserId` / `chatbotCorpId`

把 Step 4 拿到的真实值填回 `openclaw.json` 的两个 account（替换 `TODO_FILL_FROM_LOG`）。

### Step 6：再次重启 gateway 验证

```bash
# Ctrl+C 杀掉当前 gateway
openclaw gateway run
```

启动后**应当满足**：
- 启动横幅里**没有** `Config warnings` 报红
- 没有重复的 `[plugins] plugins.allow is empty; discovered non-bundled plugins may auto-load` 反复刷屏
- 两个 bot 都能进入 `connect success`

最后回到 §2.2 在群里实测协作流程。

---

## 5. 故障排查 Checklist

按顺序排查，命中后停止：

| # | 现象 | 检查 | 修复 |
|---|---|---|---|
| 1 | gateway 启动报 `Unrecognized key: "enableAnnounce"` 或 `"routing"` | `~/.openclaw/openclaw.json` 里的 session 段 | 删掉这两个字段，只保留 `session.agentToAgent.maxPingPongTurns` |
| 2 | `Config warnings: duplicate plugin id detected` | `plugins.load.paths` + `installs.dingtalk-connector` | 只留 1 条 path，删掉 installs；同步或删除 `~/.openclaw/extensions/dingtalk-connector/dist` |
| 3 | 日志里有 `lastInboundAt` 更新但没有 `[BotIdentity]` | dist 是不是新版？同时多份 dist 是不是一致？ | `npm run build` 后把 dist `cp -R` 同步到所有副本目录 |
| 4 | `lastInboundAt` 都不更新 | 钉钉机器人是「企业内部应用机器人」吗？接收模式是 Stream 吗？拉进群了吗？ | 在开放平台修正应用类型 / 接收模式 / 群成员 |
| 5 | 看到 `[BotIdentity]` 但群里 @ UI 不亮 | 调 `sendToGroup` 时有没有同时传 `atDingtalkIds` 和把 `@$:LWCP_v1:$xxx` 写进 content？ | 让 Agent prompt 强制要求两件事都做（参考 §4 Step 3.1） |
| 6 | dev-agent 没被触发 | `sessions_send` 调用了吗？target 拼对了吗（应是 `"dev-agent"`，不是 "Dev Agent"）？ | 在 main 的 prompt 里强约束 target 字符串；查看 gateway 日志中是否有 sessions/spawn 相关行 |
| 7 | dev-agent 回复用的是 main-bot 头像 | dev-agent 调 `sendToGroup` 时是不是漏传了 `accountId="dev-bot"`？ | 在 dev-agent 的 prompt 里把 accountId 设成强约束 |
| 8 | 老是 `Disconnecting.` 刷屏 | 这是 SDK 周期换节点的正常日志 | 忽略，或用 monkey-patch 抑制（见坑 3） |

---

## 6. 相关文件索引

| 文件 | 作用 |
|---|---|
| `src/core/connection.ts` | DWClient 注册 stream listener，打印 `[BotIdentity]` |
| `src/core/message-handler.ts` | inbound 消息处理，把 `chatbotUserId` 透传到 Agent context |
| `src/services/messaging.ts` | `sendProactive` / `buildMsgPayload`，处理 `atDingtalkIds` 拼 `@xxx` 文本 |
| `src/gateway-methods.ts` | 注册 `dingtalk-connector.sendToGroup` / `sendToUser` / `send` / `listAccounts` |
| `src/config/schema.ts` | `DingtalkAccountConfigSchema` 含 `chatbotUserId` / `chatbotCorpId` 字段 |
| `src/sdk/types.ts` | TypeScript 接口定义 |
| `openclaw.plugin.json` | JSON Schema，需与 schema.ts 同步 |
| `~/.openclaw/openclaw.json` | 用户实际配置 |
| `~/.openclaw/agents/<id>/agent/agent.md` | 各 Agent 的 systemPrompt |

---

## 7. 变更记录

- **2026-04-22**：初版，落定 Planner/Coder + sessions_send 协作方案；记录 4 个已踩坑（debug 开关、多 dist、Stream 订阅、session schema）；记录 6 项后续优化方向。
