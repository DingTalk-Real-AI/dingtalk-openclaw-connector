# 重构计划文档

## 概述

本分支用于将 `plugin.ts` (3619行) 进行模块化拆分，参考飞书和 MS Teams Channel 的模块结构，将单文件实现拆分为多个职责清晰的模块文件。

## 重构目标

1. **模块化拆分**：将单文件拆分为多个模块，每个模块职责单一
2. **代码质量**：每个模块文件控制在 700 LOC 以内
3. **类型安全**：移除所有 any 类型，使用完整类型定义
4. **测试覆盖**：为每个模块添加单元测试，覆盖率目标 70%
5. **保持兼容**：**重要** - 代码逻辑完全不变，仅进行结构重组

## 模块结构规划

参考 MS Teams Channel (11个模块) 和飞书 Channel (17个模块) 的结构：

```
src/
├── types.ts          ✅ 类型定义（已完成）
├── constants.ts      ✅ 常量定义（已完成）
├── config.ts         ✅ 配置管理（已完成）
├── token.ts          ✅ Token 管理（已完成）
├── session.ts       ✅ Session 管理（已完成）
├── message.ts       ✅ 消息处理（已完成）
├── media.ts         ⏳ 媒体文件处理（待完成）
├── send.ts          ⏳ 消息发送功能（待完成）
├── ai-card.ts       ⏳ AI Card 相关功能（待完成）
├── gateway.ts        ⏳ Gateway 集成（待完成）
├── docs.ts           ⏳ 钉钉文档 API（待完成）
├── accounts.ts       ⏳ 账户管理（待完成）
├── policy.ts         ⏳ 策略控制（待完成）
├── errors.ts         ⏳ 错误处理（待完成）
├── probe.ts          ⏳ 连接探测（待完成）
├── channel.ts        ⏳ Channel 定义（待完成）
├── bot.ts            ⏳ Bot 核心逻辑（待完成）
└── runtime.ts        ⏳ Runtime 管理（待完成）

index.ts              ⏳ 插件入口（待完成）
```

## 已完成模块

- ✅ `src/types.ts` - 所有类型定义
- ✅ `src/constants.ts` - 常量定义
- ✅ `src/config.ts` - 配置管理
- ✅ `src/token.ts` - Token 管理
- ✅ `src/session.ts` - Session 管理
- ✅ `src/message.ts` - 消息内容提取

## 测试配置

- ✅ `vitest.config.ts` - Vitest 测试配置
- ✅ `tests/session.test.ts` - Session 模块测试示例
- ✅ `.github/workflows/ci.yml` - CI/CD 配置

## 下一步工作

1. 继续创建剩余模块（media.ts, send.ts, ai-card.ts 等）
2. 创建 `index.ts` 作为插件入口，整合所有模块
3. 更新 `package.json` 的 main 字段指向新的入口文件
4. 确保所有模块导出正确，保持向后兼容
5. 添加更多单元测试

## 注意事项

⚠️ **重要**：本次重构**不改变任何代码逻辑**，仅进行代码结构重组。所有功能必须保持完全一致。

## 参考

- MS Teams Channel: `extensions/msteams/` (11个模块)
- 飞书 Channel: `extensions/feishu/` (17个模块)
