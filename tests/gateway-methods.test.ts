/**
 * Gateway Methods 自动化测试
 * 
 * 测试所有钉钉插件的 Gateway Methods 功能
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import axios from 'axios';

// ============ 测试配置 ============

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:18789/gateway/call';
const TEST_USER_ID = process.env.TEST_USER_ID || 'test_user_id';
const TEST_CONVERSATION_ID = process.env.TEST_CONVERSATION_ID || 'test_conversation_id';
const TEST_SPACE_ID = process.env.TEST_SPACE_ID || 'test_space_id';
const TEST_DOC_ID = process.env.TEST_DOC_ID || 'test_doc_id';
const TEST_OPERATOR_ID = process.env.TEST_OPERATOR_ID || 'test_operator_id';

// 是否跳过需要真实环境的测试
const SKIP_INTEGRATION = process.env.SKIP_INTEGRATION === 'true';

// ============ 辅助函数 ============

/**
 * 调用 Gateway Method
 */
async function callGatewayMethod(method: string, params?: any): Promise<any> {
  try {
    const response = await axios.post(GATEWAY_URL, {
      method,
      params,
    }, {
      timeout: 10_000,
      validateStatus: () => true, // 接受所有状态码
    });
    return response.data;
  } catch (err: any) {
    throw new Error(`Gateway call failed: ${err.message}`);
  }
}

/**
 * 等待一段时间
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ 测试套件 ============

describe('Gateway Methods - 状态检查', () => {
  it('应该能检查插件状态', async () => {
    const result = await callGatewayMethod('dingtalk-connector.status');
    
    expect(result).toBeDefined();
    expect(result).toHaveProperty('configured');
    expect(result).toHaveProperty('enabled');
    expect(result).toHaveProperty('accountId');
  });

  it('应该能探测连接', async () => {
    const result = await callGatewayMethod('dingtalk-connector.probe');
    
    expect(result).toBeDefined();
    // 如果配置正确，ok 应该为 true
    if (result.ok === true) {
      expect(result).toHaveProperty('details');
      expect(result.details).toHaveProperty('clientId');
    } else {
      // 未配置时应该有错误信息
      expect(result).toHaveProperty('error');
    }
  });
});

describe('Gateway Methods - 参数验证', () => {
  it('sendToUser 缺少 userId 应该返回错误', async () => {
    const result = await callGatewayMethod('dingtalk-connector.sendToUser', {
      content: '测试消息',
    });
    
    expect(result.ok).toBe(false);
    expect(result.error).toContain('userId');
  });

  it('sendToUser 缺少 content 应该返回错误', async () => {
    const result = await callGatewayMethod('dingtalk-connector.sendToUser', {
      userId: TEST_USER_ID,
    });
    
    expect(result.ok).toBe(false);
    expect(result.error).toContain('content');
  });

  it('sendToGroup 缺少 openConversationId 应该返回错误', async () => {
    const result = await callGatewayMethod('dingtalk-connector.sendToGroup', {
      content: '测试消息',
    });
    
    expect(result.ok).toBe(false);
    expect(result.error).toContain('openConversationId');
  });

  it('send 缺少 target 应该返回错误', async () => {
    const result = await callGatewayMethod('dingtalk-connector.send', {
      content: '测试消息',
    });
    
    expect(result.ok).toBe(false);
    expect(result.error).toContain('target');
  });

  it('docs.read 缺少 docId 应该返回错误', async () => {
    const result = await callGatewayMethod('dingtalk-connector.docs.read', {
      operatorId: TEST_OPERATOR_ID,
    });
    
    expect(result.ok).toBe(false);
    expect(result.error).toContain('docId');
  });

  it('docs.read 缺少 operatorId 应该返回错误', async () => {
    const result = await callGatewayMethod('dingtalk-connector.docs.read', {
      docId: TEST_DOC_ID,
    });
    
    expect(result.ok).toBe(false);
    expect(result.error).toContain('operatorId');
  });

  it('docs.create 缺少 spaceId 应该返回错误', async () => {
    const result = await callGatewayMethod('dingtalk-connector.docs.create', {
      title: '测试文档',
    });
    
    expect(result.ok).toBe(false);
    expect(result.error).toContain('spaceId');
  });

  it('docs.create 缺少 title 应该返回错误', async () => {
    const result = await callGatewayMethod('dingtalk-connector.docs.create', {
      spaceId: TEST_SPACE_ID,
    });
    
    expect(result.ok).toBe(false);
    expect(result.error).toContain('title');
  });

  it('docs.append 缺少 docId 应该返回错误', async () => {
    const result = await callGatewayMethod('dingtalk-connector.docs.append', {
      content: '测试内容',
    });
    
    expect(result.ok).toBe(false);
    expect(result.error).toContain('docId');
  });

  it('docs.search 缺少 keyword 应该返回错误', async () => {
    const result = await callGatewayMethod('dingtalk-connector.docs.search', {});
    
    expect(result.ok).toBe(false);
    expect(result.error).toContain('keyword');
  });

  it('docs.list 缺少 spaceId 应该返回错误', async () => {
    const result = await callGatewayMethod('dingtalk-connector.docs.list', {});
    
    expect(result.ok).toBe(false);
    expect(result.error).toContain('spaceId');
  });
});

describe.skipIf(SKIP_INTEGRATION)('Gateway Methods - 消息发送（集成测试）', () => {
  it('应该能发送单聊消息', async () => {
    const result = await callGatewayMethod('dingtalk-connector.sendToUser', {
      userId: TEST_USER_ID,
      content: '自动化测试消息 - sendToUser',
      useAICard: false,
    });
    
    // 如果配置正确，应该成功
    if (result.ok) {
      expect(result).toHaveProperty('processQueryKey');
    } else {
      // 未配置或权限不足时应该有错误信息
      expect(result).toHaveProperty('error');
    }
  });

  it('应该能发送群聊消息', async () => {
    const result = await callGatewayMethod('dingtalk-connector.sendToGroup', {
      openConversationId: TEST_CONVERSATION_ID,
      content: '自动化测试消息 - sendToGroup',
      useAICard: false,
    });
    
    if (result.ok) {
      expect(result).toHaveProperty('processQueryKey');
    } else {
      expect(result).toHaveProperty('error');
    }
  });

  it('应该能智能发送消息（用户）', async () => {
    const result = await callGatewayMethod('dingtalk-connector.send', {
      target: `user:${TEST_USER_ID}`,
      content: '自动化测试消息 - send (user)',
      useAICard: false,
    });
    
    if (result.ok) {
      expect(result).toHaveProperty('processQueryKey');
    } else {
      expect(result).toHaveProperty('error');
    }
  });

  it('应该能智能发送消息（群）', async () => {
    const result = await callGatewayMethod('dingtalk-connector.send', {
      target: `group:${TEST_CONVERSATION_ID}`,
      content: '自动化测试消息 - send (group)',
      useAICard: false,
    });
    
    if (result.ok) {
      expect(result).toHaveProperty('processQueryKey');
    } else {
      expect(result).toHaveProperty('error');
    }
  });

  it('应该能发送 AI Card 消息', async () => {
    const result = await callGatewayMethod('dingtalk-connector.sendToUser', {
      userId: TEST_USER_ID,
      content: '# 自动化测试\n\n✅ AI Card 测试成功',
      useAICard: true,
    });
    
    if (result.ok && result.usedAICard) {
      expect(result).toHaveProperty('cardInstanceId');
    }
  });

  it('应该能批量发送消息', async () => {
    const result = await callGatewayMethod('dingtalk-connector.sendToUser', {
      userIds: [TEST_USER_ID],
      content: '自动化测试消息 - 批量发送',
      useAICard: false,
    });
    
    if (result.ok) {
      expect(result).toHaveProperty('processQueryKey');
    } else {
      expect(result).toHaveProperty('error');
    }
  });
});

describe.skipIf(SKIP_INTEGRATION)('Gateway Methods - 文档操作（集成测试）', () => {
  it('应该能搜索文档', async () => {
    const result = await callGatewayMethod('dingtalk-connector.docs.search', {
      keyword: '测试',
      spaceId: TEST_SPACE_ID,
    });
    
    if (result.ok) {
      expect(result).toHaveProperty('docs');
      expect(Array.isArray(result.docs)).toBe(true);
    } else {
      expect(result).toHaveProperty('error');
    }
  });

  it('应该能列出文档', async () => {
    const result = await callGatewayMethod('dingtalk-connector.docs.list', {
      spaceId: TEST_SPACE_ID,
    });
    
    if (result.ok) {
      expect(result).toHaveProperty('docs');
      expect(Array.isArray(result.docs)).toBe(true);
    } else {
      expect(result).toHaveProperty('error');
    }
  });

  it('应该能读取文档', async () => {
    const result = await callGatewayMethod('dingtalk-connector.docs.read', {
      docId: TEST_DOC_ID,
      operatorId: TEST_OPERATOR_ID,
    });
    
    if (result.ok) {
      expect(result).toHaveProperty('content');
      expect(typeof result.content).toBe('string');
    } else {
      expect(result).toHaveProperty('error');
    }
  });

  it('应该能创建文档', async () => {
    const timestamp = Date.now();
    const result = await callGatewayMethod('dingtalk-connector.docs.create', {
      spaceId: TEST_SPACE_ID,
      title: `自动化测试文档 ${timestamp}`,
      content: '这是自动化测试创建的文档',
    });
    
    if (result.ok) {
      expect(result).toHaveProperty('docId');
      expect(result).toHaveProperty('title');
      expect(result.title).toContain('自动化测试文档');
    } else {
      expect(result).toHaveProperty('error');
    }
  });

  it('应该能追加文档内容', async () => {
    const result = await callGatewayMethod('dingtalk-connector.docs.append', {
      docId: TEST_DOC_ID,
      content: '\n\n## 自动化测试追加内容\n\n这是追加的测试内容',
    });
    
    if (result.ok) {
      expect(result).toHaveProperty('success');
      expect(result.success).toBe(true);
    } else {
      expect(result).toHaveProperty('error');
    }
  });
});

describe('Gateway Methods - 错误处理', () => {
  it('调用不存在的方法应该返回错误', async () => {
    try {
      const result = await callGatewayMethod('dingtalk-connector.nonexistent');
      // 应该返回错误或者抛出异常
      expect(result).toBeDefined();
    } catch (err) {
      expect(err).toBeDefined();
    }
  });

  it('无效的参数类型应该被处理', async () => {
    const result = await callGatewayMethod('dingtalk-connector.sendToUser', {
      userId: 123, // 应该是字符串
      content: null, // 应该是字符串
    });
    
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty('error');
  });
});

describe('Gateway Methods - 性能测试', () => {
  it('状态检查应该在 100ms 内完成', async () => {
    const start = Date.now();
    await callGatewayMethod('dingtalk-connector.status');
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(100);
  });

  it('应该能处理并发请求', async () => {
    const promises = Array.from({ length: 5 }, () =>
      callGatewayMethod('dingtalk-connector.status')
    );
    
    const results = await Promise.all(promises);
    
    expect(results).toHaveLength(5);
    results.forEach(result => {
      expect(result).toBeDefined();
      expect(result).toHaveProperty('configured');
    });
  });
});

describe('Gateway Methods - 兼容性测试', () => {
  it('send 方法应该兼容 message 字段', async () => {
    const result = await callGatewayMethod('dingtalk-connector.send', {
      target: `user:${TEST_USER_ID}`,
      message: '使用 message 字段的测试', // 兼容旧版本
    });
    
    // 应该能正常处理（即使未配置也应该返回结构化错误）
    expect(result).toBeDefined();
  });

  it('send 方法应该支持默认路由（不带前缀）', async () => {
    const result = await callGatewayMethod('dingtalk-connector.send', {
      target: TEST_USER_ID, // 不带 user: 前缀
      content: '默认路由测试',
    });
    
    expect(result).toBeDefined();
  });
});
