# Release Notes - v0.7.1

## 🐛 修复版本 / Bug Fix Release

本次更新修复了 stream 模式下的关键问题，确保 Agent 路由功能正常工作。

This update fixes critical issues in stream mode to ensure Agent routing functionality works correctly.

## 🐛 修复 / Fixes

### 1. Stream 模式 Session 路由失败问题 / Stream Mode Session Routing Failure

**问题描述 / Issue Description**：stream 模式下 model 参数错误导致 session 路由失败  
Incorrect model parameter in stream mode caused session routing failures

**修复内容 / Fix**：
- 将 Gateway 请求中的 `model` 参数从 `'default'` 更正为 `'main'`  
  Corrected `model` parameter in Gateway requests from `'default'` to `'main'`
- 确保正确的 Agent 路由和会话管理  
  Ensures proper Agent routing and session management

**影响范围 / Impact**：影响所有使用 stream 模式的用户，修复后 Agent 路由将正常工作  
Affects all users using stream mode. After the fix, Agent routing will work correctly.

### 2. 多 Agent 路由问题修复 / Multi-Agent Routing Fix

**问题描述 / Issue Description**：多个钉钉机器人绑定到不同 Agent 时路由异常
Multiple DingTalk bots binding to different Agents failed to route correctly

**修复内容 / Fix**：
- 修复多 Agent 路由机制，确保多个钉钉机器人可以正确绑定到不同的 Agent  
  Fixed multi-Agent routing mechanism, ensuring multiple DingTalk bots can correctly bind to different Agents
- 改进会话隔离和路由逻辑  
  Improved session isolation and routing logic

**影响范围 / Impact**：影响使用多 Agent 配置的用户，修复后多机器人多 Agent 场景将正常工作  
Affects users with multi-Agent configurations. After the fix, multi-bot multi-Agent scenarios will work correctly.

## 🔧 改进 / Improvements

- **异步模式优化** - 优化异步模式处理流程，改进错误处理和日志输出  
  **Async Mode Optimization** - Optimized async mode processing flow, improved error handling and log output
- **DM Policy 增强** - 增强 DM Policy 检查机制，支持白名单配置  
  **DM Policy Enhancement** - Enhanced DM Policy check mechanism, supporting allowlist configuration

## 📥 安装升级 / Installation & Upgrade

```bash
# 通过 npm 安装最新版本 / Install latest version via npm
openclaw plugins install @dingtalk-real-ai/dingtalk-connector

# 或升级现有版本 / Or upgrade existing version
openclaw plugins update dingtalk-connector

# 通过 Git 安装 / Install via Git
openclaw plugins install https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector.git
```

## 🔗 相关链接 / Related Links

- [完整变更日志 / Full Changelog](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/CHANGELOG.md)
- [使用文档 / Documentation](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/blob/main/README.md)
- [问题反馈 / Issue Feedback](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)

## 🙏 致谢 / Acknowledgments

感谢所有贡献者和用户的支持与反馈！  
Thanks to all contributors and users for their support and feedback!

---

**发布日期 / Release Date**：2026-03-05  
**版本号 / Version**：v0.7.1  
**兼容性 / Compatibility**：OpenClaw Gateway 0.4.0+
