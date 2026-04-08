<div align="center">
  <img alt="DingTalk" src="https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/main/docs/images/dingtalk.svg" width="72" height="72" />
  <h1>Official DingTalk OpenClaw Connector</h1>
  <p>Connect DingTalk bots to OpenClaw Gateway with AI Card streaming and session management</p>
  
  <p>
    <a href="README.md">简体中文</a> •
    <a href="CHANGELOG.md">Changelog</a>
  </p>
</div>

---

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Features](#features)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)
- [Advanced Topics](#advanced-topics)
- [DingTalk DEAP Agent Integration](docs/DEAP_AGENT_GUIDE.en.md)
- [License](#license)

---

## Prerequisites

Before you begin, ensure you have:

> This connector is used as an OpenClaw Gateway plugin, and you usually don't need to install or manage Node.js runtime by yourself.

### 1. OpenClaw Gateway

- **Official Website**: https://openclaw.ai/
- **Installation**: Follow the official guide to install OpenClaw
- **Verify installation**:
  ```bash
  openclaw gateway status
  ```
  Expected output: `✓ Gateway is running on http://127.0.0.1:18789`

### 2. DingTalk Enterprise Account

- You need a DingTalk enterprise account to create internal applications
- Official Website: https://www.dingtalk.com/

---

## Quick Start

> 💡 **Goal**: Get your DingTalk bot working in ~5 minutes

### Operating System Support

- macOS / Linux: Use the default shell (zsh, bash, etc.).
- Windows:
  - Recommended: **PowerShell** or **Windows Terminal**.
  - OpenClaw config file path (default): `C:\Users\<YourUserName>\.openclaw\openclaw.json`.

Whenever you see `~/.openclaw/openclaw.json` below, it is equivalent to the above path on Windows.

### Step 1: Install the Plugin

#### Method A: Install via npm (Recommended)

```bash
openclaw plugins install @dingtalk-real-ai/dingtalk-connector
```

#### Method B: Install from Local Source

If you want to develop or modify the plugin, clone the repository first:

```bash
# 1. Clone the plugin repository
git clone https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector.git
cd dingtalk-openclaw-connector

# 2. Install dependencies (required)
npm install

# 3. Install in link mode (changes take effect immediately)
openclaw plugins install -l .
```

#### Method C: Manual Installation

1. Download or copy this repository to `~/.openclaw/extensions/dingtalk-connector`.
2. Make sure it contains `index.ts`, `openclaw.plugin.json`, and `package.json`.
3. Run `npm install` in that directory to install dependencies.

#### Method D: China Mainland Installation (npm Mirror)

If `openclaw plugins install` gets stuck at `Installing plugin dependencies...` or fails with `npm install failed` due to network issues in China, you can specify a mirror registry for that install:

```bash
NPM_CONFIG_REGISTRY=https://registry.npmmirror.com openclaw plugins install @dingtalk-real-ai/dingtalk-connector
```

If the plugin is in a partially installed state (e.g., the extension directory exists but dependencies are incomplete), you can manually reinstall dependencies:

```bash
cd ~/.openclaw/extensions/dingtalk-connector
rm -rf node_modules package-lock.json
NPM_CONFIG_REGISTRY=https://registry.npmmirror.com npm install
```

To make the mirror permanent, set the default npm registry:

```bash
npm config set registry https://registry.npmmirror.com
```

Or add to `~/.npmrc`:

```
registry=https://registry.npmmirror.com
```

**Verify installation**:
```bash
openclaw plugins list
```
You should see output similar to `✓ DingTalk Channel (vX.X.X) - loaded`.

> ⚠️ **If you don't see `loaded`**, resolve the plugin loading issue before proceeding to Step 3. Otherwise, DingTalk will not appear in `openclaw channels add`.

---

### Step 2: Create a DingTalk Bot

#### 2.1 Create Application

1. Go to [DingTalk Open Platform](https://open-dev.dingtalk.com/)
2. Click **"Application Development"**

![Create Application](https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/main/docs/images/image-1.png)

#### 2.2 Add Bot Capability

1. On the application details page, use the “one-click OpenClaw bot app” flow

![Create OpenClaw bot app](https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/main/docs/images/image-2.png)

#### 2.3 Get Credentials

1. Finish creation and open **"Credentials & Basic Info"**
2. Copy your **AppKey** (Client ID)
3. Copy your **AppSecret** (Client Secret)

![Finish creation](https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/main/docs/images/image-3.png)

![Get credentials](https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/main/docs/images/image-4.png)

> ⚠️ **Important**: Client ID and Client Secret are your bot’s unique credentials. Store them safely.

---

### Step 3: Configure OpenClaw

You have three options to configure the connector:

#### Option A: Configuration Wizard (Recommended for Beginners)

> You can directly copy and paste the following command into your terminal to run the configuration wizard.

```bash
openclaw channels add
```

Select **"DingTalk (钉钉)"** and follow the prompts to enter:
- `clientId` (AppKey)
- `clientSecret` (AppSecret)

#### Option B: Edit Configuration File

Edit the configuration file:

- macOS / Linux: `~/.openclaw/openclaw.json`
- Windows: `C:\Users\<YourUserName>\.openclaw\openclaw.json`

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

> 💡 **Tip**: If the file already has content, add the `dingtalk-connector` section under the `channels` node.

---

### Step 4: Restart and Test

```bash
# Restart OpenClaw Gateway
openclaw gateway restart

# Watch logs in real-time
openclaw logs --follow
```

**Test your bot**:
1. Open DingTalk app
2. Find your bot in the contact list
3. Send a message: `Hello`
4. You should receive a response within 10 seconds

---

## Features

### ✅ Core Features

- **AI Card Streaming** - Typewriter-like replies with real-time streaming
- **Session Management** - Multi-turn conversations with context preservation
- **Session Isolation** - Separate sessions for DMs, groups, and different groups
- **Auto Session Reset** - Automatic new session after 30 minutes of inactivity
- **Manual Session Reset** - Send `/new` or `新会话` to clear conversation history
- **Image Auto-Upload** - Local image paths automatically uploaded to DingTalk
- **Proactive Messaging** - Send messages to users or groups programmatically
- **Rich Media Reception** - Receive and process JPEG/PNG images, pass to vision models
- **File Attachment Extraction** - Parse .docx, .pdf, text files, and binary files
- **Audio Message Support** - Send audio messages in multiple formats (mp3, wav, amr, ogg)
- **DingTalk Docs API** - Create, append, search, and list DingTalk documents
- **Multi-Agent Routing** - Connect multiple bots to different agents for specialized services
- **Markdown Table Conversion** - Auto-convert Markdown tables to DingTalk-compatible format
- **Async Mode** - Immediate acknowledgment with background processing (optional)

---

## Configuration

### Basic Configuration

| Option | Environment Variable | Description |
|--------|---------------------|-------------|
| `clientId` | — | DingTalk AppKey |
| `clientSecret` | — | DingTalk AppSecret |

### Session Management

| Option | Default | Description |
|--------|---------|-------------|
| `separateSessionByConversation` | `true` | Separate sessions for DMs/groups |
| `groupSessionScope` | `group` | Group session scope: `group` (shared) or `group_sender` (per-user) |
| `sharedMemoryAcrossConversations` | `false` | Share memory across different conversations |

### Session routing policies (`pmpolicy` / `groupPolicy`)

Both session routing/message policy options (including `pmpolicy` and `groupPolicy`) are supported now, so you **do not need to remove** them from existing configurations.

> Note: field names may vary across versions/upstream; on the connector side, related policies are supported and applied (for example, `dmPolicy`/`groupPolicy` default to `open`).

### Async Mode

| Option | Default | Description |
|--------|---------|-------------|
| `asyncMode` | `false` | Enable async mode for long-running tasks |
| `ackText` | `🫡 任务已接收，处理中...` | Acknowledgment message text |

---

## Troubleshooting

### Bot Not Responding

**Symptoms**: Bot doesn't reply to messages

**Solutions**:
1. Check plugin status: `openclaw plugins list`
2. Check gateway status: `openclaw gateway status`
3. Check logs: `openclaw logs --follow`
4. Verify the app is published/enabled in DingTalk Open Platform

---

### Invalid Config: additional properties

**Symptoms**:

```
Problem:
  - channels.dingtalk-connector: invalid config: must NOT have additional properties
```

**Cause**: Your config file contains deprecated or renamed fields that are no longer recognized.

**Solution**: Open `openclaw.config.yaml` and remove any unsupported fields under `channels.dingtalk-connector`. Known fields to remove:

| Old Field | Notes |
|-----------|-------|
| `gatewayPassword` | Deprecated legacy field |
| `gatewayToken` | Deprecated legacy field |
| `dmHistoryLimit` | Removed in v0.8.9 (never implemented) |

The error message will indicate the exact field name. Remove it and restart.

---

### HTTP 401 Error

**Symptoms**: Error message shows "401 Unauthorized"

**Solution**: Upgrade to the latest version.

---

### Stream Connection 400 Error

**Symptoms**: Logs show "Request failed with status code 400"

**Common Causes**:

| Cause | Solution |
|-------|----------|
| App not published | DingTalk Open Platform → Version Management → Publish |
| Invalid credentials | Check `clientId`/`clientSecret` for typos or extra spaces |
| Not Stream mode | Verify bot is configured for Stream mode (not Webhook) |
| IP whitelist | Check if the app has IP whitelist restrictions |

**Verification Steps**:
1. Check app status in [DingTalk Open Platform](https://open-dev.dingtalk.com/)
2. After any configuration change, click **Save** → **Publish**

---

## Advanced Topics

### Multi-Agent Configuration

Configure multiple bots connected to different agents:

```json5
{
  "agents": {
    "list": [
      {
        "id": "ding-bot1",
        "name": "Customer Service Bot",
        "model": "your-model-config",
        "workspace": "~/.openclaw/workspace-bot1",
        "identity": {
          "name": "Service Assistant",
          "theme": "customer service",
          "emoji": "🤝"
        }
        // Other agent configurations...
      },
      {
        "id": "ding-bot2",
        "name": "Technical Support Bot",
        "model": "your-model-config",
        "workspace": "~/.openclaw/workspace-bot2",
        "identity": {
          "name": "Tech Expert",
          "theme": "technical support",
          "emoji": "🔧"
        }
        // Other agent configurations...
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

For more details, see [OpenClaw Multi-Agent Configuration Guide](https://gist.github.com/smallnest/c5c13482740fd179e40070e620f66a52).

---

### Session Commands

Users can send the following commands to start a fresh session:

- `/new`, `/reset`, `/clear`
- `新会话`, `重新开始`, `清空对话`

---

### DingTalk Docs via MCP (`docs.*`)

DingTalk Docs capabilities (`docs.*`, including `docs.create` / `docs.append` / `docs.search` / `docs.list` / `docs.read`) require MCP (Model Context Protocol) to provide the underlying tools. To enable `docs.*`, install and enable the corresponding MCP Server/Tool in the OpenClaw Gateway/Agent.

- **Where to get MCP Server/Tool**: via the [DingTalk MCP Marketplace](https://mcp.dingtalk.com/) (or your team’s internal MCP marketplace). You can also use a third-party marketplace to source an equivalent “DingTalk Docs Read / DingTalk Docs Reader” capability and connect it to OpenClaw.
- **Where to configure**: usually at the **Gateway or Agent tool configuration** level (not in this connector).
- **How it takes effect**: restart the Gateway and ensure the tool is exposed to the target agent.

References (OpenClaw configuration docs):
- `https://docs.openclaw.ai/configuration`
- `https://docs.openclaw.ai/gateway/configuration-reference`

Create and manage DingTalk documents from your agent:

```javascript
// Create document
dingtalk-connector.docs.create({
  spaceId: "your-space-id",
  title: "Test Document",
  content: "# Test Content"
})

// Append content
dingtalk-connector.docs.append({
  docId: "your-doc-id",
  markdownContent: "\n## Appended Content"
})

// Search documents
dingtalk-connector.docs.search({
  keyword: "search keyword"
})

// List documents
dingtalk-connector.docs.list({
  spaceId: "your-space-id"
})
```

---

## Project Structure

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

## Dependencies

| Package | Purpose |
|---------|---------|
| `dingtalk-stream` | DingTalk Stream protocol client |
| `axios` | HTTP client |
| `mammoth` | Word document (.docx) parsing |
| `pdf-parse` | PDF document parsing |

---

## DingTalk DEAP Agent Integration

Connect DingTalk DEAP Agent with OpenClaw Gateway to enable natural language-driven local device operations. See **[DingTalk DEAP Agent Integration Guide](docs/DEAP_AGENT_GUIDE.en.md)** for details.

---

## License

[MIT](LICENSE)

---

## Support

- **Issues**: [GitHub Issues](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)
