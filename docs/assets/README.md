# 原生交互表单模板

`dingtalk-ask-user-card-template.json` 原样取自 [soimy/openclaw-channel-dingtalk](https://github.com/soimy/openclaw-channel-dingtalk/blob/8a73a59fd8513a89e5f2219adaec61c7c4ceab9a/docs/assets/dingtalk-ask-user-card-template.json)，提交 `8a73a59fd8513a89e5f2219adaec61c7c4ceab9a`，作者为 YM Shen and contributors，采用 MIT 许可；版权和许可全文见仓库第三方声明。

默认公共模板 ID：`c2a6355b-9724-4f7e-9653-d33fcb3311bb.schema`。也可将此 JSON 导入钉钉卡片平台，在机器人配置中设置 `questionCardTemplateId`。模板能否被当前应用使用，取决于卡片平台授权；配置模板不会自动申请权限。

变量契约：`question_id`、`question_title`、`question_desc`、`card_status`、`form_btn_text`、`selected_text`、`selected_values`、`form`。其中 `form` 是 `{ "fields": [...] }`；提交回调使用 `cardPrivateData.actionIds[0]` 携带 `question_id`，`cardPrivateData.params.form` 携带字段值，取消使用 `user_cancel`。`card_status != pending` 隐藏表单。

应用需要卡片创建/投放/更新权限，并订阅 Stream 卡片回调。表单仅允许当前会话的发起人通过原机器人填写；不支持转发。默认 5 分钟过期，`questionTimeoutMs` 可配置 10 秒至 30 分钟。新消息会令同一会话内待答表单失效。运行状态只保存在当前进程；重启后不恢复执行，点击旧卡会显示过期。支持表单组件的钉钉客户端才能渲染原生字段，模板包含旧客户端不支持的提示。

## v2 流式卡片模板

`card-template-v2.json` 原样取自同一社区固定提交下的 `docs/assets/card-template-v2.json`，MIT 版权与许可见 [第三方声明](../../THIRD_PARTY_NOTICES.md)。默认 ID 为 `675cde2f-f526-40cb-b828-f5b2b57b8b77.schema`；导入自有模板后设置 `cardTemplateMode: "v2"` 与 `cardTemplateId`。保持 `blockList/content/copy_content/statusLine/flowStatus` 变量契约。
