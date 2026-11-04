# 同进程 A2UI 插件桥

`@dingtalk-connector/a2ui-bridge` 是可选的同进程扩展能力，供业务插件以当前 DingTalk Connector 机器人身份创建、更新 A2UI AI Card，并接收现有 Stream 连接上的卡片事件。Connector 仍独占应用凭据、目标解析、卡片生命周期和 Stream ACK；插件不另建 Stream 连接。

## 获取能力

```ts
const bridge = (globalThis as any)[Symbol.for("@dingtalk-connector/a2ui-bridge")];
```

不存在时代表当前 Connector 不提供该功能。插件应停止 A2UI 投递路径，不能退化成 Markdown 或另一身份发送。

## 方法

- `getCurrentContext(toolContext)` 从 Connector 的当前活跃私聊路由解析身份。返回对象由该桥签名（对象身份绑定），不可自行构造；其 `isCurrent()` 用来阻止过期 agent turn 投递。插件使用此结果判断工具是否可见。
- `createCurrentCard({ context, outTrackId, summary, messages })` 接受刚由该桥生成的 context，使用原机器人应用身份投递 A2UI。消息为有序的 A2UI 1.0 JSON 对象数组。结果明确区分 `accepted`、`failed`、`unknown`；`accepted` 包含服务端卡实例 ID，但不表示客户端已显示。
- `updateCard({ cardInstanceId, outTrackId, outUpdateId, status, messages })` 要求目标卡 ID 与 Connector 的创建记录匹配，并串行发送非空增量；不会重新创建或重放创建快照。`PROCESSING`、`FINISH`、`FAIL` 状态保留钉钉 AI Card 协议值。
- `onCardAction(handler)` 订阅本 Connector 现有 `TOPIC_CARD` listener。事件携带 Stream 账号/消息 ID、平台事件中的用户/outTrackId，以及 Connector 按已发送卡映射补充的卡实例 ID和可信私聊上下文。回调数据本身仍是非可信输入，插件必须自行验证目标映射、用户、nonce、revision、TTL、动作白名单和幂等性。

插件回调应快速返回自己的接收状态；长业务操作由插件单独调度，随后通过同一 `cardInstanceId` 更新结果。客户端可见、用户点击、业务操作成功、写后回读分别核验。

## 限制

当前实现将 A2UI 卡实例映射保存在进程内，TTL 为 30 分钟、最多 1000 张；Gateway 重启后不恢复活动回调映射。业务插件应另外持久化自身 outTrackId/卡 ID、nonce、revision、状态和审计，并对重启前迟到的回调拒绝执行。现有 Markdown Card Bridge、Gateway Markdown 方法和普通回复不变。
