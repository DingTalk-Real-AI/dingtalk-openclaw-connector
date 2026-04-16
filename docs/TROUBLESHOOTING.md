# 常见问题 / Troubleshooting

---

## 机器人不回复

**症状**：机器人不回复消息

**解决方案**：
1. 检查插件状态：`openclaw plugins list`
2. 检查网关状态：`openclaw gateway status`
3. 查看日志：`openclaw logs --follow`
4. 确认应用已在钉钉开放平台发布

---

## 配置字段不合法（additional properties）

**症状**：

```
Problem:
  - channels.dingtalk-connector: invalid config: must NOT have additional properties
```

**原因**：配置文件中包含已废弃或已重命名的字段，连接器不再识别。

**解决方案**：打开 `openclaw.config.yaml`，删除 `channels.dingtalk-connector` 下不再支持的字段。已知需要删除的旧字段：

| 旧字段 | 说明 |
|--------|------|
| `gatewayPassword` | 早期版本字段，已废弃 |
| `gatewayToken` | 早期版本字段，已废弃 |
| `dmHistoryLimit` | v0.8.9 移除（未实现） |

错误信息会指出具体的字段名，删除后重启即可。

---

## HTTP 401 错误

**症状**：错误信息显示 "401 Unauthorized"

**解决方案**：升级到最新版本。

---

## Stream 连接 400 错误

**症状**：日志显示 "Request failed with status code 400"

**常见原因**：

| 原因 | 解决方案 |
|------|----------|
| 应用未发布 | 前往钉钉开放平台 → 版本管理 → 发布 |
| 凭证错误 | 检查 `clientId`/`clientSecret` 是否有拼写错误或多余空格 |
| 非 Stream 模式 | 确认机器人配置为 Stream 模式（不是 Webhook） |
| IP 白名单限制 | 检查应用是否设置了 IP 白名单 |

**验证步骤**：
1. 登录 [钉钉开放平台](https://open-dev.dingtalk.com/)，确认应用已发布、机器人已启用且为 Stream 模式
2. 修改任何配置后，必须点击 **保存** → **发布**

---

## 插件安装失败

**原因**：OpenClaw 版本与 connector 版本不兼容，或 npm 源不可达。

**解决方案**：
1. 确保 OpenClaw 版本 ≥ 2026.3.22：`openclaw -v`
2. 升级 OpenClaw：`npm install -g openclaw`
3. 国内网络使用 npm 镜像：
   ```bash
   npm config set registry https://registry.npmmirror.com
   ```

---

## macOS 安装报错 `Also not a valid hook pack`

**原因**：`openclaw.plugin.json` 缺失或格式错误。

**解决方案**：确认该文件存在且格式正确，检查 Node.js 版本是否满足要求，必要时重新安装 OpenClaw 主程序。

---

## Linux 安装报错 `package.json missing openclaw.hooks`

**原因**：安装路径不正确或文件权限不足。

**解决方案**：确认 `openclaw.plugin.json` 配置正确，检查当前用户对安装目录的读写权限。

---

## 国内网络安装（npm 镜像源）

如果执行 `openclaw plugins install` 卡在 `Installing plugin dependencies...` 或出现 `npm install failed`：

```bash
# 临时指定镜像源安装
NPM_CONFIG_REGISTRY=https://registry.npmmirror.com openclaw plugins install @dingtalk-real-ai/dingtalk-connector

# 或设置全局镜像
npm config set registry https://registry.npmmirror.com
```

如果插件目录已存在但依赖不全：

```bash
cd ~/.openclaw/extensions/dingtalk-connector
rm -rf node_modules package-lock.json
NPM_CONFIG_REGISTRY=https://registry.npmmirror.com npm install
```

---

## 支持

- **问题反馈**：[GitHub Issues](https://github.com/DingTalk-Real-AI/dingtalk-openclaw-connector/issues)
- **更新日志**：[CHANGELOG.md](../CHANGELOG.md)
