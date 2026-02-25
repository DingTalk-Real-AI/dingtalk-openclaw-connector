# 钉钉机器人连接 OpenClaw Gateway 本地配置指南

## 前置条件确认

✅ 已安装 OpenClaw Gateway
✅ 已创建钉钉机器人应用（有 AppKey 和 AppSecret）

## 步骤 1：安装插件

在终端执行：

```bash
# 通过 npm 安装
openclaw plugins install @dingtalk-real-ai/dingtalk-connector

# 验证安装
openclaw plugins list
```

你应该看到 `dingtalk-connector` 出现在插件列表中。

## 步骤 2：配置插件

### 方式 A：通过配置文件（推荐）

编辑 `~/.openclaw/openclaw.json`，添加以下配置：

```json
{
  "channels": {
    "dingtalk-connector": {
      "enabled": true,
      "clientId": "你的钉钉AppKey",
      "clientSecret": "你的钉钉AppSecret",
      "gatewayToken": "",
      "sessionTimeout": 1800000
    }
  },
  "gateway": {
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

**配置说明**：
- `clientId`: 钉钉开放平台的 AppKey
- `clientSecret`: 钉钉开放平台的 AppSecret
- `gatewayToken`: 如果你的 Gateway 配置了认证 token，填写这里（可选）
- `sessionTimeout`: 会话超时时间（毫秒），默认 30 分钟

### 方式 B：通过 OpenClaw Dashboard

1. 访问 OpenClaw Dashboard（通常是 `http://localhost:18789`）
2. 进入 Channels 配置页面
3. 找到 `dingtalk-connector`
4. 填写 `clientId` 和 `clientSecret`
5. 保存配置

## 步骤 3：确认钉钉机器人配置

登录 [钉钉开放平台](https://open.dingtalk.com/)，确认你的机器人应用：

### 3.1 消息接收模式
- ✅ 必须选择 **Stream 模式**（不是 HTTP 回调）

### 3.2 权限配置
确保开通以下权限：
- `Card.Streaming.Write` - AI Card 流式写入
- `Card.Instance.Write` - AI Card 实例写入
- `qyapi_robot_sendmsg` - 机器人发送消息

### 3.3 发布应用
- ✅ 应用必须已发布（开发中的应用无法使用）

## 步骤 4：重启 Gateway

```bash
# 重启 Gateway 使配置生效
openclaw gateway restart

# 查看日志确认启动成功
openclaw gateway logs
```

你应该看到类似这样的日志：
```
[DingTalk] 插件已注册（支持主动发送 AI Card 消息）
[DingTalk] Stream 客户端已连接
```

## 步骤 5：测试

1. 在钉钉 App 中找到你的机器人
2. 发送一条消息，例如："你好"
3. 观察是否收到 AI Card 流式响应（打字机效果）

## 常见问题排查

### Q1: 插件安装后不显示
```bash
# 检查插件目录
ls ~/.openclaw/plugins/

# 重新安装
openclaw plugins uninstall dingtalk-connector
openclaw plugins install @dingtalk-real-ai/dingtalk-connector
```

### Q2: 机器人无响应
检查以下几点：
1. Gateway 是否正常运行：`openclaw gateway status`
2. 配置是否正确：`cat ~/.openclaw/openclaw.json`
3. 钉钉机器人是否使用 Stream 模式
4. 权限是否完整开通
5. 应用是否已发布

### Q3: 查看详细日志
```bash
# 实时查看日志
openclaw gateway logs -f

# 查看最近 100 行
openclaw gateway logs --tail 100
```

### Q4: Gateway 认证配置
如果你的 Gateway 配置了认证，需要在 `openclaw.json` 中添加：

```json
{
  "gateway": {
    "auth": {
      "token": "your-gateway-token"
    }
  },
  "channels": {
    "dingtalk-connector": {
      "gatewayToken": "your-gateway-token"
    }
  }
}
```

## 高级功能

### 会话管理
用户可以发送以下命令开启新会话：
- `/new`、`/reset`、`/clear`
- `新会话`、`重新开始`、`清空对话`

### 主动发送消息
插件支持通过 Gateway API 主动给用户或群发送消息（参考 README.md）

## 下一步

配置成功后，你可以：
1. 测试多轮对话功能
2. 测试会话超时和新会话命令
3. 尝试发送图片、文件等媒体内容
4. 探索主动消息发送功能

## 需要帮助？

- 查看完整文档：[README.md](./README.md)
- 提交问题：https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues
