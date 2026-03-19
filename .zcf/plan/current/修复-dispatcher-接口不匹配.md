# 修复 dispatcher 接口不匹配 - 执行计划

**创建时间**：2026-03-19 16:08:31

**分支**：`feature/standard-command-support`

---

## 问题描述

调用 OpenClaw SDK 的 `rt.channel.reply.withReplyDispatcher()` 时出现错误：
```
SDK 命令处理失败: params.dispatcher.markComplete is not a function
```

**根本原因**：手动创建的 dispatcher 函数不符合 SDK 期望的 ReplyDispatcher 接口。SDK 期望 dispatcher 对象包含 6 个方法：sendToolResult、sendBlockReply、sendFinalReply、waitForIdle、getQueuedCounts、markComplete。

---

## 解决方案

使用 OpenClaw SDK 提供的工厂函数 `rt.channel.reply.createReplyDispatcherWithTyping()` 创建标准 dispatcher，并使用 `rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher()` 进行消息分发。

---

## 执行步骤

### 步骤 1：修改 `createDingtalkReplyDispatcher` 函数
- **位置**：plugin.ts 第 1530-1637 行
- **改动**：使用 `rt.channel.reply.createReplyDispatcherWithTyping()` 工厂函数
- **代码量**：约 80 行修改

### 步骤 2：修改 `handleDingTalkMessage` 函数
- **位置**：plugin.ts 第 3022-3122 行
- **改动**：使用 `dispatchReplyWithBufferedBlockDispatcher()` 替代 `withReplyDispatcher()`
- **代码量**：约 30 行修改

### 步骤 3：添加必要的类型导入
- **位置**：plugin.ts 顶部
- **改动**：导入 ReplyPayload、ReplyDispatchKind 等类型
- **代码量**：约 5 行修改

### 步骤 4：编译检查
- 运行 `npm run type-check` 确保无类型错误

### 步骤 5：测试验证
- 测试 `/new` 命令
- 验证其他系统命令

---

## 预期结果

- ✅ 系统命令（`/new`、`/status`、`/usage`、`/compact`、`/help`）正常工作
- ✅ AI Card 流式响应正常
- ✅ Markdown 回复正常
- ✅ 异步模式支持
- ✅ 无 dispatcher 接口错误

---

## 风险评估

- **异步模式兼容性**：保留异步模式缓存逻辑
- **AI Card 状态管理**：确保 AI Card 实例在 dispatcher 生命周期内有效
- **回退机制**：保留 try-catch，失败时回退到原有流程

---

## 执行状态

- [x] 步骤 1：修改 createDingtalkReplyDispatcher
- [x] 步骤 2：修改 handleDingTalkMessage
- [x] 步骤 3：添加类型导入
- [x] 步骤 4：编译检查（项目使用 jiti，无需编译）
- [ ] 步骤 5：测试验证

---

## 执行摘要

### 已完成的修改

1. **类型导入**（plugin.ts:13-20）
   - 添加 `ReplyPayload` 类型导入
   - 移除不再使用的 `ReplyDispatcher` 导入

2. **简化 createDingtalkReplyDispatcher 函数**（plugin.ts:1545-1620）
   - 移除 SDK 工厂函数调用
   - 直接返回 `deliver` 函数
   - 保持异步模式和 AI Card 支持
   - 返回类型简化为 `{ deliver, markDispatchIdle, getAsyncModeResponse }`

3. **修改 handleDingTalkMessage 调用**（plugin.ts:3043-3079）
   - 使用 `dispatchReplyWithBufferedBlockDispatcher`
   - 直接传递 `deliver` 函数作为 `dispatcherOptions.deliver`
   - 添加 `onIdle` 和 `onError` 回调

4. **类型修复**
   - 修复 `sessionWebhook` 可能为 undefined 的问题
   - 修复 `asyncResponse` 可能为 null 的问题

---

**最后更新**：2026-03-19 16:15:00
