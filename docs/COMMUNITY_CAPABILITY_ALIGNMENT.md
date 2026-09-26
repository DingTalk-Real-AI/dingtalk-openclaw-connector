# 社区能力对齐使用说明

本次实现以官方 `0.8.26`、OpenClaw `2026.8.1` 和社区插件 `3.8.1`（`8a73a59fd8513a89e5f2219adaec61c7c4ceab9a`）为基线。保持现有机器人、bindings 和旧 AI 卡片配置兼容；v2 卡片与实验多助手需显式开启。

## 六项能力

| 能力 | 使用方式 | 边界 |
|---|---|---|
| 引用消息恢复 | 引用当前机器人接收过的消息、已缓存的 AI 卡片；按消息 ID / 卡片 ID 精确查找正文与媒体 | 仅恢复已观察到的消息；缺失、过期或 ID 冲突时不猜测。原回调自带的引用内容仍可用 |
| 文本附件抽取 | 发送 TXT、Markdown、JSON、XML、YAML、CSV、日志及常见代码/HTML/CSS 文件 | UTF-8，文件最多 2 MiB，正文最多 6,000 字符；二进制与无效 UTF-8 不当正文读取。现有 Word/PDF 解析路径保持原有依赖要求 |
| Markdown / v2 AI 卡片 | 群回复设 `groupReplyMode: "markdown"`，或使用 AI 卡片并设 `cardTemplateMode: "v2"` | Markdown 使用钉钉原生消息；v2 使用结构化正文/工具状态/图片 block。旧卡片默认不变 |
| 原生交互表单 | Agent 调用 `dingtalk_ask_user_question` | 发卡后停止当前生成；提交后以新一轮消息续聊。不是持久挂起的工具调用，也不替代宿主操作审批 |
| 多 Agent / 多机器人 | 使用 `accounts` 与宿主 `bindings`；可开启 `experimentalMultiAgent` 显式别名 | 别名只能指向宿主已配置 Agent，默认关闭；多助手按消息中的顺序派发，各自使用对应 Agent 会话 |
| `/btw` / 停止 | 发送 `/btw 问题`；发送 `停止`、`stop`、`/stop`、`esc` | 旁路使用宿主独立快答，直接发 Markdown；停止向实际生成传播 AbortSignal，并进入宿主原生 `/stop` 清理路径 |

## 配置示例

以下为配置片段，合并到现有配置中；凭据继续使用已有 SecretRef 或安全配置方式。

```json
{
  "agents": {
    "entries": { "support": {}, "research": {} }
  },
  "bindings": [
    { "agentId": "support", "match": { "channel": "dingtalk-connector", "accountId": "office" } }
  ],
  "channels": {
    "dingtalk-connector": {
      "accounts": {
        "office": {
          "cardTemplateMode": "v2",
          "cardShowMetadata": true,
          "questionTimeoutMs": 300000,
          "experimentalMultiAgent": {
            "enabled": true,
            "aliases": { "客服": "support", "研究": "research" },
            "maxTargets": 3
          }
        }
      }
    }
  }
}
```

在聊天中发送 `@客服 @研究 请分别评估这个方案`。别名与正文之间用空白分隔，按首次出现顺序去重。普通钉钉用户的 @ 或未配置别名不会被推断成 Agent；先通过原机器人的访问策略与 bindings，再选择管理员允许的目标。单条消息超过 `maxTargets` 会提示并拒绝派发，范围为 1–5。以 `/` 开头的命令只进入第一个选中助手，避免重复重置会话。多机器人继续各用自己的账号凭据和发送目标。

## 卡片与元数据

默认公共 v2 模板为 `675cde2f-f526-40cb-b828-f5b2b57b8b77.schema`；如当前应用无法使用公共模板，将 [v2 模板 JSON](assets/card-template-v2.json) 导入卡片平台，再设置 `cardTemplateId`。需开通应用创建、投放、更新及流式更新卡片的权限。v2 变量为 `blockList`、`content`、`copy_content`、`statusLine`、`flowStatus`。

社区早期称为 `taskInfo` 的元数据，在当前 v2 契约中通过 `statusLine` 呈现。显示本次真实 Agent、模型、耗时与运行状态；token 用量来自公开 `llm_output` 事件，按账号、会话和真实运行 ID 隔离。工具状态来自宿主公开回调，不展示工具参数或模型内部思考。宿主未提供真实 token 统计时不补造数值。`cardShowMetadata: false` 可隐藏元数据。

npm 安装属于外部插件。OpenClaw `2026.8.1` 默认禁止外部插件读取会话 hook，因此显示 token 用量还需管理员在宿主配置显式允许该插件访问会话事件；插件不会自动修改此授权。未开启时正文、工具状态、模型和耗时仍可工作，仅缺少用量统计。本插件的用量缓存只保留数值，不保存 hook 中的 prompt 或回复正文。

```json
{
  "plugins": {
    "entries": {
      "dingtalk-connector": {
        "hooks": { "allowConversationAccess": true }
      }
    }
  }
}
```


已上传的钉钉 `mediaId` 可转原生图片 block；本地图片仅从当前 Agent 工作区允许根目录读取，检查真实路径，拒绝符号链接越界，同一图片上传去重。远端 URL 保留为 Markdown，不主动抓取。创建或流式更新失败会走普通消息降级；停止、失败与完成后不会接受迟到的生成更新。`asyncMode` 沿用原有完整结果主动推送流程；需要 v2 流式体验时使用默认的同步模式。

## 原生表单

默认模板为 `c2a6355b-9724-4f7e-9653-d33fcb3311bb.schema`；可导入 [表单模板 JSON](assets/dingtalk-ask-user-card-template.json)，使用 `questionCardTemplateId` 指定自有模板。插件在同一 Stream 连接订阅卡片回调。

工具支持两种输入，不能同时提供 `questions` 与 `fields`：

```json
{
  "title": "选择实施范围",
  "questions": [
    { "header": "范围", "question": "先上线哪一项？", "options": [
      { "label": "引用恢复", "description": "先补齐消息上下文" },
      { "label": "全部能力", "description": "一次性验证全部路径" }
    ], "multiSelect": false }
  ]
}
```

普通文本题省略 `options`；多选设 `multiSelect: true`；确认题提供“确认/取消”两个单选选项。多字段使用 `fields`，支持文本、数字、日期、时间、开关及选择字段，具体字段名与约束以注册工具的 JSON Schema 为准。

只有原机器人、原会话的提问用户能提交，答案字段经过校验。相同卡片最多恢复一次；转发、伪造表单中的用户 ID、跨账号回调均不能改写执行目标。默认 5 分钟过期，可配置 10 秒至 30 分钟。取消、超时、新普通消息或停止命令会使旧卡失效；`/btw` 保持当前待答问题。重启后不恢复待答执行，旧卡点击显示过期。已接收答案后若又出现新消息，会阻止尚未派发的旧答案续聊。卡片更新失败不会撤销本地终态。

## 旁路与停止

`/btw` 在媒体下载和主回复派发之前分流，不建立 AI 卡片、不持有插件会话锁、不停止主任务。快答读取宿主已有会话上下文，是否可用由宿主决定；没有既有会话、模型不支持或策略不允许时，返回宿主的明确错误。快答延迟仍取决于模型服务。

停止指令直接中止插件保存的相同账号/会话运行句柄，并派发宿主原生 `/stop`。默认群共享会话下，停止作用于该共享会话；需要按用户隔离时使用 `groupSessionScope: "group_sender"`。实验别名路由可用 `@研究 /stop` 停止对应 Agent。已经提交到钉钉的消息或外部工具造成的副作用不能通过取消撤销。引用正文和附件中的停止文字不作为控制命令。

## 引用缓存与验证

引用缓存保存于 OpenClaw 状态目录的 `dingtalk-connector/message-context.json`，按账号和会话隔离，默认 TTL 24 小时、总计 1,000 条、单会话 200 条、磁盘最多 4 MiB。文件以 0600 权限原子写入，读取时拒绝符号链接。只支持同一进程复用同一缓存实例，不作为多进程共享数据库；不要同时运行多个使用同一状态目录的 Gateway。删除该文件可清理历史引用缓存。缓存故障不阻断正常消息；不修改宿主 session 数据。恢复的内容通过宿主引用字段和 `UntrustedContext` 传入，最多三层引用链。

自动化测试覆盖原生卡片请求契约、流式终态、表单校验与回调竞态、缓存隔离与附件限制、多助手路由、旁路并发和生成取消。本 PR 未连接生产机器人，也未完成真实钉钉客户端的视觉和端到端交互验收。上线前应在测试机器人上检查：引用文本/图片/文件；v2 流式与内联图片；表单提交/取消/过期/重复点击；双机器人双 Agent；主任务运行期间 `/btw`；长生成期间停止。测试与构建通过不等同于钉钉权限、模板投放和客户端显示已验证。
