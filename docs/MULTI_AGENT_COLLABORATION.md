# 钉钉多 Agent 协作指南 (Multi-Agent Collaboration)

本文档旨在介绍如何在 DingTalk OpenClaw Connector 环境下实现多 Agent 的支持与深度协作。

---

## 一、多 Agent 能力支持 (Support)

多 Agent 支持是指将同一个钉钉连接器实例（Connector）连接到多个专业的 AI Agent，根据会话来源（如特定的用户或特定的群聊）将消息路由到对应的 Agent 处理。

### 1.1 核心路由逻辑
Connector 通过读取 `openclaw.json` 中的 `bindings` 配置来决定消息去向。
- **配置位置**: `openclaw.json` -> `bindings`
- **匹配维度**: 账号 ID (`accountId`)、会话类型 (`peer.kind`)、具体 ID (`peer.id`)。
- **代码实现参考**: [message-handler.ts](file:///Users/xinzhizhu/dingtalk-openclaw-connector/src/core/message-handler.ts) 中的 `Agent 路由解析`。

### 1.2 配置示例
以下示例展示了如何将“客服账号”路由到 `support-agent`，将“技术群”路由到 `dev-agent`：

```json
{
  "bindings": [
    {
      "agentId": "dev-agent",
      "match": {
        "channel": "dingtalk-connector",
        "peer": { "kind": "group", "id": "cid_tech_group_id_xxx" }
      }
    },
    {
      "agentId": "support-agent",
      "match": {
        "channel": "dingtalk-connector",
        "accountId": "customer_service_bot"
      }
    }
  ],
  "defaultAgent": "main"
}
```

> [!TIP]
> 详见 [AGENT_ROUTING.md](file:///Users/xinzhizhu/dingtalk-openclaw-connector/docs/AGENT_ROUTING.md) 获取完整的路由匹配与 Session 隔离规范。

---

## 二、协作模式一：基于钉钉文档的状态共享 (State Sharing)

多 Agent 协作最常见的场景是“信息接力”。例如，Agent A 负责分析需求并写入文档，Agent B 随后读取该文档并生成代码。

### 2.1 协作原理
利用 `docs.*` 系列工具，Agent 可以打破会话上下文的限制，通过外部媒介（钉钉文档）进行异步协作。
- **能力提供者**: [docs.ts](file:///Users/xinzhizhu/dingtalk-openclaw-connector/src/docs.ts)
- **核心工具**:
    - `docs.create`: 创建协作起点。
    - `docs.append`: 追加处理进度或中间产物。
    - `docs.read`: 获取协作文档的最新内容。

### 2.2 协作流程示例
1. **Agent A (项目经理)**: 收到群聊指令，调用 `docs.create` 创建《项目需求.md》。
2. **Agent B (架构师)**: 监听或被提及后，调用 `docs.read` 读取该文档，并使用 `docs.append` 补充架构方案。
3. **用户**: 在钉钉中直接看到文档链接并参与评论。

---

## 三、协作模式二：基于 Gateway Methods 的跨 Agent 通信

Connector 注册了一系列 RPC 方法（Gateway Methods），允许一个 Agent 间接地触达另一个 Agent 的用户或环境。

### 3.1 关键 RPC 方法
- **`dingtalk-connector.sendToGroup`**: 允许 Agent 跨越自身绑定的群聊，向其他群发送通知。
- **`dingtalk-connector.docs.create/append`**: 允许 Agent 在没有直接文档访问权限的情况下，通过 Connector 代理操作。

### 3.2 协作场景：自动化报警接力
1. **运维 Agent**: 检测到系统异常，调用 `gateway.call('dingtalk-connector.sendToGroup', { ... })` 向“紧急处理群”发送报警。
2. **值班 Agent**: 在该群接收到消息（由于 bindings 配置），开始介入处理。

---

## 四、实战：构建多 Agent 协作工作流

以下是一个完整的配置片段，展示了多账号与多 Agent 的配合：

```json5
{
  "agents": {
    "list": [
      { "id": "manager", "name": "项目主管" },
      { "id": "executor", "name": "执行专家" }
    ]
  },
  "channels": {
    "dingtalk-connector": {
      "accounts": {
        "bot_a": { "clientId": "...", "clientSecret": "..." },
        "bot_b": { "clientId": "...", "clientSecret": "..." }
      }
    }
  },
  "bindings": [
    // bot_a 接收所有指令，由 manager 处理
    { "agentId": "manager", "match": { "accountId": "bot_a" } },
    // 所有的执行类任务路由到 executor
    { "agentId": "executor", "match": { "peer": { "kind": "group", "id": "executor_group_id" } } }
  ]
}
```

### 协作建议
- **使用统一的 Workspace**: 确保协作的 Agent 能够访问到相同的本地媒体文件路径（通过 `resolveAgentWorkspaceDir` 实现）。
- **统一 SessionKey**: 如需强耦合，可配置 `sharedMemoryAcrossConversations: true` 共享长期记忆。

---

> [!IMPORTANT]
> 本文档为初版，由 DingTalk Real Team持续维护。如有问题请提交 Issue。
