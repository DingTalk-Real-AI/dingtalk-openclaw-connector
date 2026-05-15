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
      const { __testables } = await import('../test');
      const { buildDeliverBody } = __testables as any;

      const result = buildDeliverBody('card123', { type: 'user', userId: 'user123' }, 'robotCode');

      expect(result.outTrackId).toBe('card123');
      expect(result.userIdType).toBe(1);
      expect(result.openSpaceId).toBe('dtv1.card//IM_ROBOT.user123');
      expect(result.imRobotOpenDeliverModel).toBeDefined();
    });

    it('should build deliver body for group target', async () => {
      const { __testables } = await import('../test');
      const { buildDeliverBody } = __testables as any;

      const result = buildDeliverBody('card123', { type: 'group', openConversationId: 'conv123' }, 'robotCode');

      expect(result.outTrackId).toBe('card123');
      expect(result.openSpaceId).toBe('dtv1.card//IM_GROUP.conv123');
      expect(result.imGroupOpenDeliverModel).toBeDefined();
    });
  });

  describe('createAICardForTarget', () => {
    it('should create AI card for user successfully', async () => {
      const { __testables } = await import('../test');
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
      const { __testables } = await import('../test');
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
      const { __testables } = await import('../test');
      const { createAICardForTarget } = __testables as any;

      mockAxiosPost.mockRejectedValue(new Error('API error'));

      const config = { clientId: 'test', clientSecret: 'secret' };
      const target = { type: 'user' as const, userId: 'user123' };

      const result = await createAICardForTarget(config, target, log);

      expect(result).toBeNull();
      expect(log.error).toHaveBeenCalled();
    });

    it('should return null on deliver card failure', async () => {
      const { __testables } = await import('../test');
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
      const { __testables } = await import('../test');
      const { streamAICard } = __testables as any;

      mockAxiosPut.mockResolvedValue({ status: 200, data: {} });

      const card = { cardInstanceId: 'card123', accessToken: 'token123', inputingStarted: false };

      await streamAICard(card, 'Hello', false, log);

      // Should have called INPUTING status update first
      expect(mockAxiosPut).toHaveBeenCalled();
      expect(card.inputingStarted).toBe(true);
    });

    it('should not switch to INPUTING on subsequent calls', async () => {
      const { __testables } = await import('../test');
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
      const { __testables } = await import('../test');
      const { streamAICard } = __testables as any;

      mockAxiosPut.mockRejectedValue(new Error('Status update failed'));

      const card = { cardInstanceId: 'card123', accessToken: 'token123', inputingStarted: false };

      await expect(streamAICard(card, 'Hello', false, undefined, log)).rejects.toThrow();
      // streamAICard no longer pre-logs errors; callers are responsible for error handling
    });

    it('should handle streaming failure', async () => {
      const { __testables } = await import('../test');
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

    // 回归测试 (issue #510)：令牌桶 waitForToken 串行化验证。
    // 修复前多个并发 streamAICard 会同时通过 `tokens < 1` 检查并各自扣减令牌，
    // 令牌桶被并发击穿；修复后通过 _queueTail 串行化，所有并发调用都能
    // 正常排队完成，不会死锁、不会抛错。
    it('should serialize concurrent streamAICard calls without deadlock', async () => {
      const { __testables } = await import('../test');
      const { streamAICard } = __testables as any;

      mockAxiosPut.mockResolvedValue({ status: 200, data: {} });

      // 用 inputingStarted=true 跳过 INPUTING 分支，只测试 streaming + 令牌桶
      const makeCard = (id: number) => ({
        cardInstanceId: `card-concurrent-${id}`,
        accessToken: 'token123',
        inputingStarted: true,
      });

      // 并发 30 次（超过 CARD_API_MAX_QPS=20，触发排队等待）
      const N = 30;
      const results = await Promise.allSettled(
        Array.from({ length: N }, (_, i) =>
          streamAICard(makeCard(i), `content-${i}`, false, undefined, log),
        ),
      );

      // 全部成功：验证串行化不会死锁、不会错误降级
      const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
      expect(fulfilled).toBe(N);

      // streaming PUT 至少被调用 N 次（每个并发 1 次）
      const streamingCalls = (mockAxiosPut.mock.calls as any[][]).filter((c) =>
        String(c[0]).includes('/card/streaming'),
      );
      expect(streamingCalls.length).toBe(N);
    }, 15_000);

    it('should retry INPUTING on QPS limit (403 QpsLimit) and succeed', async () => {
      // Regression guard for issue #510: first INPUTING PUT may hit QpsLimit;
      // streamAICard must back off and retry once instead of throwing, so the
      // AI Card keeps updating and callers don't show a fake "消息发送失败".
      const { __testables } = await import('../test');
      const { streamAICard } = __testables as any;

      const qpsError: any = new Error('Request failed with status code 403');
      qpsError.response = {
        status: 403,
        data: { code: 'QpsLimit.ExceedRealQps', message: 'qps exceed' },
      };

      let inputingCall = 0;
      mockAxiosPut.mockImplementation((url: string) => {
        if (url.includes('/card/instances')) {
          inputingCall += 1;
          if (inputingCall === 1) {
            return Promise.reject(qpsError);
          }
          return Promise.resolve({ status: 200, data: {} });
        }
        return Promise.resolve({ status: 200, data: {} });
      });

      const card = {
        cardInstanceId: 'card-qps',
        accessToken: 'token123',
        inputingStarted: false,
      };

      await expect(
        streamAICard(card, 'Hello', false, undefined, log),
      ).resolves.toBeUndefined();

      expect(inputingCall).toBeGreaterThanOrEqual(2);
      expect(card.inputingStarted).toBe(true);
    }, 10_000);
  });

  describe('fixNewlines', () => {
    it('should convert single \\n to <br>', async () => {
      const { __testables } = await import('../test');
      const { fixNewlines } = __testables as any;
      expect(fixNewlines('第一行\n第二行')).toBe('第一行<br>第二行');
    });

    it('should preserve \\n\\n paragraph breaks', async () => {
      const { __testables } = await import('../test');
      const { fixNewlines } = __testables as any;
      expect(fixNewlines('第一段\n\n第二段')).toBe('第一段\n\n第二段');
    });

    it('should preserve \\n inside fenced code blocks', async () => {
      const { __testables } = await import('../test');
      const { fixNewlines } = __testables as any;
      const input = '```python\ndef hello():\n    print("hi")\n```';
      expect(fixNewlines(input)).toBe(input);
    });

    it('should not merge quote-like lines inside fenced code blocks', async () => {
      const { __testables } = await import('../test');
      const { fixNewlines } = __testables as any;
      const input = '```\n> line1\n> line2\n```';
      expect(fixNewlines(input)).toBe(input);
    });

    it('should preserve \\n before list items', async () => {
      const { __testables } = await import('../test');
      const { fixNewlines } = __testables as any;
      expect(fixNewlines('- a\n- b')).toBe('- a\n- b');
      expect(fixNewlines('1. a\n2. b')).toBe('1. a\n2. b');
    });

    it('should preserve \\n before table rows', async () => {
      const { __testables } = await import('../test');
      const { fixNewlines } = __testables as any;
      expect(fixNewlines('| a |\n| b |')).toBe('| a |\n| b |');
    });

    it('should merge consecutive quote lines with <br>', async () => {
      const { __testables } = await import('../test');
      const { fixNewlines } = __testables as any;
      expect(fixNewlines('> line1\n> line2')).toBe('> line1<br>line2');
    });

    it('should handle code block mixed with plain text', async () => {
      const { __testables } = await import('../test');
      const { fixNewlines } = __testables as any;
      const input = '前文\n\n```\ncode\n```\n\n后文';
      expect(fixNewlines(input)).toBe('前文\n\n```\ncode\n```\n\n后文');
    });

    it('should handle empty string', async () => {
      const { __testables } = await import('../test');
      const { fixNewlines } = __testables as any;
      expect(fixNewlines('')).toBe('');
    });

    it('should normalize CRLF line endings', async () => {
      const { __testables } = await import('../test');
      const { fixNewlines } = __testables as any;
      expect(fixNewlines('第一行\r\n第二行')).toBe('第一行<br>第二行');
    });
  });

  describe('normalizeForCard', () => {
    it('should apply both ensureTableBlankLines and fixNewlines', async () => {
      const { __testables } = await import('../test');
      const { normalizeForCard } = __testables as any;
      // Plain text: single \n → <br>
      expect(normalizeForCard('a\nb')).toBe('a<br>b');
    });

    it('should handle table content', async () => {
      const { __testables } = await import('../test');
      const { normalizeForCard } = __testables as any;
      const input = 'text\n| a |\n| --- |\n| b |';
      const result = normalizeForCard(input);
      // Table rows should have \n preserved
      expect(result).toContain('| a |');
      expect(result).toContain('| b |');
    });

    it('should normalize CRLF before applying table rules', async () => {
      const { __testables } = await import('../test');
      const { normalizeForCard } = __testables as any;
      const input = 'text\r\n| a |\r\n| --- |\r\n| b |';
      expect(normalizeForCard(input)).toBe('text\n\n| a |\n| --- |\n| b |');
    });
  });

  describe('isQpsLimitError', () => {
    it('should identify 403 QpsLimit errors', async () => {
      const { __testables } = await import('../test');
      const { isQpsLimitError } = __testables as any;

      const qpsErr: any = new Error('403');
      qpsErr.response = { status: 403, data: { code: 'QpsLimit.Exceed' } };
      expect(isQpsLimitError(qpsErr)).toBe(true);

      const otherErr: any = new Error('400');
      otherErr.response = { status: 400, data: { code: 'BadRequest' } };
      expect(isQpsLimitError(otherErr)).toBe(false);

      const forbiddenOther: any = new Error('403');
      forbiddenOther.response = { status: 403, data: { code: 'Forbidden.NoPermission' } };
      expect(isQpsLimitError(forbiddenOther)).toBe(false);

      expect(isQpsLimitError(new Error('network'))).toBe(false);
    });
  });

  describe('finishAICard', () => {
    it('should finalize card with content', async () => {
      const { __testables } = await import('../test');
      const { finishAICard } = __testables as any;

      mockAxiosPut.mockResolvedValue({ status: 200, data: {} });

      const card = { cardInstanceId: 'card123', accessToken: 'token123', inputingStarted: true };

      await finishAICard(card, 'Final content', undefined, log);

      expect(log.info).toHaveBeenCalled();
    });

    it('should pass config to internal streamAICard call', async () => {
      const { __testables } = await import('../test');
      const { finishAICard } = __testables as any;

      mockAxiosPut.mockResolvedValue({ status: 200, data: {} });

      // Use a card with valid (non-expired) token so ensureValidToken skips refresh
      const card = {
        cardInstanceId: 'card123',
        accessToken: 'valid-token',
        inputingStarted: true,
        tokenExpireTime: Date.now() + 2 * 60 * 60 * 1000, // 2 hours from now
      };
      const config = { clientId: 'test-id', clientSecret: 'test-secret' };

      await finishAICard(card, 'Final content', config, log);

      // Verify streaming PUT was called with the card's accessToken in headers
      const streamingCall = mockAxiosPut.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('/card/streaming')
      );
      expect(streamingCall).toBeDefined();
      expect(streamingCall![2]?.headers?.['x-acs-dingtalk-access-token']).toBe('valid-token');
    });

    it('should handle finish failure gracefully', async () => {
      const { __testables } = await import('../test');
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

    // 回归测试 (issue #510)：FINISHED PUT 遇到 QPS 限流时应退避重试，
    // 避免卡片永远卡在"思考动画"状态（INPUTING 不结束）。
    it('should retry FINISHED PUT on QPS limit and succeed', async () => {
      const { __testables } = await import('../test');
      const { finishAICard } = __testables as any;

      const qpsError: any = new Error('Request failed with status code 403');
      qpsError.response = {
        status: 403,
        data: { code: 'QpsLimit.ExceedRealQps' },
      };

      // 所有 PUT 都针对 /card/instances 或 /card/streaming。
      // /streaming 始终成功；/instances（FINISHED PUT）第一次 QPS 失败，第二次成功。
      let finishedCall = 0;
      mockAxiosPut.mockImplementation((url: string) => {
        if (url.includes('/card/streaming')) {
          return Promise.resolve({ status: 200, data: {} });
        }
        // /card/instances，此处用于 FINISHED（因 inputingStarted=true 不会走 INPUTING）
        finishedCall += 1;
        if (finishedCall === 1) {
          return Promise.reject(qpsError);
        }
        return Promise.resolve({ status: 200, data: {} });
      });

      const card = {
        cardInstanceId: 'card-qps-finish',
        accessToken: 'token123',
        inputingStarted: true,
      };

      await finishAICard(card, 'Final content', undefined, log);

      // 至少两次 FINISHED PUT：一次失败 + 一次重试成功
      expect(finishedCall).toBeGreaterThanOrEqual(2);
      // FINISHED 重试成功路径会打 info 日志，错误路径不该被触发
      const errorCalls = (log.error.mock.calls as any[][]).filter((c) =>
        String(c[0] ?? '').includes('FINISHED 更新失败'),
      );
      expect(errorCalls.length).toBe(0);
    }, 10_000);
  });

  describe('sendAICardToUser', () => {
    it('should send AI card to user successfully', async () => {
      const { __testables } = await import('../test');
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
      const { __testables } = await import('../test');
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
      const { __testables } = await import('../test');
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
      const { __testables } = await import('../test');
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
      const { __testables } = await import('../test');
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
      const { __testables } = await import('../test');
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
