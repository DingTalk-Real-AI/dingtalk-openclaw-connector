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

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('message sending helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // getAccessToken() 与真正发送都会走 axios.post，这里按 url 分流 mock。
    mockAxiosPost.mockImplementation(async (url: string) => {
      if (url === 'https://api.dingtalk.com/v1.0/oauth2/accessToken') {
        return { data: { accessToken: 'token123', expireIn: 7200 } };
      }
      return { data: { success: true } };
    });
  });

  describe('sendMarkdownMessage', () => {
    it('should send markdown message successfully', async () => {
      const { __testables } = await import('../test');
      const { sendMarkdownMessage } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };
      const result = await sendMarkdownMessage(config, 'https://webhook', 'Title', '# Content');

      expect(result).toBeDefined();
    });

    it('should include atUserId when provided', async () => {
      const { __testables } = await import('../test');
      const { sendMarkdownMessage } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };
      await sendMarkdownMessage(config, 'https://webhook', 'Title', 'Content', { atUserId: 'user123' });

      const webhookCall = mockAxiosPost.mock.calls.find((c) => c[0] === 'https://webhook');
      expect(webhookCall).toBeDefined();
      const body = webhookCall![1];
      expect(body.at).toBeDefined();
      expect(body.at.atUserIds).toEqual(['user123']);
      expect(body.markdown.text).toContain('@user123');
    });

    it('should use default title when not provided', async () => {
      const { __testables } = await import('../test');
      const { sendMarkdownMessage } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };
      await sendMarkdownMessage(config, 'https://webhook', '', 'Content');

      // Should not throw
    });
  });

  describe('sendTextMessage', () => {
    it('should send text message successfully', async () => {
      const { __testables } = await import('../test');
      const { sendTextMessage } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };
      const result = await sendTextMessage(config, 'https://webhook', 'Hello world');

      expect(result).toBeDefined();
    });

    it('should include atUserId when provided', async () => {
      const { __testables } = await import('../test');
      const { sendTextMessage } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };
      await sendTextMessage(config, 'https://webhook', 'Hello', { atUserId: 'user123' });

      const webhookCall = mockAxiosPost.mock.calls.find((c) => c[0] === 'https://webhook');
      expect(webhookCall).toBeDefined();
      const body = webhookCall![1];
      expect(body.at).toBeDefined();
      expect(body.at.atUserIds).toEqual(['user123']);
    });
  });

  describe('sendMessage', () => {
    it('should use markdown for content with markdown syntax', async () => {
      const { __testables } = await import('../test');
      const { sendMessage } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };

      // Content with markdown syntax
      await sendMessage(config, 'https://webhook', '# Title\n**Bold** text');

      // Should have called with markdown msgtype
      const webhookCall = mockAxiosPost.mock.calls.find((c) => c[0] === 'https://webhook');
      expect(webhookCall).toBeDefined();
      expect(webhookCall![1].msgtype).toBe('markdown');
    });

    it('should use markdown for multi-line content', async () => {
      const { __testables } = await import('../test');
      const { sendMessage } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };

      await sendMessage(config, 'https://webhook', 'Line 1\nLine 2\nLine 3');

      const webhookCall = mockAxiosPost.mock.calls.find((c) => c[0] === 'https://webhook');
      expect(webhookCall).toBeDefined();
      expect(webhookCall![1].msgtype).toBe('markdown');
    });

    it('should use text for plain single-line content', async () => {
      const { __testables } = await import('../test');
      const { sendMessage } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };

      await sendMessage(config, 'https://webhook', 'Plain text');

      const webhookCall = mockAxiosPost.mock.calls.find((c) => c[0] === 'https://webhook');
      expect(webhookCall).toBeDefined();
      expect(webhookCall![1].msgtype).toBe('text');
    });

    it('should force text when useMarkdown is false', async () => {
      const { __testables } = await import('../test');
      const { sendMessage } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };

      await sendMessage(config, 'https://webhook', '# Title', { useMarkdown: false });

      // Should use text format despite markdown content
      const webhookCall = mockAxiosPost.mock.calls.find((c) => c[0] === 'https://webhook');
      expect(webhookCall).toBeDefined();
      expect(webhookCall![1].msgtype).toBe('text');
    });

    it('should force markdown when useMarkdown is true', async () => {
      const { __testables } = await import('../test');
      const { sendMessage } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };

      await sendMessage(config, 'https://webhook', 'Plain text', { useMarkdown: true });

      const webhookCall = mockAxiosPost.mock.calls.find((c) => c[0] === 'https://webhook');
      expect(webhookCall).toBeDefined();
      expect(webhookCall![1].msgtype).toBe('markdown');
    });

    it('should use custom title when provided', async () => {
      const { __testables } = await import('../test');
      const { sendMessage } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };

      await sendMessage(config, 'https://webhook', '# Content', { useMarkdown: true, title: 'Custom Title' });

      const webhookCall = mockAxiosPost.mock.calls.find((c) => c[0] === 'https://webhook');
      expect(webhookCall).toBeDefined();
      expect(webhookCall![1].markdown.title).toBe('Custom Title');
    });

    it('should detect list syntax as markdown', async () => {
      const { __testables } = await import('../test');
      const { sendMessage } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };

      await sendMessage(config, 'https://webhook', '- Item 1\n- Item 2');

      const webhookCall = mockAxiosPost.mock.calls.find((c) => c[0] === 'https://webhook');
      expect(webhookCall).toBeDefined();
      expect(webhookCall![1].msgtype).toBe('markdown');
    });

    it('should detect code syntax as markdown', async () => {
      const { __testables } = await import('../test');
      const { sendMessage } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };

      await sendMessage(config, 'https://webhook', '`code` and ```block```');

      const webhookCall = mockAxiosPost.mock.calls.find((c) => c[0] === 'https://webhook');
      expect(webhookCall).toBeDefined();
      expect(webhookCall![1].msgtype).toBe('markdown');
    });

    it('should detect bold/italic syntax as markdown', async () => {
      const { __testables } = await import('../test');
      const { sendMessage } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };

      await sendMessage(config, 'https://webhook', '**bold** and *italic*');

      const webhookCall = mockAxiosPost.mock.calls.find((c) => c[0] === 'https://webhook');
      expect(webhookCall).toBeDefined();
      expect(webhookCall![1].msgtype).toBe('markdown');
    });

    it('should detect link syntax as markdown', async () => {
      const { __testables } = await import('../test');
      const { sendMessage } = __testables as any;

      const config = { clientId: 'test', clientSecret: 'secret' };

      await sendMessage(config, 'https://webhook', '[link](https://example.com)');

      const webhookCall = mockAxiosPost.mock.calls.find((c) => c[0] === 'https://webhook');
      expect(webhookCall).toBeDefined();
      expect(webhookCall![1].msgtype).toBe('markdown');
    });
  });
});