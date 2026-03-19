# Gateway Methods 自动化测试

完整的自动化测试套件，用于验证钉钉插件的所有 Gateway Methods 功能。

## 📋 测试覆盖

### 1. 状态检查测试
- ✅ 插件状态检查
- ✅ 连接探测

### 2. 参数验证测试
- ✅ 所有方法的必需参数验证
- ✅ 参数类型验证
- ✅ 错误消息验证

### 3. 消息发送测试（集成）
- ✅ 单聊消息发送
- ✅ 群聊消息发送
- ✅ 智能路由发送
- ✅ AI Card 消息
- ✅ 批量发送

### 4. 文档操作测试（集成）
- ✅ 文档搜索
- ✅ 文档列表
- ✅ 文档读取
- ✅ 文档创建
- ✅ 文档追加

### 5. 错误处理测试
- ✅ 不存在的方法
- ✅ 无效参数类型

### 6. 性能测试
- ✅ 响应时间测试
- ✅ 并发请求测试

### 7. 兼容性测试
- ✅ 旧版本参数兼容
- ✅ 默认路由测试

## 🚀 快速开始

### 1. 安装依赖

```bash
npm install --save-dev vitest @vitest/ui
```

### 2. 配置测试环境

复制环境变量模板：
```bash
cp .env.test.example .env.test
```

编辑 `.env.test` 填入真实值：
```bash
# 必填：Gateway URL
GATEWAY_URL=http://localhost:18789/gateway/call

# 可选：集成测试参数（如果要运行集成测试）
TEST_USER_ID=your_user_id
TEST_CONVERSATION_ID=your_conversation_id
TEST_SPACE_ID=your_space_id
TEST_DOC_ID=your_doc_id
TEST_OPERATOR_ID=your_operator_id

# 是否跳过集成测试
SKIP_INTEGRATION=false
```

### 3. 启动 OpenClaw Gateway

```bash
openclaw gateway start
```

### 4. 运行测试

```bash
# 运行所有测试
npm test

# 运行测试并生成覆盖率报告
npm run test:coverage

# 监听模式（开发时使用）
npm run test:watch

# 使用 UI 界面
npm run test:ui
```

## 📊 测试模式

### 单元测试模式（默认）

只测试参数验证和错误处理，不需要真实的钉钉环境：

```bash
SKIP_INTEGRATION=true npm test
```

**优点**：
- ✅ 快速执行（< 1秒）
- ✅ 不需要配置钉钉环境
- ✅ 适合 CI/CD 流水线

**覆盖**：
- 参数验证
- 错误处理
- 状态检查
- 性能测试

### 集成测试模式

测试真实的钉钉 API 调用：

```bash
SKIP_INTEGRATION=false npm test
```

**要求**：
- ✅ OpenClaw Gateway 正在运行
- ✅ 钉钉插件已配置
- ✅ 测试环境变量已设置

**覆盖**：
- 所有单元测试
- 消息发送功能
- 文档操作功能

## 🔧 CI/CD 集成

### GitHub Actions 示例

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run unit tests
        run: SKIP_INTEGRATION=true npm test
        
      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json
```

### GitLab CI 示例

```yaml
test:
  stage: test
  image: node:20
  script:
    - npm ci
    - SKIP_INTEGRATION=true npm test
  coverage: '/All files[^|]*\|[^|]*\s+([\d\.]+)/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura-coverage.xml
```

## 📈 测试报告

### 生成 HTML 报告

```bash
npm run test:coverage
```

报告位置：`coverage/index.html`

### 查看测试 UI

```bash
npm run test:ui
```

浏览器访问：`http://localhost:51204/__vitest__/`

## 🐛 故障排查

### 问题 1：Gateway 连接失败

**错误**：
```
Error: connect ECONNREFUSED 127.0.0.1:18789
```

**解决**：
```bash
# 确保 Gateway 正在运行
openclaw gateway start

# 检查端口
lsof -i :18789
```

### 问题 2：测试超时

**错误**：
```
Test timed out in 30000ms
```

**解决**：
```bash
# 增加超时时间（在 vitest.config.ts 中）
testTimeout: 60000
```

### 问题 3：集成测试失败

**错误**：
```
DingTalk not configured
```

**解决**：
```bash
# 1. 检查配置
cat ~/.openclaw/openclaw.json

# 2. 或者跳过集成测试
SKIP_INTEGRATION=true npm test
```

## 📝 编写新测试

### 添加新的测试用例

```typescript
import { describe, it, expect } from 'vitest';
import { callGatewayMethod } from './gateway-methods.test';

describe('我的新功能', () => {
  it('应该能做某事', async () => {
    const result = await callGatewayMethod('dingtalk-connector.myMethod', {
      param1: 'value1',
    });
    
    expect(result.ok).toBe(true);
    expect(result).toHaveProperty('data');
  });
});
```

### 添加 Mock 测试

```typescript
import { vi } from 'vitest';

it('应该能处理 API 错误', async () => {
  // Mock axios
  vi.mock('axios', () => ({
    default: {
      post: vi.fn().mockRejectedValue(new Error('Network error')),
    },
  }));
  
  const result = await callGatewayMethod('dingtalk-connector.status');
  expect(result).toBeDefined();
});
```

## 🎯 最佳实践

1. **测试隔离**：每个测试应该独立，不依赖其他测试的结果
2. **清理资源**：集成测试后清理创建的测试数据
3. **使用 Mock**：对外部依赖使用 Mock，提高测试速度
4. **描述清晰**：测试名称应该清楚描述测试内容
5. **断言明确**：使用具体的断言，避免过于宽泛的检查

## 📚 参考资料

- [Vitest 文档](https://vitest.dev/)
- [测试最佳实践](https://github.com/goldbergyoni/javascript-testing-best-practices)
- [Gateway Methods 手册](../GATEWAY_METHODS_TEST.md)
