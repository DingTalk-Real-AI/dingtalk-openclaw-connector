import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());
const mockAxiosPost = vi.hoisted(() => vi.fn());
const mockAxiosGet = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));
vi.mock('path', () => ({
  join: (...args: string[]) => args.join('/'),
  extname: (value: string) => {
    const index = value.lastIndexOf('.');
    return index >= 0 ? value.slice(index) : '';
  },
}));
vi.mock('os', () => ({
  homedir: () => '/fake-home',
}));
vi.mock('axios', () => ({
  default: {
    post: mockAxiosPost,
    get: mockAxiosGet,
  },
}));

let handleDingTalkMessage: (params: any) => Promise<void>;
let setRuntimeForTest: (runtime: any) => void;

function createSseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  const payload = `${chunks.map((chunk) => `data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) {
              return { done: true, value: undefined };
            }
            sent = true;
            return { done: false, value: encoder.encode(payload) };
          },
        };
      },
    },
  };
}

describe('group routing bindings', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        bindings: [
          { agentId: 'group-agent', match: { channel: 'dingtalk-connector', peer: { kind: 'group', id: 'cid-1' } } },
        ],
      }),
    );
    mockAxiosGet.mockResolvedValue({ data: {} });
    mockAxiosPost.mockImplementation(async (url: string) => {
      if (url === 'https://api.dingtalk.com/v1.0/oauth2/accessToken') {
        return { data: { accessToken: 'token-1', expireIn: 3600 } };
      }
      if (url.includes('/v1.0/card/instances')) {
        throw new Error('disable AI card in test');
      }
      return { data: { ok: true } };
    });
    mockFetch.mockResolvedValue(createSseResponse(['hello from gateway']));
    vi.stubGlobal('fetch', mockFetch);

    const { __testables } = await import('../../plugin');
    handleDingTalkMessage = (__testables as any).handleDingTalkMessage;
    setRuntimeForTest = (__testables as any).setRuntimeForTest;
    setRuntimeForTest({ gateway: { port: 18789 } });
  });

  it.each([false, true])('should route group binding by conversationId when asyncMode=%s', async (asyncMode) => {
    await handleDingTalkMessage({
      cfg: { gateway: { port: 18789 } },
      accountId: 'acc1',
      sessionWebhook: 'https://example.com/session-webhook',
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      dingtalkConfig: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        gatewayBaseUrl: 'http://127.0.0.1:18789',
        gatewayToken: 'gateway-token',
        enableMediaUpload: false,
        separateSessionByConversation: true,
        groupSessionScope: 'group',
        asyncMode,
      },
      data: {
        msgtype: 'text',
        text: { content: 'hello bot' },
        conversationType: '2',
        conversationId: 'cid-1',
        conversationTitle: 'Test Group',
        senderId: 'u-1',
        senderNick: 'Alice',
        sessionWebhook: 'https://example.com/session-webhook',
      },
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, requestInit] = mockFetch.mock.calls[0];
    expect((requestInit as any).headers['X-OpenClaw-Agent-Id']).toBe('group-agent');
  });
});
