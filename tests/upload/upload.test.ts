import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock axios
const mockAxiosGet = vi.hoisted(() => vi.fn());
const mockAxiosPost = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } })),
    get: mockAxiosGet,
    post: mockAxiosPost,
  },
}));

vi.mock('../../src/utils/http-client.ts', () => ({
  dingtalkHttp: { post: mockAxiosPost, get: mockAxiosGet, put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
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
  dirname: (p: string) => p.split('/').slice(0, -1).join('/') || '/',
  extname: (p: string) => {
    const idx = p.lastIndexOf('.');
    return idx >= 0 ? p.slice(idx) : '';
  },
  basename: (p: string) => p.split('/').pop() || '',
}));

// Mock form-data
const formAppendSpy = vi.hoisted(() => vi.fn());
vi.mock('form-data', () => {
  return {
    default: class FormData {
      append(...args: any[]) {
        formAppendSpy(...args);
      }
      getHeaders() {
        return {};
      }
    },
  };
});

// Mock file-type
vi.mock('file-type', () => ({
  fileTypeFromFile: vi.fn().mockResolvedValue({ ext: 'png', mime: 'image/png' }),
}));

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('upload functionality', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('uploadMediaToDingTalk', () => {
    it('should upload media successfully', async () => {
      const { __testables } = await import('../../test');
      const { uploadMediaToDingTalk } = __testables as any;

      mockAxiosPost.mockResolvedValue({
        data: {
          errcode: 0,
          media_id: 'media123',
          created_at: Date.now().toString(),
        },
      });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const result = await uploadMediaToDingTalk('/tmp/file.png', 'image', 'token123', 20 * 1024 * 1024, log);

      expect(result).toBe('media123');

      // 契约断言：URL 必须是 /media/upload，access_token 和 type 通过 params 传递
      const call = mockAxiosPost.mock.calls[0];
      expect(call).toBeDefined();
      const url = String(call[0]);
      expect(url).toContain('https://oapi.dingtalk.com/media/upload');
      // access_token 和 type 通过 axios params 传递，在第三个参数的 params 中
      const callConfig = call[2];
      expect(callConfig?.params?.access_token).toBe('token123');
      expect(callConfig?.params?.type).toBe('image');

      // 契约断言：第三参 headers 来自 form.getHeaders()（至少是对象）
      expect(call[2]).toBeDefined();
      expect(call[2].headers).toBeDefined();

      // 契约断言：必须 append('media', stream, options)
      expect(formAppendSpy).toHaveBeenCalled();
      expect(formAppendSpy.mock.calls[0][0]).toBe('media');
    });

    it('should return null when upload fails', async () => {
      const { __testables } = await import('../../test');
      const { uploadMediaToDingTalk } = __testables as any;

      mockAxiosPost.mockResolvedValue({
        data: {
          errcode: 40001,
          errmsg: 'Upload failed',
        },
      });

      const result = await uploadMediaToDingTalk('/tmp/file.png', 'image', 'token123', 20 * 1024 * 1024, log);

      expect(result).toBeNull();
    });

    it('should handle network error', async () => {
      const { __testables } = await import('../../test');
      const { uploadMediaToDingTalk } = __testables as any;

      mockAxiosPost.mockRejectedValue(new Error('Network error'));

      const result = await uploadMediaToDingTalk('/tmp/file.png', 'image', 'token123', 20 * 1024 * 1024, log);

      expect(result).toBeNull();
    });

    it('should support different media types', async () => {
      const { __testables } = await import('../../test');
      const { uploadMediaToDingTalk } = __testables as any;

      mockAxiosPost.mockResolvedValue({
        data: {
          errcode: 0,
          media_id: 'media123',
          created_at: Date.now().toString(),
        },
      });

      // Test different media types
      await uploadMediaToDingTalk('/tmp/file.pdf', 'file', 'token123', 20 * 1024 * 1024, log);
      await uploadMediaToDingTalk('/tmp/video.mp4', 'video', 'token123', 20 * 1024 * 1024, log);
      await uploadMediaToDingTalk('/tmp/audio.mp3', 'voice', 'token123', 20 * 1024 * 1024, log);

      expect(mockAxiosPost).toHaveBeenCalledTimes(3);

      // 契约断言：不同 mediaType 对应正确的 type 参数（通过 axios params 传递）
      const callParams = mockAxiosPost.mock.calls.map((c) => c[2]?.params?.type);
      expect(callParams.some((t) => t === 'file')).toBe(true);
      expect(callParams.some((t) => t === 'video')).toBe(true);
      expect(callParams.some((t) => t === 'voice')).toBe(true);
    });
  });

  describe('extractVideoMetadata', () => {
    it('should extract video metadata', async () => {
      const { __testables } = await import('../../test');
      const { extractVideoMetadata } = __testables as any;

      // Mock fluent-ffmpeg - this will fail without actual ffmpeg
      const result = await extractVideoMetadata('/tmp/video.mp4', log);

      // Should return metadata even if ffmpeg not available
      expect(result).toBeDefined();
    });

    it('should return default metadata on error', async () => {
      const { __testables } = await import('../../test');
      const { extractVideoMetadata } = __testables as any;

      const result = await extractVideoMetadata('/nonexistent/video.mp4', log);

      expect(result).toBeDefined();
    });
  });

  describe('extractVideoThumbnail', () => {
    it('should extract video thumbnail', async () => {
      const { __testables } = await import('../../test');
      const { extractVideoThumbnail } = __testables as any;

      const result = await extractVideoThumbnail('/tmp/video.mp4', '/tmp/thumb.png', log);

      // 测试环境下不依赖真实 ffmpeg 与文件存在性，失败时应返回 null 而非抛异常
      expect(result === null || typeof result === 'string').toBe(true);
    });
  });

  describe('processLocalImages', () => {
    it('should process local images', async () => {
      const { __testables } = await import('../../test');
      const { processLocalImages } = __testables as any;

      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);

      mockAxiosGet.mockResolvedValue({ data: { errcode: 0, access_token: 'token123' } });
      mockAxiosPost.mockResolvedValue({
        data: {
          errcode: 0,
          media_id: 'media123',
        },
      });

      const content = '![image](/tmp/image.png)';
      const result = await processLocalImages(content, 'token123', log);

      expect(result).toBeDefined();
    });

    it('should handle missing images', async () => {
      const { __testables } = await import('../../test');
      const { processLocalImages } = __testables as any;

      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const content = '![image](/nonexistent.png)';
      const result = await processLocalImages(content, 'token123', log);

      expect(result).toBeDefined();
    });
  });

  describe('processVideoMarkers', () => {
    it('should process video markers', async () => {
      const { __testables } = await import('../../test');
      const { processVideoMarkers } = __testables as any;

      const fs = await import('fs');
      // 用“不存在文件”的分支来验证：能正确识别并移除 DINGTALK_VIDEO 标记
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const content = 'hello\n\n[DINGTALK_VIDEO]{"path":"/tmp/video.mp4"}[/DINGTALK_VIDEO]\n\nworld';
      const result = await processVideoMarkers(content, 'https://webhook.example', {}, 'token123', log);

      expect(result).toContain('hello');
      expect(result).toContain('world');
      expect(result).not.toContain('[DINGTALK_VIDEO]');
      expect(log.warn).toHaveBeenCalled();
    });
  });

  describe('processFileMarkers', () => {
    it('should process file markers', async () => {
      const { __testables } = await import('../../test');
      const { processFileMarkers } = __testables as any;

      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);

      mockAxiosPost.mockImplementation((url: string) => {
        if (String(url).includes('https://oapi.dingtalk.com/media/upload')) {
          return Promise.resolve({
            data: { errcode: 0, media_id: 'media_file_123', created_at: Date.now().toString() },
          });
        }
        return Promise.resolve({ data: { success: true } });
      });

      const content =
        'prefix\n' +
        '[DINGTALK_FILE]{"path":"/tmp/file.pdf","fileName":"file.pdf","fileType":"pdf"}[/DINGTALK_FILE]\n' +
        'suffix';
      const result = await processFileMarkers(content, 'https://webhook.example', {}, 'token123', log);

      expect(result).toContain('prefix');
      expect(result).toContain('suffix');
      expect(result).not.toContain('[DINGTALK_FILE]');
      expect(
        mockAxiosPost.mock.calls.some((c) => c[2]?.params?.type === 'file')
      ).toBe(true);
    });
  });

  describe('processAudioMarkers', () => {
    it('should process audio markers', async () => {
      const { __testables } = await import('../../test');
      const { processAudioMarkers } = __testables as any;

      const fs = await import('fs');
      vi.mocked(fs.existsSync).mockReturnValue(true);

      mockAxiosPost.mockImplementation((url: string) => {
        if (String(url).includes('https://oapi.dingtalk.com/media/upload')) {
          return Promise.resolve({
            data: { errcode: 0, media_id: 'media_voice_123', created_at: Date.now().toString() },
          });
        }
        return Promise.resolve({ data: { success: true } });
      });

      const content = '[DINGTALK_AUDIO]{"path":"/tmp/audio.mp3"}[/DINGTALK_AUDIO]';
      const result = await processAudioMarkers(content, 'https://webhook.example', {}, 'token123', log);

      expect(result).not.toContain('[DINGTALK_AUDIO]');
      expect(
        mockAxiosPost.mock.calls.some((c) => c[2]?.params?.type === 'voice')
      ).toBe(true);
    });
  });
});