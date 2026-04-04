import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock axios
const mockAxiosGet = vi.hoisted(() => vi.fn());
const mockAxiosPost = vi.hoisted(() => vi.fn());
const mockAxiosPut = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } })),
    get: mockAxiosGet,
    post: mockAxiosPost,
    put: mockAxiosPut,
  },
}));

vi.mock('../../src/utils/http-client.ts', () => ({
  dingtalkHttp: { post: mockAxiosPost, get: mockAxiosGet, put: mockAxiosPut, delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
  dingtalkOapiHttp: { get: mockAxiosGet, post: mockAxiosPost, put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
  dingtalkUploadHttp: { post: mockAxiosPost, get: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
}));

// Mock fs
vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock path and os
vi.mock('path', () => ({
  join: (...args: string[]) => args.join('/'),
  basename: (p: string) => p.split('/').pop() || '',
  extname: (p: string) => {
    const idx = p.lastIndexOf('.');
    return idx >= 0 ? p.slice(idx) : '';
  },
}));

vi.mock('os', () => ({
  homedir: () => '/fake-home',
  tmpdir: () => '/tmp',
}));

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('proactive message helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildMsgPayload', () => {
    it('should build text message payload', async () => {
      const { __testables } = await import('../../test');
      const { buildMsgPayload } = __testables as any;

      const result = buildMsgPayload('text', 'Hello world');

      expect(result.msgKey).toBe('sampleText');
      expect(result.msgParam.content).toBe('Hello world');
    });

    it('should build markdown message payload', async () => {
      const { __testables } = await import('../../test');
      const { buildMsgPayload } = __testables as any;

      const result = buildMsgPayload('markdown', '# Title\nBody text', 'Title');

      expect(result.msgKey).toBe('sampleMarkdown');
      expect(result.msgParam.title).toBe('Title');
      expect(result.msgParam.text).toBe('# Title\nBody text');
    });

    it('should extract title from markdown content when not provided', async () => {
      const { __testables } = await import('../../test');
      const { buildMsgPayload } = __testables as any;

      const result = buildMsgPayload('markdown', '# My Title\nBody');

      expect(result.msgParam.title).toBe('My Title');
    });

    it('should build link message payload from JSON string', async () => {
      const { __testables } = await import('../../test');
      const { buildMsgPayload } = __testables as any;

      const linkData = JSON.stringify({ title: 'Link', messageUrl: 'https://example.com' });
      const result = buildMsgPayload('link', linkData);

      expect(result.msgKey).toBe('sampleLink');
      expect(result.msgParam.title).toBe('Link');
    });

    it('should return error for invalid link JSON', async () => {
      const { __testables } = await import('../../test');
      const { buildMsgPayload } = __testables as any;

      const result = buildMsgPayload('link', 'not-valid-json');

      expect(result.error).toBeDefined();
    });

    it('should build actionCard message payload from JSON string', async () => {
      const { __testables } = await import('../../test');
      const { buildMsgPayload } = __testables as any;

      const cardData = JSON.stringify({ title: 'Card', btns: [] });
      const result = buildMsgPayload('actionCard', cardData);

      expect(result.msgKey).toBe('sampleActionCard');
    });

    it('should return error for invalid actionCard JSON', async () => {
      const { __testables } = await import('../../test');
      const { buildMsgPayload } = __testables as any;

      const result = buildMsgPayload('actionCard', 'not-valid-json');

      expect(result.error).toBeDefined();
    });

    it('should build image message payload', async () => {
      const { __testables } = await import('../../test');
      const { buildMsgPayload } = __testables as any;

      const result = buildMsgPayload('image', 'https://example.com/image.png');

      expect(result.msgKey).toBe('sampleImageMsg');
      expect(result.msgParam.photoURL).toBe('https://example.com/image.png');
    });

    it('should default to text for unknown message type', async () => {
      const { __testables } = await import('../../test');
      const { buildMsgPayload } = __testables as any;

      const result = buildMsgPayload('unknown' as any, 'content');

      expect(result.msgKey).toBe('sampleText');
    });
  });

  describe('sendNormalToUser', () => {
    it('should send text message to single user', async () => {
      const { __testables } = await import('../../test');
      const { sendNormalToUser } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendNormalToUser(config, 'user123', 'Hello', { log });

      expect(result.ok).toBe(true);
      expect(result.processQueryKey).toBe('key123');
      expect(result.usedAICard).toBe(false);

      // 契约断言：应调用单聊批量发送端点，并带上 robotCode 与 msgKey/msgParam
      const call = mockAxiosPost.mock.calls.find((c) => String(c[0]).includes('/v1.0/robot/oToMessages/batchSend'));
      expect(call).toBeDefined();
      const body = call![1];
      expect(body.robotCode).toBe('test');
      expect(body.userIds).toEqual(['user123']);
      expect(body.msgKey).toBe('sampleText');
      expect(() => JSON.parse(body.msgParam)).not.toThrow();
      expect(JSON.parse(body.msgParam).content).toBe('Hello');
    });

    it('should send message to multiple users', async () => {
      const { __testables } = await import('../../test');
      const { sendNormalToUser } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendNormalToUser(config, ['user1', 'user2'], 'Hello all', { log });

      expect(result.ok).toBe(true);
    });

    it('should return error for invalid message format', async () => {
      const { __testables } = await import('../../test');
      const { sendNormalToUser } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendNormalToUser(config, 'user123', 'invalid', { msgType: 'link', log });

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle API error', async () => {
      const { __testables } = await import('../../test');
      const { sendNormalToUser } = __testables as any;

      mockAxiosPost.mockRejectedValue({ response: { data: { message: 'API error' } } });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendNormalToUser(config, 'user123', 'Hello', { log });

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle response without processQueryKey', async () => {
      const { __testables } = await import('../../test');
      const { sendNormalToUser } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: {} });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendNormalToUser(config, 'user123', 'Hello', { log });

      expect(result.ok).toBe(false);
    });
  });

  describe('sendNormalToGroup', () => {
    it('should send message to group', async () => {
      const { __testables } = await import('../../test');
      const { sendNormalToGroup } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendNormalToGroup(config, 'conv123', 'Hello group', { log });

      expect(result.ok).toBe(true);
      expect(result.processQueryKey).toBe('key123');

      // 契约断言：应调用群聊发送端点，并带上 openConversationId
      const call = mockAxiosPost.mock.calls.find((c) => String(c[0]).includes('/v1.0/robot/groupMessages/send'));
      expect(call).toBeDefined();
      const body = call![1];
      expect(body.openConversationId).toBe('conv123');
      expect(body.robotCode).toBe('test');
      expect(body.msgKey).toBe('sampleText');
      expect(() => JSON.parse(body.msgParam)).not.toThrow();
      expect(JSON.parse(body.msgParam).content).toBe('Hello group');
    });

    it('should send markdown to group', async () => {
      const { __testables } = await import('../../test');
      const { sendNormalToGroup } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendNormalToGroup(config, 'conv123', '# Title\nContent', { msgType: 'markdown', log });

      expect(result.ok).toBe(true);

      // 契约断言：markdown 的 msgParam 必须包含 title/text（且可解析）
      const call = mockAxiosPost.mock.calls.find((c) => String(c[0]).includes('/v1.0/robot/groupMessages/send'));
      expect(call).toBeDefined();
      const body = call![1];
      expect(body.msgKey).toBe('sampleMarkdown');
      expect(() => JSON.parse(body.msgParam)).not.toThrow();
      const msgParam = JSON.parse(body.msgParam);
      expect(msgParam.title).toBe('Title');
      expect(msgParam.text).toContain('# Title');
    });

    it('should handle API error', async () => {
      const { __testables } = await import('../../test');
      const { sendNormalToGroup } = __testables as any;

      mockAxiosPost.mockRejectedValue(new Error('Network error'));

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendNormalToGroup(config, 'conv123', 'Hello', { log });

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('sendToUser', () => {
    it('should return error when clientId or clientSecret is missing', async () => {
      const { __testables } = await import('../../test');
      const { sendToUser } = __testables as any;

      const result = await sendToUser({}, 'user123', 'Hello', { log });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Missing');
    });

    it('should return error when userIds is empty', async () => {
      const { __testables } = await import('../../test');
      const { sendToUser } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendToUser(config, [], 'Hello', { log });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should use AI Card for single user by default', async () => {
      const { __testables } = await import('../../test');
      const { sendToUser } = __testables as any;

      mockAxiosPost.mockResolvedValue({ status: 200, data: {} });
      mockAxiosGet.mockResolvedValue({ data: { errcode: 0, access_token: 'token123' } });
      mockAxiosPut.mockResolvedValue({ status: 200, data: {} });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendToUser(config, 'user123', 'Hello', { log });

      expect(result.ok).toBe(true);
    });

    it('should use normal message for multiple users', async () => {
      const { __testables } = await import('../../test');
      const { sendToUser } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendToUser(config, ['user1', 'user2'], 'Hello', { log });

      expect(result.ok).toBe(true);
      expect(result.usedAICard).toBe(false);
    });

    it('should fallback to normal message when AI Card fails', async () => {
      const { __testables } = await import('../../test');
      const { sendToUser } = __testables as any;

      // AI Card creation fails
      mockAxiosPost.mockImplementation((url: string) => {
        if (url.includes('/card/instances')) {
          return Promise.reject(new Error('Card failed'));
        }
        return Promise.resolve({ data: { processQueryKey: 'key123' } });
      });
      mockAxiosGet.mockResolvedValue({ data: { errcode: 0, access_token: 'token123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendToUser(config, 'user123', 'Hello', { log });

      expect(result.ok).toBe(true);
    });

    it('should not fallback when fallbackToNormal is false', async () => {
      const { __testables } = await import('../../test');
      const { sendToUser } = __testables as any;

      mockAxiosPost.mockRejectedValue(new Error('Card failed'));
      mockAxiosGet.mockResolvedValue({ data: { errcode: 0, access_token: 'token123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendToUser(config, 'user123', 'Hello', { fallbackToNormal: false, log });

      expect(result.ok).toBe(false);
    });

    it('should use normal message when useAICard is false', async () => {
      const { __testables } = await import('../../test');
      const { sendToUser } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendToUser(config, 'user123', 'Hello', { useAICard: false, log });

      expect(result.ok).toBe(true);
      expect(result.usedAICard).toBe(false);
    });
  });

  describe('sendToGroup', () => {
    it('should return error when clientId or clientSecret is missing', async () => {
      const { __testables } = await import('../../test');
      const { sendToGroup } = __testables as any;

      const result = await sendToGroup({}, 'conv123', 'Hello', { log });

      expect(result.ok).toBe(false);
    });

    it('should return error when openConversationId is empty', async () => {
      const { __testables } = await import('../../test');
      const { sendToGroup } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendToGroup(config, '', 'Hello', { log });

      expect(result.ok).toBe(false);
    });

    it('should use AI Card by default', async () => {
      const { __testables } = await import('../../test');
      const { sendToGroup } = __testables as any;

      mockAxiosPost.mockResolvedValue({ status: 200, data: {} });
      mockAxiosGet.mockResolvedValue({ data: { errcode: 0, access_token: 'token123' } });
      mockAxiosPut.mockResolvedValue({ status: 200, data: {} });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendToGroup(config, 'conv123', 'Hello', { log });

      expect(result.ok).toBe(true);
    });

    it('should fallback to normal message on AI Card failure', async () => {
      const { __testables } = await import('../../test');
      const { sendToGroup } = __testables as any;

      mockAxiosPost.mockImplementation((url: string) => {
        if (url.includes('/card/instances')) {
          return Promise.reject(new Error('Card failed'));
        }
        return Promise.resolve({ data: { processQueryKey: 'key123' } });
      });
      mockAxiosGet.mockResolvedValue({ data: { errcode: 0, access_token: 'token123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendToGroup(config, 'conv123', 'Hello', { log });

      expect(result.ok).toBe(true);
    });
  });

  describe('sendProactive', () => {
    it('should auto-detect markdown content type', async () => {
      const { __testables } = await import('../../test');
      const { sendProactive } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendProactive(config, { userId: 'user123' }, '# Title\nContent', { useAICard: false, log });

      expect(result.ok).toBe(true);
    });

    it('should send to user via userId', async () => {
      const { __testables } = await import('../../test');
      const { sendProactive } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendProactive(config, { userId: 'user123' }, 'Hello', { useAICard: false, log });

      expect(result.ok).toBe(true);
    });

    it('should send to user via userIds array', async () => {
      const { __testables } = await import('../../test');
      const { sendProactive } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendProactive(config, { userIds: ['user1', 'user2'] }, 'Hello', { useAICard: false, log });

      expect(result.ok).toBe(true);
    });

    it('should send to group via openConversationId', async () => {
      const { __testables } = await import('../../test');
      const { sendProactive } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendProactive(config, { openConversationId: 'conv123' }, 'Hello', { useAICard: false, log });

      expect(result.ok).toBe(true);
    });

    it('should return error when no target specified', async () => {
      const { __testables } = await import('../../test');
      const { sendProactive } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendProactive(config, {}, 'Hello', { log });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Must specify');
    });
  });
});
