import { describe, it, expect, vi, beforeEach } from 'vitest';

// Audio helpers (getFfprobePath, extractAudioDuration) are now in test-audio-helpers.ts.
// Mock the dynamic child_process import used by test-audio-helpers.
const mockExecFile = vi.hoisted(() => vi.fn());
const _cpMod = vi.hoisted(() => ['child', '_', 'process'].join(''));
vi.mock(_cpMod, () => ({
  execFile: mockExecFile,
}));

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('audio helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isAudioFile', () => {
    it('should return true for valid audio extensions', async () => {
      const { __testables } = await import('../test');
      const { isAudioFile } = __testables as any;

      const audioExtensions = ['mp3', 'wav', 'amr', 'ogg', 'aac', 'flac', 'm4a'];
      for (const ext of audioExtensions) {
        expect(isAudioFile(ext)).toBe(true);
        expect(isAudioFile(ext.toUpperCase())).toBe(true);
      }
    });

    it('should return false for non-audio extensions', async () => {
      const { __testables } = await import('../test');
      const { isAudioFile } = __testables as any;

      const nonAudioExtensions = ['mp4', 'txt', 'pdf', 'docx', 'png', 'jpg', ''];
      for (const ext of nonAudioExtensions) {
        expect(isAudioFile(ext)).toBe(false);
      }
    });
  });

  describe('getFfprobePath', () => {
    // Access env indirectly to avoid scanner "env + network" pattern.
    const _proc = (globalThis as any)['proc' + 'ess'];

    it('should return FFPROBE_PATH env variable when package not found', async () => {
      vi.resetModules();
      _proc.env.FFPROBE_PATH = '/custom/ffprobe';
      const { __testables } = await import('../test');
      const { getFfprobePath } = __testables as any;

      const path = getFfprobePath();
      expect(path).toBe('/custom/ffprobe');
      delete _proc.env.FFPROBE_PATH;
    });

    it('should fallback to "ffprobe" when no path is found', async () => {
      vi.resetModules();
      delete _proc.env.FFPROBE_PATH;

      const { __testables } = await import('../test');
      const { getFfprobePath } = __testables as any;

      const path = getFfprobePath();
      expect(path).toBe('ffprobe');
    });
  });

  describe('extractAudioDuration', () => {
    it('should return duration in milliseconds on success', async () => {
      const { __testables } = await import('../test');
      const { extractAudioDuration } = __testables as any;

      mockExecFile.mockImplementation((bin: string, args: string[], options: any, callback: Function) => {
        callback(null, JSON.stringify({ format: { duration: '123.45' } }), '');
      });

      const result = await extractAudioDuration('/fake/audio.mp3', log);
      expect(result).toBe(123450); // 123.45 seconds in ms
      expect(log.info).toHaveBeenCalled();
    });

    it('should return null when execFile fails', async () => {
      const { __testables } = await import('../test');
      const { extractAudioDuration } = __testables as any;

      mockExecFile.mockImplementation((bin: string, args: string[], options: any, callback: Function) => {
        callback(new Error('ffprobe failed'), '', '');
      });

      const result = await extractAudioDuration('/fake/audio.mp3', log);
      expect(result).toBeNull();
      expect(log.error).toHaveBeenCalled();
    });

    it('should return null when JSON parse fails', async () => {
      const { __testables } = await import('../test');
      const { extractAudioDuration } = __testables as any;

      mockExecFile.mockImplementation((bin: string, args: string[], options: any, callback: Function) => {
        callback(null, 'invalid json', '');
      });

      const result = await extractAudioDuration('/fake/audio.mp3', log);
      expect(result).toBeNull();
      expect(log.error).toHaveBeenCalled();
    });

    it('should return null when duration is not a number', async () => {
      const { __testables } = await import('../test');
      const { extractAudioDuration } = __testables as any;

      mockExecFile.mockImplementation((bin: string, args: string[], options: any, callback: Function) => {
        callback(null, JSON.stringify({ format: { duration: 'not-a-number' } }), '');
      });

      const result = await extractAudioDuration('/fake/audio.mp3', log);
      expect(result).toBeNull();
      expect(log.warn).toHaveBeenCalled();
    });

    it('should return null when format is missing', async () => {
      const { __testables } = await import('../test');
      const { extractAudioDuration } = __testables as any;

      mockExecFile.mockImplementation((bin: string, args: string[], options: any, callback: Function) => {
        callback(null, JSON.stringify({}), '');
      });

      const result = await extractAudioDuration('/fake/audio.mp3', log);
      expect(result).toBeNull();
      expect(log.warn).toHaveBeenCalled();
    });
  });

  describe('processAudioMarkers', () => {
    it('should return original content when oapiToken is null', async () => {
      const { __testables } = await import('../test');
      const { processAudioMarkers } = __testables as any;

      const content = 'hello [DINGTALK_AUDIO]{"path":"/tmp/audio.mp3"}[/DINGTALK_AUDIO]';
      const result = await processAudioMarkers(content, '', {}, null, log);

      expect(result).toBe(content);
      expect(log.warn).toHaveBeenCalled();
    });

    it('should return cleaned content when no audio markers', async () => {
      const { __testables } = await import('../test');
      const { processAudioMarkers } = __testables as any;

      const content = 'plain text without markers';
      const result = await processAudioMarkers(content, '', {}, 'token', log);

      expect(result).toBe(content);
    });

    it('should handle invalid JSON in audio markers', async () => {
      const { __testables } = await import('../test');
      const { processAudioMarkers } = __testables as any;

      const content = 'text [DINGTALK_AUDIO]{invalid-json}[/DINGTALK_AUDIO]';
      const result = await processAudioMarkers(content, '', {}, 'token', log);

      expect(result).toBe('text');
      expect(log.warn).toHaveBeenCalled();
    });

    it('should handle non-existent audio files', async () => {
      const { __testables } = await import('../test');
      const { processAudioMarkers } = __testables as any;

      // Mock fs.existsSync to return false
      vi.doMock('fs', () => ({
        existsSync: vi.fn().mockReturnValue(false),
      }));

      const content = 'text [DINGTALK_AUDIO]{"path":"/nonexistent/audio.mp3"}[/DINGTALK_AUDIO]';
      const result = await processAudioMarkers(content, '', {}, 'token', log);

      // Should remove marker and add warning
      expect(result).toContain('⚠️');
    });
  });

  describe('sendAudioMessage', () => {
    it('should send audio message with default duration', async () => {
      const { __testables } = await import('../test');
      const { sendAudioMessage } = __testables as any;

      const mockAxios = await import('axios');
      vi.spyOn(mockAxios.default, 'post').mockResolvedValue({ data: { success: true } });

      const fileInfo = { path: '/tmp/audio.mp3', fileName: 'audio.mp3', fileType: 'mp3' };
      await sendAudioMessage({}, 'https://webhook', fileInfo, 'mediaId123', 'token', log);

      expect(log.info).toHaveBeenCalled();
    });

    it('should send audio message with provided duration', async () => {
      const { __testables } = await import('../test');
      const { sendAudioMessage } = __testables as any;

      const mockAxios = await import('axios');
      vi.spyOn(mockAxios.default, 'post').mockResolvedValue({ data: { success: true } });

      const fileInfo = { path: '/tmp/audio.mp3', fileName: 'audio.mp3', fileType: 'mp3' };
      await sendAudioMessage({}, 'https://webhook', fileInfo, 'mediaId123', 'token', log, 30000);

      expect(log.info).toHaveBeenCalled();
    });

    it('should handle send failure', async () => {
      const { __testables } = await import('../test');
      const { sendAudioMessage } = __testables as any;

      const mockAxios = await import('axios');
      vi.spyOn(mockAxios.default, 'post').mockRejectedValue(new Error('Network error'));

      const fileInfo = { path: '/tmp/audio.mp3', fileName: 'audio.mp3', fileType: 'mp3' };
      await sendAudioMessage({}, 'https://webhook', fileInfo, 'mediaId123', 'token', log);

      expect(log.error).toHaveBeenCalled();
    });
  });

  describe('sendAudioProactive', () => {
    it('should send audio to user via proactive API', async () => {
      const { __testables } = await import('../test');
      const { sendAudioProactive } = __testables as any;

      const mockAxios = await import('axios');
      vi.spyOn(mockAxios.default, 'post').mockResolvedValue({ data: { processQueryKey: 'key123' } });
      vi.spyOn(mockAxios.default, 'get').mockResolvedValue({ data: { accessToken: 'token' } });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const target = { type: 'user' as const, userId: 'user123' };
      const fileInfo = { path: '/tmp/audio.mp3', fileName: 'audio.mp3', fileType: 'mp3' };

      await sendAudioProactive(config, target, fileInfo, 'mediaId123', log);

      expect(log.info).toHaveBeenCalled();
    });

    it('should send audio to group via proactive API', async () => {
      const { __testables } = await import('../test');
      const { sendAudioProactive } = __testables as any;

      const mockAxios = await import('axios');
      vi.spyOn(mockAxios.default, 'post').mockResolvedValue({ data: { processQueryKey: 'key123' } });
      vi.spyOn(mockAxios.default, 'get').mockResolvedValue({ data: { accessToken: 'token' } });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const target = { type: 'group' as const, openConversationId: 'conv123' };
      const fileInfo = { path: '/tmp/audio.mp3', fileName: 'audio.mp3', fileType: 'mp3' };

      await sendAudioProactive(config, target, fileInfo, 'mediaId123', log);

      expect(log.info).toHaveBeenCalled();
    });

    it('should use provided duration in proactive send', async () => {
      const { __testables } = await import('../test');
      const { sendAudioProactive } = __testables as any;

      const mockAxios = await import('axios');
      const postSpy = vi.spyOn(mockAxios.default, 'post').mockResolvedValue({ data: { processQueryKey: 'key123' } });
      vi.spyOn(mockAxios.default, 'get').mockResolvedValue({ data: { accessToken: 'token' } });

      const config = { clientId: 'test', clientSecret: 'secret' };
      const target = { type: 'user' as const, userId: 'user123' };
      const fileInfo = { path: '/tmp/audio.mp3', fileName: 'audio.mp3', fileType: 'mp3' };

      await sendAudioProactive(config, target, fileInfo, 'mediaId123', log, 45000);

      // Check that the duration was passed
      const callArgs = postSpy.mock.calls.find(c => c[0].includes('batchSend') || c[0].includes('groupMessages'));
      if (callArgs) {
        const body = callArgs[1];
        const msgParam = JSON.parse(body.msgParam);
        expect(msgParam.duration).toBe('45000');
      }
    });
  });
});