import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock axios
const mockAxiosGet = vi.hoisted(() => vi.fn());
const mockAxiosPost = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({
  default: {
    get: mockAxiosGet,
    post: mockAxiosPost,
  },
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

describe('core functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('normalizeSlashCommand', () => {
    it('should return /new for new session commands', async () => {
      const { __testables } = await import('../../test');
      const { normalizeSlashCommand } = __testables as any;

      expect(normalizeSlashCommand('/new')).toBe('/new');
      expect(normalizeSlashCommand('/reset')).toBe('/new');
      expect(normalizeSlashCommand('/clear')).toBe('/new');
      expect(normalizeSlashCommand('新会话')).toBe('/new');
      expect(normalizeSlashCommand('重新开始')).toBe('/new');
    });

    it('should return original text for non-command text', async () => {
      const { __testables } = await import('../../test');
      const { normalizeSlashCommand } = __testables as any;

      expect(normalizeSlashCommand('/help')).toBe('/help');
      expect(normalizeSlashCommand('hello')).toBe('hello');
      expect(normalizeSlashCommand('some text')).toBe('some text');
    });
  });

  describe('message deduplication', () => {
    it('should track processed messages', async () => {
      const { __testables } = await import('../../test');
      const { isMessageProcessed, markMessageProcessed, cleanupProcessedMessages } = __testables as any;

      cleanupProcessedMessages();

      expect(isMessageProcessed('msg1')).toBe(false);

      markMessageProcessed('msg1');
      expect(isMessageProcessed('msg1')).toBe(true);

      expect(isMessageProcessed('msg2')).toBe(false);
    });

    it('should handle empty message ID', async () => {
      const { __testables } = await import('../../test');
      const { isMessageProcessed, markMessageProcessed } = __testables as any;

      expect(isMessageProcessed('')).toBe(false);
      markMessageProcessed('');
      expect(isMessageProcessed('')).toBe(false);
    });
  });

  describe('checkAndMarkDingtalkMessage', () => {
    it('should return false and mark both IDs on first call', async () => {
      const { __testables } = await import('../../test');
      const { checkAndMarkDingtalkMessage, isMessageProcessed, cleanupProcessedMessages } = __testables as any;

      cleanupProcessedMessages();

      const isDuplicate = checkAndMarkDingtalkMessage('acc-test', 'proto-id-1', 'biz-id-1');
      expect(isDuplicate).toBe(false);

      // 两个 ID 都应被标记为已处理（带 accountId 前缀）
      expect(isMessageProcessed('acc-test:proto-id-1')).toBe(true);
      expect(isMessageProcessed('acc-test:biz-id-1')).toBe(true);
    });

    it('should return true when protocol messageId is already processed (协议层重复)', async () => {
      const { __testables } = await import('../../test');
      const { checkAndMarkDingtalkMessage, markMessageProcessed, cleanupProcessedMessages } = __testables as any;

      cleanupProcessedMessages();

      // 预先标记协议层 ID（带 accountId 前缀）
      markMessageProcessed('acc-test:proto-id-2');

      const isDuplicate = checkAndMarkDingtalkMessage('acc-test', 'proto-id-2', 'biz-id-2');
      expect(isDuplicate).toBe(true);
    });

    it('should return true when business msgId is already processed (钉钉服务端重发)', async () => {
      const { __testables } = await import('../../test');
      const { checkAndMarkDingtalkMessage, markMessageProcessed, cleanupProcessedMessages } = __testables as any;

      cleanupProcessedMessages();

      // 首次处理：标记业务层 ID（带 accountId 前缀）
      markMessageProcessed('acc-test:biz-id-3');

      // 重发时：协议层 ID 是新值，但业务层 ID 不变 → 应被拦截
      const isDuplicate = checkAndMarkDingtalkMessage('acc-test', 'proto-id-3-new', 'biz-id-3');
      expect(isDuplicate).toBe(true);
    });

    it('should work with only protocolMessageId provided', async () => {
      const { __testables } = await import('../../test');
      const { checkAndMarkDingtalkMessage, isMessageProcessed, cleanupProcessedMessages } = __testables as any;

      cleanupProcessedMessages();

      expect(checkAndMarkDingtalkMessage('acc-test', 'proto-only', undefined)).toBe(false);
      expect(isMessageProcessed('acc-test:proto-only')).toBe(true);

      // 再次调用应返回 true
      expect(checkAndMarkDingtalkMessage('acc-test', 'proto-only', undefined)).toBe(true);
    });

    it('should work with only businessMsgId provided', async () => {
      const { __testables } = await import('../../test');
      const { checkAndMarkDingtalkMessage, isMessageProcessed, cleanupProcessedMessages } = __testables as any;

      cleanupProcessedMessages();

      expect(checkAndMarkDingtalkMessage('acc-test', undefined, 'biz-only')).toBe(false);
      expect(isMessageProcessed('acc-test:biz-only')).toBe(true);

      // 再次调用应返回 true
      expect(checkAndMarkDingtalkMessage('acc-test', undefined, 'biz-only')).toBe(true);
    });

    it('should return false when both IDs are undefined', async () => {
      const { __testables } = await import('../../test');
      const { checkAndMarkDingtalkMessage, cleanupProcessedMessages } = __testables as any;

      cleanupProcessedMessages();

      // 两个 ID 都是 undefined，不应标记任何内容，也不应误判为重复
      expect(checkAndMarkDingtalkMessage(undefined, undefined)).toBe(false);
    });
  });

  describe('getConfig', () => {
    it('should extract config from ClawdbotConfig', async () => {
      const { __testables } = await import('../../test');
      const { getConfig } = __testables as any;

      const cfg = {
        channels: {
          'dingtalk-connector': {
            clientId: 'test-client',
            clientSecret: 'test-secret',
          },
        },
      };

      const result = getConfig(cfg);

      expect(result.clientId).toBe('test-client');
      expect(result.clientSecret).toBe('test-secret');
    });

    it('should handle missing config', async () => {
      const { __testables } = await import('../../test');
      const { getConfig } = __testables as any;

      const result = getConfig({});

      expect(result).toEqual({});
    });
  });

  describe('isConfigured', () => {
    it('should return true when configured', async () => {
      const { __testables } = await import('../../test');
      const { isConfigured } = __testables as any;

      const cfg = {
        channels: {
          'dingtalk-connector': {
            clientId: 'test-client',
            clientSecret: 'test-secret',
          },
        },
      };

      expect(isConfigured(cfg)).toBe(true);
    });

    it('should return false when not configured', async () => {
      const { __testables } = await import('../../test');
      const { isConfigured } = __testables as any;

      expect(isConfigured({})).toBe(false);
      expect(isConfigured({ channels: {} })).toBe(false);
      expect(isConfigured({ channels: { 'dingtalk-connector': {} } })).toBe(false);
    });
  });

  describe('getAccessToken', () => {
    it('should get access token successfully', async () => {
      const { __testables } = await import('../../test');
      const { getAccessToken } = __testables as any;

      mockAxiosPost.mockResolvedValue({
        data: {
          accessToken: 'test-token-123',
          expireIn: 7200,
        },
      });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const result = await getAccessToken(config);

      expect(result).toBe('test-token-123');
    });

    it('should throw on API error', async () => {
      // getAccessToken 在模块级别缓存 token，这里需要重置模块避免前一个用例的缓存影响断言
      vi.resetModules();
      const { __testables } = await import('../../test');
      const { getAccessToken } = __testables as any;

      mockAxiosPost.mockRejectedValue(new Error('Invalid credentials'));

      const config = { clientId: 'test', clientSecret: 'secret' };

      await expect(getAccessToken(config)).rejects.toThrow();
    });
  });

  describe('getOapiAccessToken', () => {
    beforeEach(() => {
      // getOapiAccessToken 在模块级别缓存 token，这里重置模块避免用例之间互相污染
      vi.resetModules();
    });

    it('should get OAPI access token successfully', async () => {
      const { __testables } = await import('../../test');
      const { getOapiAccessToken } = __testables as any;

      mockAxiosGet.mockResolvedValue({
        data: {
          errcode: 0,
          access_token: 'oapi-token-123',
        },
      });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const result = await getOapiAccessToken(config);

      expect(result).toBe('oapi-token-123');
    });

    it('should return null on error', async () => {
      const { __testables } = await import('../../test');
      const { getOapiAccessToken } = __testables as any;

      mockAxiosGet.mockResolvedValue({
        data: {
          errcode: 1,
          errmsg: 'Error',
        },
      });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const result = await getOapiAccessToken(config);

      expect(result).toBeNull();
    });

    it('should return null on network error', async () => {
      const { __testables } = await import('../../test');
      const { getOapiAccessToken } = __testables as any;

      mockAxiosGet.mockRejectedValue(new Error('Network error'));

      const config = { clientId: 'test', clientSecret: 'secret' };
      const result = await getOapiAccessToken(config);

      expect(result).toBeNull();
    });
  });

  describe('toLocalPath', () => {
    it('should convert URL to local path', async () => {
      const { __testables } = await import('../../test');
      const { toLocalPath } = __testables as any;

      const result = toLocalPath('https://example.com/image.png');
      expect(result).toContain('image.png');
    });

    it('should handle local paths', async () => {
      const { __testables } = await import('../../test');
      const { toLocalPath } = __testables as any;

      const result = toLocalPath('/tmp/file.pdf');
      expect(result).toBe('/tmp/file.pdf');
    });
  });

  describe('buildMediaSystemPrompt', () => {
    it('should return media system prompt', async () => {
      const { __testables } = await import('../../test');
      const { buildMediaSystemPrompt } = __testables as any;

      const result = buildMediaSystemPrompt();

      expect(result).toContain('图片');
      expect(result).toContain('视频');
      expect(result).toContain('音频');
    });
  });

  describe('isAudioFile', () => {
    it('should detect audio file types', async () => {
      const { __testables } = await import('../../test');
      const { isAudioFile } = __testables as any;

      expect(isAudioFile('mp3')).toBe(true);
      expect(isAudioFile('wav')).toBe(true);
      expect(isAudioFile('ogg')).toBe(true);
      expect(isAudioFile('m4a')).toBe(true);
      expect(isAudioFile('pdf')).toBe(false);
      expect(isAudioFile('png')).toBe(false);
    });
  });

  describe('getFfprobePath', () => {
    it('should return ffprobe path', async () => {
      const { __testables } = await import('../../test');
      const { getFfprobePath } = __testables as any;

      const result = getFfprobePath();

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });
});