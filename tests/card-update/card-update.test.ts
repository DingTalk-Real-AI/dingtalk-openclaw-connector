import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock axios
const mockAxiosPost = vi.hoisted(() => vi.fn());
const mockAxiosPut = vi.hoisted(() => vi.fn());
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } })),
    post: mockAxiosPost,
    put: mockAxiosPut,
  },
}));

vi.mock('../../src/utils/http-client.ts', () => ({
  dingtalkHttp: { post: mockAxiosPost, get: vi.fn(), put: mockAxiosPut, delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
  dingtalkOapiHttp: { get: vi.fn(), post: mockAxiosPost, put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
  dingtalkUploadHttp: { post: mockAxiosPost, get: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
}));

const log = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('card update regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAxiosPost.mockImplementation(async (url: string) => {
      // getAccessToken
      if (url === 'https://api.dingtalk.com/v1.0/oauth2/accessToken') {
        return { data: { accessToken: 'token123', expireIn: 7200 } };
      }
      // create / deliver
      return { status: 200, data: {} };
    });
    mockAxiosPut.mockResolvedValue({ status: 200, data: {} });
  });

  describe('createAICard (passive)', () => {
    it('should create card for direct message (user target)', async () => {
      const { __testables } = await import('../../test');
      const { createAICard } = __testables as any;

      const config = { clientId: 'robotCode', clientSecret: 'secret' };
      const data = {
        conversationType: '1',
        conversationId: undefined,
        senderStaffId: 'staff_1',
        senderId: 'sender_1',
      };

      const result = await createAICard(config, data, log);
      expect(result).not.toBeNull();
      expect(result.accessToken).toBe('token123');

      const deliverCall = mockAxiosPost.mock.calls.find((c) => String(c[0]).includes('/v1.0/card/instances/deliver'));
      expect(deliverCall).toBeDefined();
      expect(deliverCall![1].openSpaceId).toBe('dtv1.card//IM_ROBOT.staff_1');
    });

    it('should create card for group message (group target)', async () => {
      const { __testables } = await import('../../test');
      const { createAICard } = __testables as any;

      const config = { clientId: 'robotCode', clientSecret: 'secret' };
      const data = {
        conversationType: '2',
        conversationId: 'conv_123',
        senderStaffId: 'staff_1',
        senderId: 'sender_1',
      };

      const result = await createAICard(config, data, log);
      expect(result).not.toBeNull();

      const deliverCall = mockAxiosPost.mock.calls.find((c) => String(c[0]).includes('/v1.0/card/instances/deliver'));
      expect(deliverCall).toBeDefined();
      expect(deliverCall![1].openSpaceId).toBe('dtv1.card//IM_GROUP.conv_123');
    });
  });

  describe('streamAICard / finishAICard', () => {
    it('should set INPUTING once and stream content', async () => {
      const { __testables } = await import('../../test');
      const { streamAICard } = __testables as any;

      const card = { cardInstanceId: 'card_1', accessToken: 'token123', inputingStarted: false };
      await streamAICard(card, 'Hello', false, log);

      // 首次：会有两次 PUT（INPUTING + streaming）
      expect(mockAxiosPut).toHaveBeenCalled();
      expect(card.inputingStarted).toBe(true);
      expect(mockAxiosPut.mock.calls.some((c) => String(c[0]).includes('/v1.0/card/instances'))).toBe(true);
      expect(mockAxiosPut.mock.calls.some((c) => String(c[0]).includes('/v1.0/card/streaming'))).toBe(true);

      mockAxiosPut.mockClear();
      await streamAICard(card, 'Hello2', false, log);

      // 第二次：只走 streaming
      expect(mockAxiosPut.mock.calls.some((c) => String(c[0]).includes('/v1.0/card/instances'))).toBe(false);
      expect(mockAxiosPut.mock.calls.some((c) => String(c[0]).includes('/v1.0/card/streaming'))).toBe(true);
    });

    it('should throw if INPUTING update fails', async () => {
      const { __testables } = await import('../../test');
      const { streamAICard } = __testables as any;

      mockAxiosPut.mockImplementation(async (url: string) => {
        if (String(url).includes('/v1.0/card/instances')) throw new Error('Status update failed');
        return { status: 200, data: {} };
      });

      const card = { cardInstanceId: 'card_1', accessToken: 'token123', inputingStarted: false };
      await expect(streamAICard(card, 'Hello', false, log)).rejects.toThrow('Status update failed');
    });

    it('should finish card by finalizing stream and setting FINISHED', async () => {
      const { __testables } = await import('../../test');
      const { finishAICard } = __testables as any;

      const card = { cardInstanceId: 'card_1', accessToken: 'token123', inputingStarted: true };
      await finishAICard(card, 'Final', log);

      const streamingCall = mockAxiosPut.mock.calls.find((c) => String(c[0]).includes('/v1.0/card/streaming'));
      expect(streamingCall).toBeDefined();
      expect(streamingCall![1].isFinalize).toBe(true);

      const finishedCall = mockAxiosPut.mock.calls.find((c) => String(c[0]).includes('/v1.0/card/instances'));
      expect(finishedCall).toBeDefined();
      expect(finishedCall![1].cardData.cardParamMap.flowStatus).toBe('3');
    });
  });
});