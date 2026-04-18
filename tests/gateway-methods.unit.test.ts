/**
 * Gateway Methods 单元测试
 * 
 * 直接测试 Gateway Methods 的注册和业务逻辑
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { registerGatewayMethods } from '../src/gateway-methods';

// ============ Mock 数据 ============

const mockConfig = {
  channels: {
    'dingtalk-connector': {
      enabled: true,
      clientId: 'test_client_id',
      clientSecret: 'test_client_secret',
    },
  },
};

const mockLogger = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
};

// ============ 辅助函数 ============

/**
 * 创建 Mock API
 */
function createMockApi() {
  const handlers = new Map<string, Function>();
  
  const api: Partial<OpenClawPluginApi> = {
    logger: mockLogger,
    config: mockConfig as any,
    registerGatewayMethod: vi.fn((name: string, handler: Function) => {
      handlers.set(name, handler);
    }),
  };

  return {
    api: api as OpenClawPluginApi,
    handlers,
    callMethod: async (name: string, params: any = {}) => {
      const handler = handlers.get(name);
      if (!handler) {
        throw new Error(`Method ${name} not registered`);
      }

      let result: any;
      let ok: boolean | undefined;
      let error: any;

      const respond = (success: boolean, payload?: any, err?: any) => {
        ok = success;
        result = payload;
        error = err;
      };

      const context = {
        deps: {},
      };

      await handler({ context, params, respond });

      return { ok, result, error };
    },
  };
}

// ============ 测试套件 ============

describe('Gateway Methods - 注册', () => {
  it('应该注册所有方法', () => {
    const { api, handlers } = createMockApi();
    registerGatewayMethods(api);

    // 验证所有方法都已注册
    expect(handlers.has('dingtalk-connector.sendToUser')).toBe(true);
    expect(handlers.has('dingtalk-connector.sendToGroup')).toBe(true);
    expect(handlers.has('dingtalk-connector.send')).toBe(true);
    expect(handlers.has('dingtalk-connector.docs.read')).toBe(true);
    expect(handlers.has('dingtalk-connector.docs.create')).toBe(true);
    expect(handlers.has('dingtalk-connector.docs.append')).toBe(true);
    expect(handlers.has('dingtalk-connector.docs.search')).toBe(true);
    expect(handlers.has('dingtalk-connector.docs.list')).toBe(true);
    expect(handlers.has('dingtalk-connector.status')).toBe(true);
    expect(handlers.has('dingtalk-connector.probe')).toBe(true);

    // 验证注册了 10 个方法
    expect(handlers.size).toBe(10);
  });
});

describe('Gateway Methods - 参数验证', () => {
  let mockApi: ReturnType<typeof createMockApi>;

  beforeEach(() => {
    mockApi = createMockApi();
    registerGatewayMethods(mockApi.api);
  });

  it('sendToUser 缺少 userId 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.sendToUser', {
      content: '测试消息',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('userId');
  });

  it('sendToUser 缺少 content 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.sendToUser', {
      userId: 'test_user',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('content');
  });

  it('sendToGroup 缺少 openConversationId 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.sendToGroup', {
      content: '测试消息',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('openConversationId');
  });

  it('sendToGroup 缺少 content 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.sendToGroup', {
      openConversationId: 'test_cid',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('content');
  });

  it('send 缺少 target 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.send', {
      content: '测试消息',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('target');
  });

  it('send 缺少 content 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.send', {
      target: 'user:test_user',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('content');
  });

  it('docs.read 缺少 docId 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.docs.read', {
      operatorId: 'test_operator',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('docId');
  });

  it('docs.read 缺少 operatorId 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.docs.read', {
      docId: 'test_doc',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('operatorId');
  });

  it('docs.create 缺少 spaceId 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.docs.create', {
      title: '测试文档',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('spaceId');
  });

  it('docs.create 缺少 title 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.docs.create', {
      spaceId: 'test_space',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('title');
  });

  it('docs.append 缺少 docId 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.docs.append', {
      content: '测试内容',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('docId');
  });

  it('docs.append 缺少 content 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.docs.append', {
      docId: 'test_doc',
    });

    expect(ok).toBe(false);
    expect(result?.error).toContain('content');
  });

  it('docs.search 缺少 keyword 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.docs.search', {});

    expect(ok).toBe(false);
    expect(result?.error).toContain('keyword');
  });

  it('docs.list 缺少 spaceId 应该返回错误', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.docs.list', {});

    expect(ok).toBe(false);
    expect(result?.error).toContain('spaceId');
  });
});

describe('Gateway Methods - 状态检查', () => {
  let mockApi: ReturnType<typeof createMockApi>;

  beforeEach(() => {
    mockApi = createMockApi();
    registerGatewayMethods(mockApi.api);
  });

  it('status 应该返回配置状态', async () => {
    const { ok, result } = await mockApi.callMethod('dingtalk-connector.status');

    expect(ok).toBe(true);
    expect(result).toHaveProperty('configured');
    expect(result).toHaveProperty('enabled');
    expect(result).toHaveProperty('accountId');
    expect(result).toHaveProperty('clientId');
    expect(result.configured).toBe(true);
    expect(result.enabled).toBe(true);
  });


});

describe('Gateway Methods - 配置读取', () => {
  it('应该能通过 api.config 获取配置', async () => {
    const { api, handlers } = createMockApi();
    registerGatewayMethods(api);

    const handler = handlers.get('dingtalk-connector.status');
    expect(handler).toBeDefined();

    const respond = vi.fn();
    const context = {
      deps: {},
    };

    await handler!({ context, params: {}, respond });

    // 验证 respond 被调用且成功（api.config 提供了 mockConfig）
    expect(respond).toHaveBeenCalled();
    expect(respond.mock.calls[0][0]).toBe(true);
  });
});

console.log('✅ 单元测试完成');
