# 钉钉手动创建与手动配置流程

当一键扫码授权不可用、扫码失败，或你希望手动控制配置时，可使用本流程。

## 1) 手动创建钉钉机器人

### 1.1 创建应用

1. 访问 [钉钉开放平台](https://open-dev.dingtalk.com/)
2. 点击 **"应用开发"**

![创建应用](images/image-1.png)

### 1.2 添加机器人能力

1. 在应用详情页，点击一键创建 OpenClaw 机器人应用

![创建OpenClaw机器人应用](images/image-2.png)

### 1.3 获取凭证

1. 完成创建并获取 **"凭证与基础信息"**
2. 复制你的 **AppKey**（Client ID）
3. 复制你的 **AppSecret**（Client Secret）

![完成创建](images/image-3.png)
![获取凭证](images/image-4.png)

> ⚠️ **重要**：`clientId` 和 `clientSecret` 是机器人的唯一凭证，请合理保存。

## 2) 手动配置 OpenClaw

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
