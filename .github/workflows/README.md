# GitHub Actions 工作流说明

本项目包含多个 GitHub Actions 工作流，每个工作流负责不同的自动化任务。

## 工作流概览

### 1. 🧪 Test and Lint (`test-and-lint.yml`)

**用途**: 通用的代码质量检查工作流

**触发时机**:
- 推送到 `main` 分支
- 推送到 `refactor/**` 分支
- 创建/更新 Pull Request 到 `main` 分支

**执行内容**:
- ✅ **类型检查** (`npm run type-check`)
- ✅ **单元测试** (`npm test`) - 支持 Node.js 18.x 和 20.x
- ✅ **代码覆盖率** (`npm run test:coverage`)
- ✅ **代码检查** (`npm run lint`)

**特点**:
- 矩阵测试：在多个 Node.js 版本上运行
- 自动缓存依赖，提高执行速度
- 测试失败不会阻止工作流完成（使用 `|| true`）

**使用场景**:
- 每次代码提交时自动运行
- PR 创建时自动验证代码质量
- 确保代码符合质量标准

---

### 2. 🤖 AI Fix and Test (`ai-fix-and-test.yml`)

**用途**: AI 自动修复 Issue 并测试

**触发时机**:
- Issue 被标记为 `ai-fix` 标签
- 手动触发（workflow_dispatch），指定 Issue 编号

**执行内容**:
1. 📋 检查触发条件（Issue 标签或手动触发）
2. 🌿 创建修复分支（格式：`ai-fix/issue-{number}-{title}`）
3. 🤖 AI 分析 Issue 并生成修复代码
   - 支持 OpenAI API
   - 支持 Anthropic API
   - 支持阿里云百炼 Qwen3.5 Plus API
4. 🔍 运行代码检查、类型检查、单元测试
5. 📝 提交修复结果到分支
6. 🔀 创建 Pull Request
7. 📢 发送测试结果到钉钉群
8. 💬 更新 Issue 评论

**特点**:
- 支持本地模式和 GitHub 模式
- 自动创建修复分支和 PR
- 集成 AI 代码修复能力
- 完整的测试和通知流程

**使用场景**:
- Issue 需要 AI 自动修复时
- 需要快速生成修复代码时
- 自动化 Issue 处理流程

**使用方法**:
```bash
# 方法1: 给 Issue 添加 'ai-fix' 标签
# 方法2: 手动触发工作流，输入 Issue 编号
```

---

### 3. 🔔 Issue Notification (`issue-to-dingtalk.yml`)

**用途**: 将 GitHub Issue 事件同步到钉钉群

**触发时机**:
- Issue 创建 (`opened`)
- Issue 重新打开 (`reopened`)
- Issue 关闭 (`closed`)
- Issue 被标记 (`labeled`)
- Issue 有新评论 (`issue_comment.created`)

**执行内容**:
- 📬 发送 Issue 信息到钉钉群
- 📝 包含 Issue 标题、内容、链接

**特点**:
- 实时同步 Issue 状态
- Markdown 格式消息
- 自动截断过长内容（500字符）

**使用场景**:
- 团队协作时及时通知
- 跟踪 Issue 状态变化
- 保持团队信息同步

**配置要求**:
- 需要配置 `DINGTALK_WEBHOOK` Secret

---

### 4. 👀 PR Review (`pr-review.yml`)

**用途**: PR 审核流程的钉钉通知

**触发时机**:
- PR 创建 (`opened`)
- PR 重新打开 (`reopened`)
- PR 准备审核 (`ready_for_review`)
- PR 审核完成 (`pull_request_review.submitted`)

**执行内容**:
1. 📢 PR 创建时发送审核提醒
2. ✅ PR 审核完成时发送结果通知
3. 🎉 PR 审核通过时提醒可以合并

**特点**:
- 自动检测审核状态
- 支持审核通过/需要修改/已评论三种状态
- 自动合并检查（需要至少 1 个 approval）

**使用场景**:
- PR 审核流程管理
- 团队协作通知
- 自动化审核提醒

**配置要求**:
- 需要配置 `DINGTALK_WEBHOOK` Secret

---

## 工作流关系图

```
代码提交/PR
    ↓
[Test and Lint] ──→ 代码质量检查
    ↓
    ├─→ 通过 → 可以合并
    └─→ 失败 → 需要修复

Issue 创建
    ↓
[Issue Notification] ──→ 钉钉通知
    ↓
添加 'ai-fix' 标签
    ↓
[AI Fix and Test] ──→ AI 修复 + 测试
    ↓
创建 PR
    ↓
[PR Review] ──→ 审核提醒
    ↓
审核通过
    ↓
[PR Review] ──→ 可以合并通知
```

## 工作流对比

| 工作流 | 触发方式 | 主要功能 | 通知方式 |
|--------|---------|---------|---------|
| **Test and Lint** | Push/PR | 代码质量检查 | GitHub Actions 日志 |
| **AI Fix and Test** | Issue 标签/手动 | AI 修复 + 测试 | 钉钉 + Issue 评论 |
| **Issue Notification** | Issue 事件 | Issue 同步 | 钉钉 |
| **PR Review** | PR 事件 | PR 审核提醒 | 钉钉 |

## 使用建议

### 日常开发流程

1. **提交代码** → `test-and-lint.yml` 自动运行
2. **创建 PR** → `test-and-lint.yml` 验证代码质量
3. **PR 创建** → `pr-review.yml` 发送审核提醒到钉钉
4. **审核完成** → `pr-review.yml` 发送结果通知

### Issue 处理流程

1. **创建 Issue** → `issue-to-dingtalk.yml` 发送到钉钉
2. **需要 AI 修复** → 添加 `ai-fix` 标签 → `ai-fix-and-test.yml` 自动修复
3. **AI 修复完成** → 自动创建 PR → `pr-review.yml` 发送审核提醒

### 配置要求

所有工作流都需要以下配置：

```yaml
# Repository Secrets
DINGTALK_WEBHOOK: https://oapi.dingtalk.com/robot/send?access_token=...
GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}  # 自动提供

# AI Fix 工作流额外需要（可选）
OPENAI_API_KEY: sk-...
ANTHROPIC_API_KEY: sk-ant-...
DASHSCOPE_API_KEY: sk-...
```

## 注意事项

1. **Test and Lint** 是基础工作流，每次代码变更都会运行
2. **AI Fix and Test** 是特殊工作流，只在需要时触发
3. **Issue/PR Notification** 是通知类工作流，不影响代码质量
4. 所有工作流可以并行运行，互不干扰
5. 钉钉通知工作流需要配置 Webhook Secret

## 最佳实践

1. ✅ 保持 `test-and-lint.yml` 始终启用，确保代码质量
2. ✅ 在 Issue 需要快速修复时使用 `ai-fix-and-test.yml`
3. ✅ 配置钉钉通知，保持团队信息同步
4. ✅ 定期检查工作流执行情况，优化配置
5. ✅ 根据项目需要调整触发条件和执行内容
