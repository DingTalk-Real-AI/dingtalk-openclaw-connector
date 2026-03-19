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
      const { __testables } = await import('../../plugin');
      const { normalizeSlashCommand } = __testables as any;

      // 覆盖所有新会话命令
      expect(normalizeSlashCommand('/new')).toBe('/new');
      expect(normalizeSlashCommand('/reset')).toBe('/new');
      expect(normalizeSlashCommand('/clear')).toBe('/new');
      expect(normalizeSlashCommand('新会话')).toBe('/new');
      expect(normalizeSlashCommand('重新开始')).toBe('/new');
      expect(normalizeSlashCommand('清空对话')).toBe('/new');

      // 测试大小写不敏感
      expect(normalizeSlashCommand('/NEW')).toBe('/new');
      expect(normalizeSlashCommand('/Reset')).toBe('/new');
    });

    it('should return original text for non-command text', async () => {
      const { __testables } = await import('../../plugin');
      const { normalizeSlashCommand } = __testables as any;

      expect(normalizeSlashCommand('/help')).toBe('/help');
      expect(normalizeSlashCommand('hello')).toBe('hello');
      expect(normalizeSlashCommand('some text')).toBe('some text');
    });
  });

  describe('message deduplication', () => {
    it('should track processed messages', async () => {
      const { __testables } = await import('../../plugin');
      const { isMessageProcessed, markMessageProcessed, cleanupProcessedMessages } = __testables as any;

      cleanupProcessedMessages();

      expect(isMessageProcessed('msg1')).toBe(false);

      markMessageProcessed('msg1');
      expect(isMessageProcessed('msg1')).toBe(true);

      expect(isMessageProcessed('msg2')).toBe(false);
    });

    it('should handle empty message ID', async () => {
      const { __testables } = await import('../../plugin');
      const { isMessageProcessed, markMessageProcessed } = __testables as any;

      expect(isMessageProcessed('')).toBe(false);
      markMessageProcessed('');
      expect(isMessageProcessed('')).toBe(false);
    });
  });

  describe('getConfig', () => {
    it('should extract config from ClawdbotConfig', async () => {
      const { __testables } = await import('../../plugin');
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
      const { __testables } = await import('../../plugin');
      const { getConfig } = __testables as any;

      const result = getConfig({});

      expect(result).toEqual({});
    });
  });

  describe('isConfigured', () => {
    it('should return true when configured', async () => {
      const { __testables } = await import('../../plugin');
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
      const { __testables } = await import('../../plugin');
      const { isConfigured } = __testables as any;

      expect(isConfigured({})).toBe(false);
      expect(isConfigured({ channels: {} })).toBe(false);
      expect(isConfigured({ channels: { 'dingtalk-connector': {} } })).toBe(false);
    });
  });

  describe('getAccessToken', () => {
    it('should get access token successfully', async () => {
      const { __testables } = await import('../../plugin');
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
      const { __testables } = await import('../../plugin');
      const { getAccessToken } = __testables as any;

      mockAxiosPost.mockRejectedValue(new Error('Invalid credentials'));

      const config = { clientId: 'test', clientSecret: 'secret' };

      await expect(getAccessToken(config)).rejects.toThrow();
    });
  });

  describe('getOapiAccessToken', () => {
    it('should get OAPI access token successfully', async () => {
      const { __testables } = await import('../../plugin');
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
      const { __testables } = await import('../../plugin');
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
      const { __testables } = await import('../../plugin');
      const { getOapiAccessToken } = __testables as any;

      mockAxiosGet.mockRejectedValue(new Error('Network error'));

      const config = { clientId: 'test', clientSecret: 'secret' };
      const result = await getOapiAccessToken(config);

      expect(result).toBeNull();
    });
  });

  describe('toLocalPath', () => {
    it('should convert URL to local path', async () => {
      const { __testables } = await import('../../plugin');
      const { toLocalPath } = __testables as any;

      const result = toLocalPath('https://example.com/image.png');
      expect(result).toContain('image.png');
    });

    it('should handle local paths', async () => {
      const { __testables } = await import('../../plugin');
      const { toLocalPath } = __testables as any;

      const result = toLocalPath('/tmp/file.pdf');
      expect(result).toBe('/tmp/file.pdf');
    });
  });

  describe('buildMediaSystemPrompt', () => {
    it('should return media system prompt', async () => {
      const { __testables } = await import('../../plugin');
      const { buildMediaSystemPrompt } = __testables as any;

      const result = buildMediaSystemPrompt();

      expect(result).toContain('图片');
      expect(result).toContain('视频');
      expect(result).toContain('音频');
    });
  });

  describe('isAudioFile', () => {
    it('should detect audio file types', async () => {
      const { __testables } = await import('../../plugin');
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
      const { __testables } = await import('../../plugin');
      const { getFfprobePath } = __testables as any;

      const result = getFfprobePath();

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });
});