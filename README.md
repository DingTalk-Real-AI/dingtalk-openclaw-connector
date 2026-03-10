# DingTalk OpenClaw Connector

以下提供两种方案连接到 [OpenClaw](https://openclaw.ai) Gateway，分别是钉钉机器人和钉钉 DEAP Agent。

> 📝 **版本信息**：当前版本 v0.7.4 | [查看变更日志](CHANGELOG.md) | [发布说明](docs/RELEASE_NOTES_V0.7.4.md) | [发布指南](RELEASE.md)

## 快速导航

| 方案 | 名称 | 详情 |
|------|------|------|
| 方案一 | 钉钉机器人集成 | [查看详情](#方案一钉钉机器人集成) |
| 方案二 | 钉钉 DEAP Agent 集成 | [查看详情](#方案二钉钉-deap-agent-集成) |

# 方案一：钉钉机器人集成
将钉钉机器人连接到 [OpenClaw](https://openclaw.ai) Gateway，支持 AI Card 流式响应和会话管理。

## 特性

- ✅ **AI Card 流式响应** - 打字机效果，实时显示 AI 回复
- ✅ **会话持久化** - 同一用户的多轮对话共享上下文
- ✅ **会话与记忆隔离** - 按单聊/群聊/群区分 session，不同场景下的对话上下文互不干扰，可配置跨会话记忆共享
- ✅ **超时自动新会话** - 默认 30 分钟无活动自动开启新对话
- ✅ **手动新会话** - 发送 `/new` 或 `新会话` 清空对话历史
- ✅ **图片自动上传** - 本地图片路径自动上传到钉钉
- ✅ **主动发送消息** - 支持主动给钉钉个人或群发送消息
- ✅ **富媒体接收** - 支持接收 JPEG/PNG 图片消息，自动下载并传递给视觉模型
- ✅ **文件附件提取** - 支持解析 .docx、.pdf、纯文本文件（.txt、.md、.json 等）和二进制文件（.xlsx、.pptx、.zip 等）
- ✅ **音频消息支持** - 支持发送音频消息，支持多种格式（mp3、wav、amr、ogg），自动提取音频时长，支持通过标记或文件附件方式发送
- ✅ **钉钉文档 API** - 支持创建、追加、搜索、列举钉钉文档
- ✅ **多 Agent 路由** - 支持一个连接器实例连接多个 Agent，多个钉钉机器人可分别绑定到不同 Agent，实现角色分工和专业化服务
- ✅ **Markdown 表格转换** - 自动将 Markdown 表格转换为钉钉支持的文本格式，提升消息可读性
- ✅ **异步模式** - 立即回执用户消息，后台处理任务，然后主动推送最终结果作为独立消息（可选）


## 架构

```mermaid
graph LR
    subgraph "钉钉"
        A["用户发消息"] --> B["Stream WebSocket"]
        E["AI 流式卡片"] --> F["用户看到回复"]
    end

    subgraph "Connector"
        B --> C["消息处理器"]
        C -->|"HTTP SSE"| D["Gateway /v1/chat/completions"]
        D -->|"流式 chunk"| C
        C -->|"streaming API"| E
    end
```

## 效果

<img width="360" height="780" alt="image" src="https://github.com/user-attachments/assets/f2a3db5d-67fa-4078-b19c-a2acdff9f2bf" />
<img width="360" height="780" alt="image" src="https://github.com/user-attachments/assets/c3e51c05-c44c-4bc4-8877-911ec471b645" />

## 安装

### 1. 安装插件

```bash
# 通过 npm 安装（推荐）
openclaw plugins install @dingtalk-real-ai/dingtalk-connector

# 或通过 Git 安装
openclaw plugins install https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector.git

# 升级插件
openclaw plugins update dingtalk-connector

# 或本地开发模式
git clone https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector.git
cd dingtalk-openclaw-connector
npm install
openclaw plugins install -l .
```

> **⚠️ 旧版本升级提示：** 如果你之前安装过旧版本的 Clawdbot/Moltbot 或 0.4.0 以下版本的 connector 插件，可能会出现兼容性问题，请参考 [Q: 升级后出现插件加载异常或配置不生效](#q-升级后出现插件加载异常或配置不生效)。

### 2. 配置

在 `~/.openclaw/openclaw.json` 中添加：

```json5
{
  "channels": {
    "dingtalk-connector": {
      "enabled": true,
      "clientId": "dingxxxxxxxxx",       // 钉钉 AppKey
      "clientSecret": "your_secret_here", // 钉钉 AppSecret
      "gatewayToken": "",                 // 可选：Gateway 认证 token, openclaw.json配置中 gateway.auth.token 的值 
      "gatewayPassword": "",              // 可选：Gateway 认证 password（与 token 二选一）
      "sessionTimeout": 1800000,          // 可选：会话超时(ms)，默认 30 分钟
      "separateSessionByConversation": true,  // 可选：是否按单聊/群聊/群区分 session（默认：true）
      "sharedMemoryAcrossConversations": false, // 可选：是否在不同会话间共享记忆；false 时群聊与私聊、不同群记忆隔离（默认：false）
      "asyncMode": false,                 // 可选：异步模式，立即回执用户消息，后台处理并推送结果（默认：false）
      "ackText": "🫡 任务已接收"      // 可选：异步模式下的回执消息文本（默认：'🫡 任务已接收，处理中...'）
    }
  },
  "gateway": { // gateway通常是已有的节点，配置时注意把http部分追加到已有节点下
    "http": {
      "endpoints": {
        "chatCompletions": {
          "enabled": true
        }
      }
    }
  }
}
```

或者在 OpenClaw Dashboard 页面配置：

<img width="1916" height="1996" alt="image" src="https://github.com/user-attachments/assets/00b585ca-c1df-456c-9c65-7345a718b94b" />

### 3. 重启 Gateway

```bash
openclaw gateway restart
```

验证：

```bash
openclaw plugins list  # 确认 dingtalk-connector 已加载
```

## 创建钉钉机器人

1. 打开 [钉钉开放平台](https://open.dingtalk.com/)
2. 进入 **应用开发** → **企业内部开发** → 创建应用
3. 添加 **机器人** 能力，消息接收模式选择 **Stream 模式**
4. 开通权限：
   - `Card.Streaming.Write` - AI Card 流式响应
   - `Card.Instance.Write` - AI Card 实例写入
   - `qyapi_robot_sendmsg` - 主动发送消息
   - 如需使用文档 API 功能，还需开通文档相关权限
5. **发布应用**，记录 **AppKey** 和 **AppSecret**

## 配置参考

| 配置项 | 环境变量 | 说明 |
|--------|----------|------|
| `clientId` | `DINGTALK_CLIENT_ID` | 钉钉 AppKey |
| `clientSecret` | `DINGTALK_CLIENT_SECRET` | 钉钉 AppSecret |
| `gatewayToken` | `OPENCLAW_GATEWAY_TOKEN` | Gateway 认证 token（可选） |
| `gatewayPassword` | — | Gateway 认证 password（可选，与 token 二选一） |
| `sessionTimeout` | — | 会话超时时间，单位毫秒（默认 1800000 = 30分钟） |
| `separateSessionByConversation` | — | 是否按单聊/群聊/群区分 session（默认：true） |
| `sharedMemoryAcrossConversations` | — | 是否在不同会话间共享记忆；false 时群聊与私聊、不同群记忆隔离（默认：false） |
| `asyncMode` | — | 异步模式，立即回执用户消息，后台处理并推送结果（默认：false） |
| `ackText` | — | 异步模式下的回执消息文本（默认：'🫡 任务已接收，处理中...'） |

## 会话与记忆隔离

连接器支持按单聊、群聊、不同群分别维护独立会话和记忆，确保同一用户在不同场景下的对话上下文互不干扰。

### 会话隔离（separateSessionByConversation）

- **默认开启**（`true`）：单聊、群聊、不同群各自拥有独立的 session
- **关闭**（`false`）：按用户维度维护 session，不区分单聊/群聊（兼容旧行为）

**Session Key 格式**：
- **单聊**：`dingtalk-connector:accountId:senderId`
- **群聊**：`dingtalk-connector:accountId:group:conversationId:senderId`

Gateway 通过检查 `:group:` 或 `:channel:` 识别群聊场景，便于 Gateway 侧进行更精细的会话管理。

### 记忆隔离（sharedMemoryAcrossConversations）

- **默认关闭**（`false`）：不同群聊、群聊与私聊之间的记忆隔离，AI 不会混淆不同场景下的对话历史
- **开启**（`true`）：单 Agent 场景下，同一用户在不同会话间共享记忆

**Memory User 标识**：
- **`sharedMemoryAcrossConversations: false`**：`memoryUser = sessionKey`，每个 session 独立记忆
- **`sharedMemoryAcrossConversations: true`**：`memoryUser = accountId`，所有会话共享记忆

连接器通过 `X-OpenClaw-Memory-User` HTTP 请求头将 `memoryUser` 传递给 Gateway，支持 Gateway 侧更精细的记忆管理。

### 适用场景

- ✅ 同一机器人在多个群中服务，希望每个群的对话互不干扰
- ✅ 用户既在私聊也在群聊中使用机器人，希望私聊与群聊上下文分离
- ✅ 需要跨会话共享记忆时，可设置 `sharedMemoryAcrossConversations: true`

### 注意事项

⚠️ **记忆存储说明**：如果用户的描述中存在"记住""保存"等字样，模型可能会绕过 Gateway，直接存到本地文件系统，此时配置不生效（此行为需要在模型层面设置，而非插件层面）。

## 异步模式

异步模式允许连接器立即回执用户消息，然后在后台处理任务，最后主动推送最终结果作为独立消息。这种模式特别适合处理耗时较长的任务，可以给用户更好的交互体验。

### 启用异步模式

在配置中设置 `asyncMode: true`：

```json5
{
  "channels": {
    "dingtalk-connector": {
      "enabled": true,
      "clientId": "dingxxxxxxxxx",
      "clientSecret": "your_secret_here",
      "asyncMode": true,              // 启用异步模式
      "ackText": "🫡 任务已接收"  // 可选：自定义回执消息
    }
  }
}
```

### 工作流程

1. **立即回执** - 用户发送消息后，连接器立即发送回执消息（默认：`🫡 任务已接收，处理中...`）
2. **后台处理** - 连接器在后台调用 Gateway 处理任务，支持文件附件和图片
3. **推送结果** - 处理完成后，连接器主动推送最终结果作为独立消息

### 适用场景

- ✅ 处理耗时较长的任务（如文档分析、代码生成等）
- ✅ 需要给用户即时反馈的场景
- ✅ 希望将处理过程和结果分离的场景

### 注意事项

- 异步模式下不支持 AI Card 流式响应（因为结果通过主动推送发送）
- 异步模式支持文件附件和图片处理
- 错误信息也会通过主动推送发送给用户

## 多 Agent 配置

钉钉 Connector 支持多 Agent 模式，可以配置多个钉钉机器人连接到不同的 Agent，实现角色分工和专业化服务。

### 核心配置

在 `~/.openclaw/openclaw.json` 中配置多个钉钉账号和 Agent 绑定：

```json5
{
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

### 官方文档

详细的配置指南和架构说明，请参考 OpenClaw 官方文档：

- [OpenClaw 多 Agent 架构配置指南](https://gist.github.com/smallnest/c5c13482740fd179e40070e620f66a52)


## 会话命令

用户可以发送以下命令开启新会话（清空对话历史）：

- `/new`、`/reset`、`/clear`
- `新会话`、`重新开始`、`清空对话`

## 富媒体接收

### 图片消息支持

连接器支持接收和处理钉钉中的图片消息：

- **JPEG 图片** - 直接发送的 JPEG 图片会自动下载到 `~/.openclaw/workspace/media/inbound/` 目录
- **PNG 图片** - 富文本消息中包含的 PNG 图片会自动提取 URL 和 downloadCode 并下载
- **视觉模型集成** - 下载的图片会自动传递给视觉模型，AI 可以识别和分析图片内容

### 媒体文件存储

所有接收的媒体文件会保存在：

```bash
~/.openclaw/workspace/media/inbound/
```

文件命名格式：`openclaw-media-{timestamp}.{ext}`

查看媒体目录：

```bash
ls -la ~/.openclaw/workspace/media/inbound/
```

## 文件附件提取

连接器支持自动提取和处理钉钉消息中的文件附件：

### 支持的文件类型

| 文件类型 | 处理方式 | 说明 |
|---------|---------|------|
| `.docx` | 通过 `mammoth` 解析 | 提取 Word 文档中的文本内容，注入到 AI 上下文 |
| `.pdf` | 通过 `pdf-parse` 解析 | 提取 PDF 文档中的文本内容，注入到 AI 上下文 |
| `.txt`、`.md`、`.json` 等 | 直接读取 | 纯文本文件内容直接读取并注入到消息中 |
| `.xlsx`、`.pptx`、`.zip` 等 | 保存到磁盘 | 二进制文件保存到磁盘，文件路径和名称会在消息中报告 |

### 使用方式

直接在钉钉中发送文件附件，连接器会自动：
1. 下载文件到本地
2. 根据文件类型进行解析或保存
3. 将文本内容注入到 AI 对话上下文中

## 钉钉文档 API

连接器提供了丰富的钉钉文档操作能力，可在 OpenClaw Agent 中调用：

### 创建文档

```javascript
dingtalk-connector.docs.create({
  spaceId: "your-space-id",
  title: "测试文档",
  content: "# 测试内容"
})
```

### 追加内容

```javascript
dingtalk-connector.docs.append({
  docId: "your-doc-id",
  markdownContent: "\n## 追加的内容"
})
```

### 搜索文档

```javascript
dingtalk-connector.docs.search({
  keyword: "搜索关键词"
})
```

### 列举文档

```javascript
dingtalk-connector.docs.list({
  spaceId: "your-space-id"
})
```

## 多 Agent 路由支持

连接器支持同时连接多个 Agent，实现多 Agent 会话隔离：

- **独立会话空间** - 每个 Agent 拥有独立的会话上下文，互不干扰
- **灵活路由** - 可根据不同场景将请求路由到不同的 Agent
- **向后兼容** - 单 Agent 场景下功能完全兼容，无需额外配置

## 项目结构

```
dingtalk-openclaw-connector/
├── plugin.ts              # 插件入口
├── openclaw.plugin.json   # 插件清单
├── package.json           # npm 依赖
└── LICENSE
```

## 常见问题

### Q: 出现 405 错误

<img width="698" height="193" alt="image" src="https://github.com/user-attachments/assets/f2abd9c0-6c72-45b3-aee1-39fb477664bd" />

需要在 `~/.openclaw/openclaw.json` 中启用 chatCompletions 端点：

```json5
{
  "gateway": { // gateway通常是已有的节点，配置时注意把http部分追加到已有节点下
    "http": {
      "endpoints": {
        "chatCompletions": {
          "enabled": true
        }
      }
    }
  }
}
```

### Q: 出现 401 错误

<img width="895" height="257" alt="image" src="https://github.com/user-attachments/assets/5d6227f0-b4b1-41c4-ad88-82a7ec0ade1e" />

检查 `~/.openclaw/openclaw.json` 中的gateway.auth鉴权的 token/password 是否正确：

<img width="1322" height="604" alt="image" src="https://github.com/user-attachments/assets/b9f97446-5035-4325-a0dd-8f8e32f7b86a" />

### Q: 钉钉机器人无响应

1. 确认 Gateway 正在运行：`curl http://127.0.0.1:18789/health`
2. 确认机器人配置为 **Stream 模式**（非 Webhook）
3. 确认 AppKey/AppSecret 正确

### Q: AI Card 不显示，只有纯文本

需要开通权限 `Card.Streaming.Write` 和 `Card.Instance.Write`，并重新发布应用。

### Q: 升级后出现插件加载异常或配置不生效

由于官方两次更名（Clawdbot → Moltbot → OpenClaw），旧版本（0.4.0 以下）的 connector 插件可能与新版本不兼容。建议按以下步骤处理：

1. 先检查 `~/.openclaw/openclaw.json`（或旧版的 `~/.clawdbot/clawdbot.json`、`~/.moltbot/moltbot.json`），如果其中存在 dingtalk 相关的 JSON 节点（如 `channels.dingtalk`、`plugins.entries.dingtalk` 等），请将这些节点全部删除。

2. 然后清除旧插件并重新安装：

```bash
rm -rf ~/.clawdbot/extensions/dingtalk-connector
rm -rf ~/.moltbot/extensions/dingtalk-connector
rm -rf ~/.openclaw/extensions/dingtalk-connector
openclaw plugins install @dingtalk-real-ai/dingtalk-connector
```

### Q: 图片不显示

1. 确认 `enableMediaUpload: true`（默认开启）
2. 检查日志 `[DingTalk][Media]` 相关输出
3. 确认钉钉应用有图片上传权限

### Q: 图片消息无法识别

1. 检查图片是否成功下载到 `~/.openclaw/workspace/media/inbound/` 目录
2. 确认 Gateway 配置的模型支持视觉能力（vision model）
3. 查看日志中是否有图片下载或处理的错误信息

### Q: 文件附件无法解析

1. **Word 文档（.docx）**：确认已安装 `mammoth` 依赖包
2. **PDF 文档**：确认已安装 `pdf-parse` 依赖包
3. 检查文件是否成功下载，查看日志中的文件处理信息
4. 对于不支持的二进制文件，会保存到磁盘并在消息中报告文件路径

### Q: 钉钉文档 API 调用失败

1. 确认钉钉应用已开通文档相关权限
2. 检查 `spaceId`、`docId` 等参数是否正确
3. 确认 API 调用时的认证信息（AppKey/AppSecret）有效
4. 注意：读取文档功能需要 MCP 提供相应的 tool，当前版本暂不支持

### Q: 多 Agent 路由如何配置

多 Agent 路由功能会自动处理，无需额外配置。连接器会根据配置自动管理多个 Agent 的会话隔离。如需自定义路由逻辑，请参考插件源码中的路由实现。

## 依赖

| 包 | 用途 |
|----|------|
| `dingtalk-stream` | 钉钉 Stream 协议客户端 |
| `axios` | HTTP 客户端 |
| `mammoth` | Word 文档（.docx）解析 |
| `pdf-parse` | PDF 文档解析 |

# 方案二：钉钉 DEAP Agent 集成

通过将钉钉 [DEAP](https://deap.dingtalk.com) Agent 与 [OpenClaw](https://openclaw.ai) Gateway 连接，实现自然语言驱动的本地设备操作能力。

## 核心功能

- ✅ **自然语言交互** - 用户在钉钉对话框中输入自然语言指令（如"帮我查找桌面上的 PDF 文件"），Agent 将自动解析并执行相应操作
- ✅ **内网穿透机制** - 专为本地设备无公网 IP 场景设计，通过 Connector 客户端建立稳定的内外网通信隧道
- ✅ **跨平台兼容** - 提供 Windows、macOS 和 Linux 系统的原生二进制执行文件，确保各平台下的顺畅运行

## 系统架构

该方案采用分层架构模式，包含三个核心组件：

1. **OpenClaw Gateway** - 部署于本地设备，提供标准化 HTTP 接口，负责接收并处理来自云端的操作指令，调动 OpenClaw 引擎执行具体任务
2. **DingTalk OpenClaw Connector** - 运行于本地环境，构建本地与云端的通信隧道，解决内网设备无公网 IP 的问题
3. **DingTalk DEAP MCP** - 作为 DEAP Agent 的扩展能力模块，负责将用户自然语言请求经由云端隧道转发至 OpenClaw Gateway

```mermaid
graph LR
    subgraph "钉钉 App"
        A["用户与 Agent 对话"] --> B["DEAP Agent"]
    end
    
    subgraph "本地环境"
        D["DingTalk OpenClaw Connector"] --> C["OpenClaw Gateway"]
        C --> E["PC 操作执行"]
    end
    
    B -.-> D
```

## 实施指南

### 第一步：部署本地环境

确认本地设备已成功安装并启动 OpenClaw Gateway，默认监听地址为 `127.0.0.1:18789`：

```bash
openclaw gateway start
```

#### 配置 Gateway 参数

1. 访问 [配置页面](http://127.0.0.1:18789/config)
2. 在 **Auth 标签页** 中设置 Gateway Token 并妥善保存：

   <img width="3444" height="1748" alt="Gateway Auth 配置界面" src="https://github.com/user-attachments/assets/f9972458-c857-4416-9bd1-6439d71a3777" />

3. 切换至 **Http 标签页**，启用 `OpenAI Chat Completions Endpoint` 功能：

   <img width="3442" height="1734" alt="Gateway Http 配置界面" src="https://github.com/user-attachments/assets/d0365187-c02d-418b-9ca9-cfbdfd62e6a9" />

4. 点击右上角 `Save` 按钮完成配置保存

### 第二步：获取必要参数

#### 获取 corpId

登录 [钉钉开发者平台](https://open-dev.dingtalk.com) 查看企业 CorpId：

<img width="864" height="450" alt="钉钉开发者平台获取 corpId" src="https://github.com/user-attachments/assets/18ec9830-2d43-489a-a73f-530972685225" />

#### 获取 apiKey

登录 [钉钉 DEAP 平台](https://deap.dingtalk.com)，在 **安全与权限** → **API-Key 管理** 页面创建新的 API Key：

<img width="1222" height="545" alt="钉钉 DEAP 平台 API-Key 管理" src="https://github.com/user-attachments/assets/dfe29984-4432-49c1-8226-0f9b60fbb5bc" />

### 第三步：启动 Connector 客户端

1. 从 [Releases](https://github.com/hoskii/dingtalk-openclaw-connector/releases/tag/v0.0.1) 页面下载适配您操作系统的安装包
2. 解压并运行 Connector（以 macOS 为例）：

   ```bash
   unzip connector-mac.zip
   ./connector-darwin -deapCorpId YOUR_CORP_ID -deapApiKey YOUR_API_KEY
   ```

### 第四步：配置 DEAP Agent

1. 登录 [钉钉 DEAP 平台](https://deap.dingtalk.com)，创建新的智能体：

   <img width="2444" height="1486" alt="新建智能体界面" src="https://github.com/user-attachments/assets/0b7f0855-f991-4aeb-b6e6-7576346b4477" />

2. 在技能管理页面，搜索并集成 OpenClaw 技能：

   <img width="3430" height="1732" alt="添加 OpenClaw 技能" src="https://github.com/user-attachments/assets/d44f0038-f863-4c1f-afa7-b774d875e4ba" />

3. 配置技能参数：

   | 参数 | 来源 | 说明 |
   |------|------|------|
   | apikey | 第二步获取 | DEAP 平台 API Key |
   | apihost | 默认值 | 通常为 `127.0.0.1:18789`，在Windows环境下可能需要配置为 `localhost:18789` 才能正常工作 |
   | gatewayToken | 第一步获取 | Gateway 配置的认证令牌 |

   <img width="3426" height="1752" alt="配置 OpenClaw 技能参数" src="https://github.com/user-attachments/assets/bc725789-382f-41b5-bbdb-ba8f29923d5c" />

4. 发布 Agent：

   <img width="3416" height="1762" alt="发布 Agent" src="https://github.com/user-attachments/assets/3f8c3fdb-5f2b-4a4b-8896-35202e713bf3" />

### 第五步：开始使用

1. 在钉钉 App 中搜索并找到您创建的 Agent：

   <img width="1260" height="436" alt="搜索 Agent" src="https://github.com/user-attachments/assets/30feff80-1b28-4274-830b-7045aed14980" />

2. 开始自然语言对话体验：

   <img width="1896" height="1240" alt="与 Agent 对话" src="https://github.com/user-attachments/assets/2a80aab8-3fbf-4d18-beea-770577cb1a40" />

## License

[MIT](LICENSE)
