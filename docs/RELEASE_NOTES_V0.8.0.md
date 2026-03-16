# Release Notes - v0.8.0

## 群聊增强版本 / Group Chat Enhancement Release

本次更新解决了钉钉群聊中的三个核心痛点：@ 提醒不生效、AI Card 在群聊中体验不佳、以及 oapi access_token 重复获取导致的延迟。

This release addresses three core pain points in DingTalk group chats: @ mentions not working, poor AI Card experience in groups, and latency from redundant oapi access_token fetches.

## 核心功能 / Core Features

### 群聊 Webhook 消息模式 / Group Webhook Message Mode

**问题 / Problem**: 钉钉 Stream Bot 和 AI Card API 均不支持 `atMobiles` 参数，导致群聊中的 @ 提醒无法触发通知。

**解决方案 / Solution**: 通过自定义机器人 Webhook 发送群聊回复，AI Card 作为实时进度指示器：

```
用户发消息 → AI Card 创建（进度流）→ Gateway 流式生成 → AI Card 实时更新
                                                     → 生成完成 → Webhook 发送最终回复（带 @）
                                                                 → AI Card 覆盖为摘要
```

### @ 提醒机制 / @ Mention Mechanism

AI 通过 `<<AT:name>>` 线索格式自主决定需要通知的人：

- **线索提取**: 从 AI 回复中解析 `<<AT:Alice,Bob>>` 格式
- **保底扫描**: 扫描文本中的 `@Alice` 等显式 @ 模式
- **自动转换**: 通过 `groupAtMemberMap` 配置将昵称转换为手机号
- **系统提示词**: 自动注入使用说明，教会 AI 何时 @ 、何时不 @

### oapi Access Token 缓存 / oapi Access Token Caching

`getOapiAccessToken` 增加 110 分钟内存缓存（token 有效期 2 小时），消除每次请求 ~8s 的 DNS 解析 + API 调用延迟。

## 配置 / Configuration

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `groupWebhookUrl` | string | `""` | 自定义机器人 Webhook URL |
| `groupAtMemberMap` | object | `{}` | 昵称 → 手机号映射 |
| `groupAtDefaultMobile` | string | `""` | 出错时默认 @ 的手机号 |
| `groupAtSystemPrompt` | boolean | `true` | 是否自动注入 @ 提示词 |

## 兼容性 / Compatibility

- `groupWebhookUrl` 为空时（默认），行为与 v0.7.x 完全一致
- 所有新功能通过配置项启用，零破坏性变更
- 基于 v0.7.9 开发
