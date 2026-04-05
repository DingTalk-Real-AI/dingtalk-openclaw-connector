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
  statSync: vi.fn().mockReturnValue({ size: 1024 }),
}));

// Mock path and os
vi.mock('path', () => ({
  join: (...args: string[]) => args.join('/'),
  basename: (p: string) => p.split('/').pop() || '',
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
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

describe('AI Card helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildDeliverBody', () => {
    it('should build deliver body for user target', async () => {
      const { __testables } = await import('../../test');
      const { buildDeliverBody } = __testables as any;

      const result = buildDeliverBody('card123', { type: 'user', userId: 'user123' }, 'robotCode');

      expect(result.outTrackId).toBe('card123');
      expect(result.userIdType).toBe(1);
      expect(result.openSpaceId).toBe('dtv1.card//IM_ROBOT.user123');
      expect(result.imRobotOpenDeliverModel).toBeDefined();
    });

    it('should build deliver body for group target', async () => {
      const { __testables } = await import('../../test');
      const { buildDeliverBody } = __testables as any;

      const result = buildDeliverBody('card123', { type: 'group', openConversationId: 'conv123' }, 'robotCode');

      expect(result.outTrackId).toBe('card123');
      expect(result.openSpaceId).toBe('dtv1.card//IM_GROUP.conv123');
      expect(result.imGroupOpenDeliverModel).toBeDefined();
    });
  });

  describe('createAICardForTarget', () => {
    it('should create AI card for user successfully', async () => {
      const { __testables } = await import('../../test');
      const { createAICardForTarget } = __testables as any;

      mockAxiosPost.mockImplementation((url: string) => {
        if (url === 'https://api.dingtalk.com/v1.0/oauth2/accessToken') {
          return Promise.resolve({ data: { accessToken: 'token123', expireIn: 7200 } });
        }
        if (url.includes('/card/instances')) {
          return Promise.resolve({ status: 200, data: {} });
        }
        if (url.includes('/deliver')) {
          return Promise.resolve({ status: 200, data: {} });
        }
        return Promise.resolve({ status: 200, data: {} });
      });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const target = { type: 'user' as const, userId: 'user123' };

      const result = await createAICardForTarget(config, target, log);

      expect(result).not.toBeNull();
      expect(result?.cardInstanceId).toMatch(/^card_/);
      expect(result?.accessToken).toBe('token123');

      // 契约断言：应投放到 IM_ROBOT.user123，且 robotCode 为 config.clientId
      const deliverCall = mockAxiosPost.mock.calls.find((c) =>
        String(c[0]).includes('/v1.0/card/instances/deliver')
      );
      expect(deliverCall).toBeDefined();
      const deliverBody = deliverCall![1];
      expect(deliverBody.openSpaceId).toBe('dtv1.card//IM_ROBOT.user123');
      expect(deliverBody.imRobotOpenDeliverModel?.robotCode).toBe('test');
    });

    it('should create AI card for group successfully', async () => {
      const { __testables } = await import('../../test');
      const { createAICardForTarget } = __testables as any;

      mockAxiosPost.mockImplementation((url: string) => {
        if (url === 'https://api.dingtalk.com/v1.0/oauth2/accessToken') {
          return Promise.resolve({ data: { accessToken: 'token123', expireIn: 7200 } });
        }
        return Promise.resolve({ status: 200, data: {} });
      });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const target = { type: 'group' as const, openConversationId: 'conv123' };

      const result = await createAICardForTarget(config, target, log);

      expect(result).not.toBeNull();

      // 契约断言：应投放到 IM_GROUP.conv123
      const deliverCall = mockAxiosPost.mock.calls.find((c) =>
        String(c[0]).includes('/v1.0/card/instances/deliver')
      );
      expect(deliverCall).toBeDefined();
      const deliverBody = deliverCall![1];
      expect(deliverBody.openSpaceId).toBe('dtv1.card//IM_GROUP.conv123');
    });

    it('should return null on create card failure', async () => {
      const { __testables } = await import('../../test');
      const { createAICardForTarget } = __testables as any;

      mockAxiosPost.mockRejectedValue(new Error('API error'));

      const config = { clientId: 'test', clientSecret: 'secret' };
      const target = { type: 'user' as const, userId: 'user123' };

      const result = await createAICardForTarget(config, target, log);

      expect(result).toBeNull();
      expect(log.error).toHaveBeenCalled();
    });

    it('should return null on deliver card failure', async () => {
      const { __testables } = await import('../../test');
      const { createAICardForTarget } = __testables as any;

      mockAxiosPost.mockImplementation((url: string) => {
        if (url.includes('/card/instances') && !url.includes('/deliver')) {
          return Promise.resolve({ status: 200, data: {} });
        }
        return Promise.reject(new Error('Deliver failed'));
      });

      mockAxiosGet.mockResolvedValue({ data: { errcode: 0, access_token: 'token123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const target = { type: 'user' as const, userId: 'user123' };

      const result = await createAICardForTarget(config, target, log);

      expect(result).toBeNull();
      expect(log.error).toHaveBeenCalled();
    });
  });

  describe('streamAICard', () => {
    it('should switch to INPUTING status on first call', async () => {
      const { __testables } = await import('../../test');
      const { streamAICard } = __testables as any;

      mockAxiosPut.mockResolvedValue({ status: 200, data: {} });

      const card = { cardInstanceId: 'card123', accessToken: 'token123', inputingStarted: false };

      await streamAICard(card, 'Hello', false, log);

      // Should have called INPUTING status update first
      expect(mockAxiosPut).toHaveBeenCalled();
      expect(card.inputingStarted).toBe(true);
    });

    it('should not switch to INPUTING on subsequent calls', async () => {
      const { __testables } = await import('../../test');
      const { streamAICard } = __testables as any;

      mockAxiosPut.mockResolvedValue({ status: 200, data: {} });

      const card = { cardInstanceId: 'card123', accessToken: 'token123', inputingStarted: true };

      await streamAICard(card, 'Hello more', false, log);

      // Should not have called INPUTING status update
      const calls = mockAxiosPut.mock.calls;
      const inputingCalls = calls.filter((c: any[]) => c[0].includes('/card/instances'));
      // Only streaming call, no status call
      expect(inputingCalls.length).toBe(0);
    });

    it('should throw on INPUTING failure', async () => {
      const { __testables } = await import('../../test');
      const { streamAICard } = __testables as any;

      mockAxiosPut.mockRejectedValue(new Error('Status update failed'));

      const card = { cardInstanceId: 'card123', accessToken: 'token123', inputingStarted: false };

      await expect(streamAICard(card, 'Hello', false, undefined, log)).rejects.toThrow();
      // streamAICard no longer pre-logs errors; callers are responsible for error handling
    });

    it('should handle streaming failure', async () => {
      const { __testables } = await import('../../test');
      const { streamAICard } = __testables as any;

      mockAxiosPut.mockImplementation((url: string) => {
        if (url.includes('/card/instances')) {
          return Promise.resolve({ status: 200, data: {} });
        }
        return Promise.reject(new Error('Streaming failed'));
      });

      const card = { cardInstanceId: 'card123', accessToken: 'token123', inputingStarted: true };

      await expect(streamAICard(card, 'Hello', false, undefined, log)).rejects.toThrow();
      // streamAICard no longer pre-logs errors; callers are responsible for error handling
    });
  });

  describe('finishAICard', () => {
    it('should finalize card with content', async () => {
      const { __testables } = await import('../../test');
      const { finishAICard } = __testables as any;

      mockAxiosPut.mockResolvedValue({ status: 200, data: {} });

      const card = { cardInstanceId: 'card123', accessToken: 'token123', inputingStarted: true };

      await finishAICard(card, 'Final content', undefined, log);

      expect(log.info).toHaveBeenCalled();
    });

    it('should handle finish failure gracefully', async () => {
      const { __testables } = await import('../../test');
      const { finishAICard } = __testables as any;

      mockAxiosPut.mockImplementation((url: string) => {
        if (url.includes('/streaming')) {
          return Promise.resolve({ status: 200 });
        }
        return Promise.reject(new Error('Finish failed'));
      });

      const card = { cardInstanceId: 'card123', accessToken: 'token123', inputingStarted: true };

      // Should not throw, just log error
      await finishAICard(card, 'Final content', undefined, log);

      expect(log.error).toHaveBeenCalled();
    });
  });

  describe('sendAICardToUser', () => {
    it('should send AI card to user successfully', async () => {
      const { __testables } = await import('../../test');
      const { sendAICardToUser } = __testables as any;

      mockAxiosPost.mockResolvedValue({ status: 200, data: {} });
      mockAxiosGet.mockResolvedValue({ data: { errcode: 0, access_token: 'token123' } });
      mockAxiosPut.mockResolvedValue({ status: 200, data: {} });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendAICardToUser(config, 'user123', 'Hello', log);

      expect(result.ok).toBe(true);
      expect(result.usedAICard).toBe(true);
    });

    it('should return error when card creation fails', async () => {
      const { __testables } = await import('../../test');
      const { sendAICardToUser } = __testables as any;

      mockAxiosPost.mockRejectedValue(new Error('API error'));

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendAICardToUser(config, 'user123', 'Hello', log);

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('sendAICardToGroup', () => {
    it('should send AI card to group successfully', async () => {
      const { __testables } = await import('../../test');
      const { sendAICardToGroup } = __testables as any;

      mockAxiosPost.mockResolvedValue({ status: 200, data: {} });
      mockAxiosGet.mockResolvedValue({ data: { errcode: 0, access_token: 'token123' } });
      mockAxiosPut.mockResolvedValue({ status: 200, data: {} });

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendAICardToGroup(config, 'conv123', 'Hello group', log);

      expect(result.ok).toBe(true);
      expect(result.usedAICard).toBe(true);
    });

    it('should return error when card creation fails', async () => {
      const { __testables } = await import('../../test');
      const { sendAICardToGroup } = __testables as any;

      mockAxiosPost.mockRejectedValue(new Error('API error'));

      const config = { clientId: 'test', clientSecret: 'secret' };

      const result = await sendAICardToGroup(config, 'conv123', 'Hello group', log);

      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('sendAICardInternal', () => {
    it('should return ok with usedAICard false when content is empty after processing', async () => {
      const { __testables } = await import('../../test');
      const { sendAICardInternal } = __testables as any;

      mockAxiosGet.mockResolvedValue({ data: { errcode: 0, access_token: 'token123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const target = { type: 'user' as const, userId: 'user123' };

      // Content that would be processed to empty
      const result = await sendAICardInternal(config, target, '', log);

      expect(result.ok).toBe(true);
      expect(result.usedAICard).toBe(false);
    });

    it('should process local images when oapiToken is available', async () => {
      const { __testables } = await import('../../test');
      const { sendAICardInternal } = __testables as any;

      mockAxiosGet.mockImplementation((url: string) => {
        if (url.includes('gettoken')) {
          return Promise.resolve({ data: { errcode: 0, access_token: 'oapi-token' } });
        }
        return Promise.resolve({ data: { errcode: 0, access_token: 'token123' } });
      });
      mockAxiosPost.mockResolvedValue({ status: 200, data: {} });
      mockAxiosPut.mockResolvedValue({ status: 200, data: {} });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const target = { type: 'user' as const, userId: 'user123' };

      const result = await sendAICardInternal(config, target, 'Hello with ![image](/tmp/test.png)', log);

      expect(result.ok).toBe(true);
    });
  });
});