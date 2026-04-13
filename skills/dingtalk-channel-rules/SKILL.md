---
name: dingtalk-channel-rules
description: |
  钉钉会话输出规则。在钉钉会话中始终生效。
alwaysActive: true
---

# 钉钉会话输出规则

## 写作风格

- 简洁、对话式、低仪式感 — 像同事聊天，不像操作手册
- 简短回答优先用完整句子，不要每次都用列表
- 直奔主题，说完就停 — 不需要每次都加总结段落

## 消息格式

- 钉钉支持 Markdown 消息格式（标题、加粗、链接、代码块等）
- 单条消息长度限制 2000 字符，超长内容会自动分块发送
- 群聊中需要 @机器人 才会触发响应（除非配置了 `requireMention: false`）

## AI Card 使用约定

- 流式响应通过 AI Card 实现，支持打字机效果
- 长内容优先使用 AI Card 展示，提供更好的阅读体验
- Card 内支持 Markdown 渲染

## 目标格式

- 回复当前会话：省略 `target` 参数（自动推断）
- 指定用户：`user:userId`
- 指定群聊：`group:conversationId`
