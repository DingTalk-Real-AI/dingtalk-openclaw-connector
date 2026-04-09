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
- [钉钉 DEAP Agent 集成](docs/DEAP_AGENT_GUIDE.md)
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

#### 方法 A：一键安装 + 扫码授权（推荐）

```bash
npx -y @dingtalk-real-ai/dingtalk-connector install
```

此命令会自动完成：插件安装 → 展示钉钉授权二维码 → 等待扫码 → 保存凭证到配置文件。

安装过程中，终端会展示：

- 钉钉授权二维码（ASCII）
- `Authorization URL`（二维码无法显示时可直接打开）

看到 `Success! Bot configured. (机器人配置成功!)` 即表示授权完成。授权完成后，请手动重启 Gateway 使配置生效：

```bash
openclaw gateway restart
```

> 💡 **Windows 扫码提示**：如果在 Windows 设备中无法扫码成功，可能是终端分辨率导致二维码显示异常。建议更换终端使用 [Cmder](https://cmder.app/) 后重试。
>
> 💡 **扫码失败不影响安装**：即使扫码流程出现 `auth 失败 / 超时 / 二维码展示失败`，也不影响插件依赖继续下载与安装。安装完成后，请按手动流程完成配置：[`docs/DINGTALK_MANUAL_SETUP.md`](docs/DINGTALK_MANUAL_SETUP.md)

#### 方法 B：通过本地源码安装（二次开发）

如果你想对插件进行二次开发，可以先克隆仓库：

```bash
# 1. 克隆插件仓库
git clone https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector.git
cd dingtalk-openclaw-connector

# 2. 安装依赖（必需）
npm install

# 3. 以链接模式安装（方便修改代码后实时生效）
openclaw plugins install -l .

# 4. 触发扫码授权
node bin/dingtalk-connector.js install --local
```

#### 方法 C：手动安装

1. 将本仓库下载或复制到 `~/.openclaw/extensions/dingtalk-connector`。
2. 确保包含 `index.ts`、`openclaw.plugin.json` 和 `package.json`。
3. 在该目录下运行 `npm install` 安装依赖。

#### 方法 D：国内网络环境安装（npm 镜像源）

如果你在国内网络环境下执行 `openclaw plugins install` 时卡在 `Installing plugin dependencies...` 或出现 `npm install failed`，可临时为该次安装指定镜像源：

```bash
NPM_CONFIG_REGISTRY=https://registry.npmmirror.com openclaw plugins install @dingtalk-real-ai/dingtalk-connector
```

如果插件已处于半安装状态（例如扩展目录存在但依赖未装全），可进入插件目录手动补装依赖：

```bash
cd ~/.openclaw/extensions/dingtalk-connector
rm -rf node_modules package-lock.json
NPM_CONFIG_REGISTRY=https://registry.npmmirror.com npm install
```

如果希望长期生效，可设置 npm 默认镜像：

```bash
npm config set registry https://registry.npmmirror.com
```

或写入 `~/.npmrc`：

```
registry=https://registry.npmmirror.com
```

**验证安装**：
```bash
openclaw plugins list
```
你应该看到 `✓ DingTalk Channel (v0.8.6) - loaded`

---

### 步骤 2：重启并测试

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

## 钉钉 DEAP Agent 集成

通过钉钉 DEAP Agent 与 OpenClaw Gateway 连接，实现自然语言驱动的本地设备操作能力。详见 **[钉钉 DEAP Agent 集成指南](docs/DEAP_AGENT_GUIDE.md)**。

---

## 许可证

[MIT](LICENSE)

---

## 支持

- **问题反馈**：[GitHub Issues](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)
- **更新日志**：[CHANGELOG.md](CHANGELOG.md)
