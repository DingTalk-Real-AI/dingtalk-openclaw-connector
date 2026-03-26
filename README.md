<div align="center">
  <img alt="DingTalk" src="docs/images/dingtalk.svg" width="72" height="72" />
  <h1>钉钉 OpenClaw 官方连接器</h1>
  <p>将钉钉机器人连接到 OpenClaw Gateway，支持 AI Card 流式响应和会话管理</p>
  
  <p>
    <a href="README.en.md">English</a> •
    <a href="CHANGELOG.md">更新日志</a>
  </p>
</div>

---

## 📋 目录

- [前置要求](#前置要求)
- [快速开始](#快速开始)
- [功能特性](#功能特性)
- [配置说明](#配置说明)
- [常见问题](#常见问题)
- [进阶主题](#进阶主题)
- [许可证](#许可证)

---

## 前置要求

开始之前，请确保你已经：

> 本插件作为 OpenClaw Gateway 插件使用，一般无需你单独安装或管理 Node.js 运行时。

### 1. OpenClaw Gateway

- **官方网站**：https://openclaw.ai/
- **安装说明**：按照官方指南安装 OpenClaw
- **验证安装**：
  ```bash
  openclaw gateway status
  ```
  预期输出：`✓ Gateway is running on http://127.0.0.1:18789`

### ⚠️ 版本兼容性要求

**重要**：dingtalk-connector v0.8.4+ 需要 **OpenClaw SDK v2026.3.22 或更高版本**。

| dingtalk-connector 版本 | 最低 OpenClaw SDK 版本 | 说明 |
|------------------------|----------------------|------|
| v0.8.4+ | v2026.3.22+ | 使用新版 SDK API，支持更完善的路由和会话管理 |
| v0.8.3 及以下 | v2026.3.x | 兼容旧版 SDK |

**如何检查版本**：
```bash
# 检查 OpenClaw 版本
openclaw --version

# 检查插件版本
openclaw plugins list
```

**如何升级**：
```bash
# 升级 OpenClaw 到最新版本
npm install -g openclaw@latest

# 或使用 yarn
yarn global add openclaw@latest
```

**版本不兼容时的表现**：
- 插件加载时会显示详细的错误提示
- 提示信息会包含升级命令和降级方案
- 插件会自动停止加载，不影响其他插件

### 2. 钉钉企业账号

- 你需要一个钉钉企业账号来创建企业内部应用
- 官方网站：https://www.dingtalk.com/

---

## 快速开始

> 💡 **目标**：5 分钟内让你的钉钉机器人运行起来

### 操作系统支持

- macOS / Linux：使用默认的 Shell 终端（zsh、bash 等）。
- Windows：
  - 推荐使用 **PowerShell** 或 **Windows Terminal**。
  - OpenClaw 配置文件路径默认为：`C:\Users\<你的用户名>\.openclaw\openclaw.json`。

下文中出现的 `~/.openclaw/openclaw.json`，在 Windows 上等价于以上路径。

### 步骤 1：安装插件

```bash
# 推荐：从 npm 安装
openclaw plugins install @dingtalk-real-ai/dingtalk-connector
```

**验证安装**：
```bash
openclaw plugins list
```
你应该看到 `✓ DingTalk Channel (v0.8.0) - loaded`

---

### 步骤 2：创建钉钉机器人

#### 3.1 创建应用

1. 访问 [钉钉开放平台](https://open-dev.dingtalk.com/)
2. 点击 **"应用开发"**

![创建应用](docs/images/image-1.png)

#### 3.2 添加机器人能力

1. 在应用详情页，点击 一键创建OpenClaw机器人应用

![创建OpenClaw机器人应用](docs/images/image-2.png)

#### 3.3 获取凭证

1. 完成创建并获取 **"凭证与基础信息"**
2. 复制你的 **AppKey**（Client ID）
3. 复制你的 **AppSecret**（Client Secret）

![完成创建](docs/images/image-3.png)

![获取凭证](docs/images/image-4.png)

> ⚠️ **重要**：Client ID和 Client Secret是机器人的唯一凭证。请合理保存。

---

### 步骤 3：配置 OpenClaw

你有三种方式配置连接器：

#### 方式 A：配置向导（推荐新手使用）

> 你可以直接复制粘贴下面的命令，在终端中运行配置向导。

```bash
openclaw channels add
```

选择 **"DingTalk (钉钉)"**，然后按提示输入：
- `clientId`（AppKey）
- `clientSecret`（AppSecret）

#### 方式 B：编辑配置文件

编辑配置文件：

- macOS / Linux：`~/.openclaw/openclaw.json`
- Windows：`C:\Users\<你的用户名>\.openclaw\openclaw.json`

```json
{
  "channels": {
    "dingtalk-connector": {
      "enabled": true,
      "clientId": "dingxxxxxxxxx",
      "clientSecret": "your_app_secret"
    }
  }
}
```

> 💡 **提示**：如果文件已有内容，在 `channels` 节点下添加 `dingtalk-connector` 部分即可。

---

### 步骤 4：重启并测试

```bash
# 重启 OpenClaw Gateway
openclaw gateway restart

# 实时查看日志
openclaw logs --follow
```

**测试你的机器人**：
1. 打开钉钉 App
2. 在联系人列表中找到你的机器人
3. 发送消息：`你好`
4. 你应该在 10 秒内收到回复

---

## 功能特性

### ✅ 核心功能

- **AI Card 流式响应** - 打字机效果，实时流式显示回复
- **会话管理** - 多轮对话，保持上下文
- **会话隔离** - 私聊、群聊、不同群之间会话独立
- **自动会话重置** - 30 分钟无活动后自动开启新会话
- **手动会话重置** - 发送 `/new` 或 `新会话` 清空对话历史
- **图片自动上传** - 本地图片路径自动上传到钉钉
- **主动发送消息** - 程序化地向用户或群发送消息
- **富媒体接收** - 接收并处理 JPEG/PNG 图片，传递给视觉模型
- **文件附件提取** - 解析 .docx、.pdf、文本文件和二进制文件
- **音频消息支持** - 发送多种格式的音频消息（mp3、wav、amr、ogg）
- **钉钉文档 API** - 创建、追加、搜索和列举钉钉文档
- **多 Agent 路由** - 将多个机器人连接到不同的 Agent，实现专业化服务
- **Markdown 表格转换** - 自动将 Markdown 表格转换为钉钉兼容格式
- **异步模式** - 立即确认消息，后台处理（可选）

---

## 配置说明

### 基础配置

| 选项 | 环境变量 | 说明 |
|------|---------|------|
| `clientId` | — | 钉钉 AppKey |
| `clientSecret` | — | 钉钉 AppSecret |

### 会话管理

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `separateSessionByConversation` | `true` | 私聊/群聊分别维护会话 |
| `groupSessionScope` | `group` | 群聊会话范围：`group`（共享）或 `group_sender`（每人独立） |
| `sharedMemoryAcrossConversations` | `false` | 是否在不同会话间共享记忆 |

### 会话路由策略（`pmpolicy` / `groupPolicy`）

当前版本已支持会话路由/消息策略相关配置（包含 `pmpolicy`、`groupPolicy`），**无需删除**。如你在历史配置中已经设置了这些字段，可以继续保留并按需调整。

> 说明：不同版本/上游可能对字段命名有差异；本连接器侧同时支持并会按策略生效（如 `dmPolicy`/`groupPolicy` 的默认值为 `open`）。

### 异步模式

| 选项 | 默认值 | 说明 |
|------|--------|------|
| `asyncMode` | `false` | 启用异步模式处理长时间任务 |
| `ackText` | `🫡 任务已接收，处理中...` | 确认消息文本 |


---

## 常见问题

### 机器人不回复

**症状**：机器人不回复消息

**解决方案**：
1. 检查插件状态：`openclaw plugins list`
2. 检查网关状态：`openclaw gateway status`
3. 查看日志：`openclaw logs --follow`
4. 确认应用已在钉钉开放平台发布

---

### HTTP 401 错误

**症状**：错误信息显示 "401 Unauthorized"

**原因**：Gateway 认证失败

**解决方案**：

升级到最新版本

---

### Stream 连接 400 错误

**症状**：日志显示 "Request failed with status code 400"

**常见原因**：

| 原因 | 解决方案 |
|------|----------|
| 应用未发布 | 前往钉钉开放平台 → 版本管理 → 发布 |
| 凭证错误 | 检查 `clientId`/`clientSecret` 是否有拼写错误或多余空格 |
| 非 Stream 模式 | 确认机器人配置为 Stream 模式（不是 Webhook） |
| IP 白名单限制 | 检查应用是否设置了 IP 白名单 |

**验证步骤**：

1. **检查应用状态**：
   - 登录 [钉钉开放平台](https://open-dev.dingtalk.com/)
   - 确认应用已发布
   - 确认机器人已启用且为 Stream 模式

2. **重新发布应用**：
   - 修改任何配置后，必须点击 **保存** → **发布**

---

## 进阶主题

### 多 Agent 配置

配置多个机器人连接到不同的 Agent：

```json5
{
  "agents": {
    "list": [
      {
        "id": "ding-bot1",
        "name": "钉钉客服机器人",
        "model": "your-model-config",
        "workspace": "~/.openclaw/workspace-bot1",
        "identity": {
          "name": "客服小助手",
          "theme": "专业客服",
          "emoji": "🤝"
        }
        // 其他 agent 配置...
      },
      {
        "id": "ding-bot2",
        "name": "钉钉技术支持机器人",
        "model": "your-model-config",
        "workspace": "~/.openclaw/workspace-bot2",
        "identity": {
          "name": "技术专家",
          "theme": "技术支持",
          "emoji": "🔧"
        }
        // 其他 agent 配置...
      }
    ]
  },
  "channels": {
    "dingtalk-connector": {
      "enabled": true,
      "accounts": {
        "bot1": {
          "enabled": true,
          "clientId": "ding_bot1_app_key",
          "clientSecret": "bot1_secret"
        },
        "bot2": {
          "enabled": true,
          "clientId": "ding_bot2_app_key",
          "clientSecret": "bot2_secret"
        }
      }
    }
  },
  "bindings": [
    {
      "agentId": "ding-bot1",
      "match": {
        "channel": "dingtalk-connector",
        "accountId": "bot1"
      }
    },
    {
      "agentId": "ding-bot2",
      "match": {
        "channel": "dingtalk-connector",
        "accountId": "bot2"
      }
    }
  ]
}
```

更多详情请参考 [OpenClaw 多 Agent 配置指南](https://gist.github.com/smallnest/c5c13482740fd179e40070e620f66a52)。

---

### 会话命令

用户可以发送以下命令清理对话历史，重新开始会话：

- `/new`、`/reset`、`/clear`
- `新会话`、`重新开始`、`清空对话`

---

### 钉钉文档（Docs）与 MCP（`docs.*`）

钉钉文档能力（`docs.*`，包含 `docs.create` / `docs.append` / `docs.search` / `docs.list` / `docs.read`）依赖 MCP（Model Context Protocol）提供底层 tool。你需要先在 OpenClaw 的 Gateway/Agent 侧启用对应的 MCP Server/Tool，然后上述 `docs.*` 才能正常工作。

- **获取 MCP Server/Tool**：可通过 [钉钉 MCP 市场](https://mcp.dingtalk.com/) 安装启用（或你们团队维护的 MCP 市场）；也可以选择同类的“DingTalk Docs Read / DingTalk Docs Reader”能力并接入到 OpenClaw。
- **配置位置**：通常在 **Gateway 或 Agent 的工具配置**中完成（而不是在连接器里）。
- **生效方式**：配置完成后重启 Gateway，并确认该 tool 已对目标 Agent 暴露。

参考（OpenClaw 官方配置文档）：
- `https://docs.openclaw.ai/configuration`
- `https://docs.openclaw.ai/gateway/configuration-reference`

从你的 Agent 中创建和管理钉钉文档：

```javascript
// 创建文档
dingtalk-connector.docs.create({
  spaceId: "your-space-id",
  title: "测试文档",
  content: "# 测试内容"
})

// 追加内容
dingtalk-connector.docs.append({
  docId: "your-doc-id",
  markdownContent: "\n## 追加的内容"
})

// 搜索文档
dingtalk-connector.docs.search({
  keyword: "搜索关键词"
})

// 列举文档
dingtalk-connector.docs.list({
  spaceId: "your-space-id"
})
```

---

## 项目结构

```
dingtalk-openclaw-connector/
├── src/
│   ├── core/           # Core connector logic
│   ├── services/       # DingTalk API services
│   ├── utils/          # Utility functions
│   └── types/          # TypeScript type definitions
├── docs/
│   └── images/         # Documentation images
├── openclaw.plugin.json # Plugin manifest
├── package.json        # npm dependencies
└── LICENSE
```

---

## 依赖

| 包 | 用途 |
|----|------|
| `dingtalk-stream` | 钉钉 Stream 协议客户端 |
| `axios` | HTTP 客户端 |
| `mammoth` | Word 文档（.docx）解析 |
| `pdf-parse` | PDF 文档解析 |

---

## 许可证

[MIT](LICENSE)

---

## 支持

- **问题反馈**：[GitHub Issues](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)
- **更新日志**：[CHANGELOG.md](CHANGELOG.md)
