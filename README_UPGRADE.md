# 钉钉 OpenClaw 连接器 - v0.8.0 内测版

## 🎉 主要更新

- **SDK 迁移** - 从旧版 Clawdbot SDK 迁移到 OpenClaw SDK
- **多账号支持** - 支持同时配置多个钉钉机器人账号
- **安全策略配置** - 支持单聊/群聊策略（open/pairing/allowlist）
- **SecretInput 模式** - 支持从环境变量、文件获取敏感信息
- **模块化架构** - 代码从单文件（3938 行）拆分为 19 个模块

> ⚠️ **内测版本**：可能存在不稳定因素，建议先在测试环境验证

## 📦 安装方式

### 一键安装（推荐）

```bash
curl -fsSL https://raw.githubusercontent.com/DingTalk-Real-AI/dingtalk-openclaw-connector/feat/migrate-to-openclaw-sdk/install-beta.sh | bash
```

### 手动安装

#### 方式一：从 GitHub 安装（标准版）

```bash
# 克隆升级分支
git clone --single-branch --branch feat/migrate-to-openclaw-sdk \
    https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector.git \
    dingtalk-openclaw-connector-beta

cd dingtalk-openclaw-connector-beta
npm install

# 安装插件
openclaw plugins install -l .

# 重启 Gateway
openclaw gateway restart
```

#### 方式二：本地开发版本安装

如果你使用的是本地开发的 OpenClaw 版本，请按以下步骤操作：

```bash
# 1. 克隆升级分支
git clone --single-branch --branch feat/migrate-to-openclaw-sdk \
    https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector.git \
    dingtalk-openclaw-connector-beta

cd dingtalk-openclaw-connector-beta
npm install

# 2. 修改 OpenClaw 配置，添加本地插件路径
# 编辑 ~/.openclaw/config.json，在 plugins.load.paths 中添加插件路径
# {
#   "plugins": {
#     "load": {
#       "paths": [
#         "/path/to/dingtalk-openclaw-connector-beta"
#       ]
#     }
#   }
# }

# 3. 重启 Gateway
openclaw gateway restart
```

> 💡 **提示**：本地开发版本安装后，插件会自动从配置的 `paths` 中加载，无需运行 `openclaw plugins install`

## ✅ 验证安装

安装完成后，运行以下命令验证是否安装成功且为内测版本：

```bash
openclaw plugins list | grep dingtalk-connector
```

应该看到：
```
✓ dingtalk-connector (enabled)
```

```bash
openclaw plugins info dingtalk-connector | grep version
```

应该看到版本号：`v0.8.0-beta` 或更高（包含 `beta` 标识）

```bash
# 测试连接
# 在钉钉中向机器人发送任意消息，查看是否正常响应
```

## ⚠️ 注意事项

1. **向下兼容**：旧配置无需修改即可使用
2. **自动备份**：安装脚本会自动备份当前配置
3. **配置验证**：新增了配置 Schema 验证，配置错误会提示具体原因

## 🐛 问题反馈

如有任何问题或建议，欢迎反馈：

- **反馈表单**：https://alidocs.dingtalk.com/notable/share/form/v01jP2lRYjr5xxPEO8g_dv19yqvsgs3oebp3pcjys_1qX0QQ0
- **内测群**：扫描下方二维码加入

![内测群二维码](此处粘贴二维码图片)
