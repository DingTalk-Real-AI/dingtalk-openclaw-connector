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
  statSync: vi.fn().mockReturnValue({ size: 1024 }),
  createReadStream: vi.fn().mockReturnValue('mock-stream'),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Mock path
vi.mock('path', () => ({
  join: (...args: string[]) => args.join('/'),
  extname: (p: string) => {
    const idx = p.lastIndexOf('.');
    return idx >= 0 ? p.slice(idx) : '';
  },
  basename: (p: string) => p.split('/').pop() || '',
}));

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('MCP tools integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sendToUser for MCP', () => {
    it('should send text message to user', async () => {
      const { __testables } = await import('../../test');
      const { sendToUser } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const result = await sendToUser(config, 'user123', 'Hello world', { useAICard: false, log });

      expect(result.ok).toBe(true);
    });

    it('should send markdown message to user', async () => {
      const { __testables } = await import('../../test');
      const { sendToUser } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const result = await sendToUser(config, 'user123', '# Title\n**Bold** text', { useAICard: false, log });

      expect(result.ok).toBe(true);
    });

    it('should return error when userId is missing', async () => {
      const { __testables } = await import('../../test');
      const { sendToUser } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };
      const result = await sendToUser(config, '', 'Hello', { useAICard: false, log });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('should return error when clientId is missing', async () => {
      const { __testables } = await import('../../test');
      const { sendToUser } = __testables as any;

      const result = await sendToUser({}, 'user123', 'Hello', { log });

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Missing');
    });
  });

  describe('sendToGroup for MCP', () => {
    it('should send message to group', async () => {
      const { __testables } = await import('../../test');
      const { sendToGroup } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const result = await sendToGroup(config, 'conv123', 'Hello group', { useAICard: false, log });

      expect(result.ok).toBe(true);
    });

    it('should return error when openConversationId is missing', async () => {
      const { __testables } = await import('../../test');
      const { sendToGroup } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };
      const result = await sendToGroup(config, '', 'Hello', { useAICard: false, log });

      expect(result.ok).toBe(false);
    });
  });

  describe('sendProactive for MCP', () => {
    it('should send message to user via userId', async () => {
      const { __testables } = await import('../../test');
      const { sendProactive } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const result = await sendProactive(config, { userId: 'user123' }, 'Hello', { useAICard: false, log });

      expect(result.ok).toBe(true);
    });

    it('should send message to user via userIds array', async () => {
      const { __testables } = await import('../../test');
      const { sendProactive } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const result = await sendProactive(config, { userIds: ['user1', 'user2'] }, 'Hello', { useAICard: false, log });

      expect(result.ok).toBe(true);
    });

    it('should send message to group via openConversationId', async () => {
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

  describe('sendFileProactive for MCP', () => {
    it('should send file to user', async () => {
      const { __testables } = await import('../../test');
      const { sendFileProactive } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const target = { type: 'user' as const, userId: 'user123' };
      const fileInfo = { path: '/tmp/file.pdf', fileName: 'document.pdf', fileType: 'pdf' };

      await sendFileProactive(config, target, fileInfo, 'mediaId123', log);

      expect(log.info).toHaveBeenCalled();
    });

    it('should send file to group', async () => {
      const { __testables } = await import('../../test');
      const { sendFileProactive } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const target = { type: 'group' as const, openConversationId: 'conv123' };
      const fileInfo = { path: '/tmp/file.pdf', fileName: 'document.pdf', fileType: 'pdf' };

      await sendFileProactive(config, target, fileInfo, 'mediaId123', log);

      expect(log.info).toHaveBeenCalled();
    });
  });

  describe('sendVideoProactive for MCP', () => {
    it('should send video to user', async () => {
      const { __testables } = await import('../../test');
      const { sendVideoProactive } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const target = { type: 'user' as const, userId: 'user123' };
      const metadata = { duration: 60, width: 1920, height: 1080 };

      await sendVideoProactive(config, target, 'videoMediaId', 'picMediaId', metadata, log);

      expect(log.info).toHaveBeenCalled();
    });

    it('should send video to group', async () => {
      const { __testables } = await import('../../test');
      const { sendVideoProactive } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const target = { type: 'group' as const, openConversationId: 'conv123' };
      const metadata = { duration: 60, width: 1920, height: 1080 };

      await sendVideoProactive(config, target, 'videoMediaId', 'picMediaId', metadata, log);

      expect(log.info).toHaveBeenCalled();
    });
  });

  describe('sendAudioProactive for MCP', () => {
    it('should send audio to user', async () => {
      const { __testables } = await import('../../test');
      const { sendAudioProactive } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const target = { type: 'user' as const, userId: 'user123' };
      const fileInfo = { path: '/tmp/audio.mp3', fileName: 'audio.mp3', fileType: 'mp3' };

      await sendAudioProactive(config, target, fileInfo, 'audioMediaId', log, 60000);

      expect(log.info).toHaveBeenCalled();
    });

    it('should send audio to group', async () => {
      const { __testables } = await import('../../test');
      const { sendAudioProactive } = __testables as any;

      mockAxiosPost.mockResolvedValue({ data: { processQueryKey: 'key123' } });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const target = { type: 'group' as const, openConversationId: 'conv123' };
      const fileInfo = { path: '/tmp/audio.mp3', fileName: 'audio.mp3', fileType: 'mp3' };

      await sendAudioProactive(config, target, fileInfo, 'audioMediaId', log);

      expect(log.info).toHaveBeenCalled();
    });
  });

  describe('uploadMediaToDingTalk for MCP', () => {
    it('should upload media successfully', async () => {
      const { __testables } = await import('../../test');
      const { uploadMediaToDingTalk } = __testables as any;

      mockAxiosGet.mockResolvedValue({ data: { errcode: 0, access_token: 'token123' } });
      mockAxiosPost.mockResolvedValue({
        data: {
          errcode: 0,
          media_id: 'media123',
          created_at: Date.now().toString(),
        },
      });

      const result = await uploadMediaToDingTalk('/tmp/file.png', 'image', 'token123', 20 * 1024 * 1024, log);

      expect(result).toBe('media123');
    });

    it('should handle upload failure', async () => {
      const { __testables } = await import('../../test');
      const { uploadMediaToDingTalk } = __testables as any;

      mockAxiosPost.mockResolvedValue({
        data: {
          errcode: 1,
          errmsg: 'Upload failed',
        },
      });

      const result = await uploadMediaToDingTalk('/tmp/file.png', 'image', 'token123', 20 * 1024 * 1024, log);

      expect(result).toBeNull();
    });
  });

  describe('extractMessageContent for MCP', () => {
    it('should extract text content', async () => {
      const { __testables } = await import('../../test');
      const { extractMessageContent } = __testables as any;

      const data = {
        msgtype: 'text',
        text: { content: 'Hello world' },
      };

      const result = extractMessageContent(data);

      expect(result.text).toBe('Hello world');
    });

    it('should extract markdown content', async () => {
      const { __testables } = await import('../../test');
      const { extractMessageContent } = __testables as any;

      const data = {
        msgtype: 'markdown',
        text: { content: '# Content' },
      };

      const result = extractMessageContent(data);

      // 当前实现对未知 msgtype 会回退为 `[${msgtype}消息]`，但仍会优先用 text.content
      expect(result.text).toContain('# Content');
    });
  });
});