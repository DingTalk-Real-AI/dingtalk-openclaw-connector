<div align="center">
  <img alt="DingTalk" src="https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/main/docs/images/dingtalk.svg" width="72" height="72" />
  <h1>OpenClaw DingTalk Plugin</h1>
  <p>Official DingTalk channel plugin for OpenClaw, developed and maintained by the DingTalk team.<br/>It seamlessly connects your OpenClaw Agent to DingTalk, enabling it to directly send/receive messages, manage docs, calendars, tasks, and more.</p>

  <p>
    <a href="https://www.npmjs.com/package/@dingtalk-real-ai/dingtalk-connector"><img src="https://img.shields.io/npm/v/@dingtalk-real-ai/dingtalk-connector.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/@dingtalk-real-ai/dingtalk-connector"><img src="https://img.shields.io/npm/dm/@dingtalk-real-ai/dingtalk-connector.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="npm downloads" /></a>
    <a href="https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/LICENSE"><img src="https://img.shields.io/github/license/DingTalk-Real-AI/dingtalk-openclaw-connector.svg?style=flat&colorA=18181B&colorB=28CF8D" alt="license" /></a>
  </p>

  <p>
    <a href="README.md">简体中文</a> •
    <a href="CHANGELOG.md">Changelog</a> •
    <a href="https://openclaw.ai/">OpenClaw Website</a>
  </p>
</div>

---

## Features

This plugin provides comprehensive DingTalk integration for OpenClaw:

| Category | Capabilities |
|----------|-------------|
| 💬 Messaging | Receive group/DM messages, auto-reply, send text/Markdown, @mentions |
| ✅ Tasks | Create personal tasks, check status, set deadlines |
| 📊 AI Sheets | Create sheets, read/write rows, conditional queries |
| 📅 Calendar | Calendar management, event management (create/query/modify/delete/search), attendee management, free/busy queries |

Additionally, the plugin supports:

- 🌊 **AI Card Streaming**: Typewriter-style live streaming responses within message cards
- 📱 **Interactive Cards**: Real-time status updates (Thinking/Generating/Complete), confirmation buttons for sensitive operations
- 🔒 **Permission Policies**: Flexible access control policies for DMs and group chats
- ⚙️ **Multi-Agent Routing**: Connect multiple bots to different Agents for specialized services
- 🖼️ **Rich Media**: Receive images/audio/file attachments, auto-upload local images
- 🔄 **Session Management**: Multi-turn conversation context, isolated sessions for DMs/groups

> 🚧 **Coming Soon** — The following capabilities are under active development!

| Category | Capabilities |
|----------|-------------|
| 🔔 DING | Send urgent DING reminders to users/groups |
| ✅ Tasks | Create group tasks, check status, set deadlines |
| 📝 Reports | Submit daily/weekly reports, query history |
| 📁 Drive | Upload/download files to DingTalk Drive |
| 📄 Docs | Create, append, search, and list DingTalk documents |

---

## Security & Risk Warnings (Read Before Use)

This plugin integrates with OpenClaw AI automation capabilities and carries inherent risks such as model hallucinations, unpredictable execution, and prompt injection. After you authorize DingTalk permissions, OpenClaw will act under your user identity within the authorized scope, which may lead to high-risk consequences such as leakage of sensitive data or unauthorized operations. Please use with caution.

To reduce these risks, the plugin enables default security protections at multiple layers. However, these risks still exist. **We strongly recommend that you do not proactively modify any default security settings**; once relevant restrictions are relaxed, the risks will increase significantly, and you will bear the consequences.

We recommend using the DingTalk bot connected to OpenClaw as a **personal conversational assistant**. Avoid deploying it directly in enterprise production environments. If you plan to use it with a company account, please comply with your company's information security policies.

> By using this plugin, you are deemed to have fully understood and voluntarily assumed all related risks and responsibilities.

---

## Requirements & Installation

Before you start, make sure you have:

- **OpenClaw**: Installed and running properly. Visit the [OpenClaw website](https://openclaw.ai/) for details.
- **Version**: OpenClaw ≥ **2026.4.9**. Check with `openclaw -v`.

> If below this version, upgrade with: `npm install -g openclaw`

### One-Click Install + QR Auth (Recommended)

```bash
npx -y @dingtalk-real-ai/dingtalk-connector install
```

During installation, the terminal will display a DingTalk authorization QR code. Scan it with the **DingTalk mobile app** and tap "Create Bot" to complete authorization.

When you see `Success! Bot configured.`, the authorization is complete. Then restart the Gateway:

```bash
openclaw gateway restart
```

> 💡 **Scan failure does not affect installation**: Even if the QR flow fails, plugin dependencies will still be installed. See [Manual Setup Guide](docs/DINGTALK_MANUAL_SETUP.md) to complete configuration.

---

## Usage Guide

[OpenClaw DingTalk Plugin User Guide](https://alidocs.dingtalk.com/i/nodes/2Amq4vjg89GEno0zfPqoPGqdV3kdP0wQ?utm_scene=team_space)

---

## Advanced Documentation

- [Manual Setup Guide](docs/DINGTALK_MANUAL_SETUP.md) — Configure credentials manually
- [Group Reply Mode Quick Start (Customer)](docs/GROUP_REPLY_MODE_QUICK_START.md) — Three reply modes and bot-to-bot @mention setup
- [DingTalk DEAP Agent Integration](docs/DEAP_AGENT_GUIDE.en.md) — Local device operation capabilities
- [Multi-Agent Routing](https://gist.github.com/smallnest/c5c13482740fd179e40070e620f66a52) — Bind multiple bots to different Agents
- [Troubleshooting](docs/TROUBLESHOOTING.md) — Installation and usage issue resolution

---

## Contributing

Community contributions are welcome! If you find a bug or have feature suggestions, please submit an [Issue](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues) or Pull Request.

For major changes, we recommend discussing with us first via an Issue.

---

## License

This project is licensed under the [MIT](LICENSE) License.

---

## Support

- **Issues**: [GitHub Issues](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)
- **Changelog**: [CHANGELOG.md](CHANGELOG.md)
