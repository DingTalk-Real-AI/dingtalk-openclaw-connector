# 群聊回复模式快速上手（客户版）

这份文档帮助你在 3 分钟内完成配置，让机器人在群聊中支持互相 `@`。

## 这是什么能力

钉钉连接器支持 3 种群聊回复模式：

- `aicard`（默认）：AI Card 流式回复，观感最好
- `text`：纯文本回复，支持 `@` 机器人
- `markdown`：Markdown 回复，支持 `@` 机器人

## 最推荐配置（直接改 openclaw.json）

编辑 `openclaw.json`，在 `channels.dingtalk-connector` 下增加（或修改）`groupReplyMode`：

```json
{
  "channels": {
    "dingtalk-connector": {
      "groupReplyMode": "text"
    }
  }
}
```

可选值：

- `aicard`
- `text`
- `markdown`

保存后重启 Gateway 生效。

> 注意：当前版本不再提供 `dingtalk-connector.setGroupReplyMode` Gateway Method。
> 请统一通过 `openclaw.json` 配置。

## 怎么选模式（按你的业务场景）

| 配置值 | 群聊效果 | 是否支持机器人互相 @ |
| --- | --- | --- |
| `aicard` | AI Card 流式响应 | 否 |
| `text` | 纯文本回复 | 是（通过 `atDingtalkIds`） |
| `markdown` | Markdown 回复 | 是（通过 `atDingtalkIds`） |

选择建议：

- 如果你要“机器人 A @ 机器人 B 协同工作”：选 `text` 或 `markdown`
- 如果你更看重流式体验和卡片观感：选 `aicard`

## 常用配置示例

### 示例 1：最稳妥（推荐）

```json
{
  "channels": {
    "dingtalk-connector": {
      "enabled": true,
      "clientId": "dingxxxxxxxx",
      "clientSecret": "your_secret",
      "groupReplyMode": "text"
    }
  }
}
```

### 示例 2：保留卡片体验

```json
{
  "channels": {
    "dingtalk-connector": {
      "groupReplyMode": "aicard"
    }
  }
}
```

## 给业务同学看的“一句话说明”

- `aicard`：像聊天流一样实时输出，但不支持机器人互相 `@`
- `text/markdown`：不走 AI Card，改成普通消息，支持机器人互相 `@`

## 能力清单（面向用户）

- 支持三种回复样式：`aicard`、`text`、`markdown`
- 支持多机器人在群聊中通过 `@` 协同（`text/markdown` 模式）
- 支持 Markdown 格式化输出（`markdown` 模式）
- 支持按业务场景快速切换模式（通过配置项 `groupReplyMode`）

## 常见问题（FAQ）

### 1) 我改了配置但没生效？

按顺序检查：

1. 确认改的是当前环境的 `openclaw.json`
2. 确认字段路径是 `channels.dingtalk-connector.groupReplyMode`
3. 确认值是 `aicard` / `text` / `markdown` 之一
4. 重启 Gateway

### 2) 为什么群里看不到 AI Card 了？

因为你把 `groupReplyMode` 设成了 `text` 或 `markdown`。这是预期行为。

### 3) 为什么单聊还是 AI Card？

当前能力聚焦群聊模式配置：`groupReplyMode` 用于控制群聊回复样式（`aicard` / `text` / `markdown`）。

## 运维建议

- 生产环境建议固定一个模式，避免频繁切换导致用户体验不一致
- 多机器人协同场景优先 `text`，格式化输出场景优先 `markdown`
- 首次上线建议先在测试群验证一次 `@` 链路再推广

