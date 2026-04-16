import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Integration tests for DingTalk OpenClaw Connector
 * 
 * These tests verify the end-to-end flow of the test.
 * They require actual DingTalk API credentials and should be run
 * in a controlled environment.
 * 
 * To run integration tests:
 * 1. Set DINGTALK_CLIENT_ID and DINGTALK_CLIENT_SECRET environment variables
 * 2. Set DINGTALK_TEST_USER_ID for user-specific tests
 * 3. Run: npm run test:integration
 */

// Skip all tests if integration test environment is not set up
const skipIntegration = !process.env.DINGTALK_CLIENT_ID || !process.env.DINGTALK_CLIENT_SECRET;

describe.skipIf(skipIntegration)('Integration Tests', () => {
  let config: { clientId: string; clientSecret: string };
  let testUserId: string;

  beforeEach(() => {
    config = {
      clientId: process.env.DINGTALK_CLIENT_ID!,
      clientSecret: process.env.DINGTALK_CLIENT_SECRET!,
    };
    testUserId = process.env.DINGTALK_TEST_USER_ID || 'test-user';
  });

  describe('Authentication', () => {
    it('should obtain access token', async () => {
      const { __testables } = await import('../test');
      const { getAccessToken } = __testables as any;

      const result = await getAccessToken(config);

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it('should fail with invalid credentials', async () => {
      const { __testables } = await import('../test');
      const { getAccessToken } = __testables as any;

      const invalidConfig = {
        clientId: 'invalid',
        clientSecret: 'invalid',
      };

      await expect(getAccessToken(invalidConfig)).rejects.toThrow();
    });
  });

  describe('Message Sending', () => {
    it('should send text message to user', async () => {
      const { __testables } = await import('../test');
      const { sendToUser } = __testables as any;

      const result = await sendToUser(config, testUserId, 'Integration test message', {
        useAICard: false,
      });

      expect(result.ok).toBe(true);
      expect(result.processQueryKey).toBeDefined();
    });

    it('should send markdown message to user', async () => {
      const { __testables } = await import('../test');
      const { sendToUser } = __testables as any;

      const result = await sendToUser(
        config,
        testUserId,
        '# Integration Test\n\nThis is a **markdown** message.',
        { useAICard: false }
      );

      expect(result.ok).toBe(true);
    });

    it('should send AI card to user', async () => {
      const { __testables } = await import('../test');
      const { sendToUser } = __testables as any;

      const result = await sendToUser(
        config,
        testUserId,
        'AI Card content for integration test',
        { useAICard: true }
      );

      expect(result.ok).toBe(true);
      // __testables 里的 sendToUser 使用 AI Card 时返回 cardInstanceId
      expect(result.cardInstanceId).toBeDefined();
    });
  });

  describe('Card Operations', () => {
    let cardInstanceId: string;
    let card: any;

    it('should create AI card', async () => {
      const { __testables } = await import('../test');
      const { createAICardForTarget } = __testables as any;

      const result = await createAICardForTarget(config, { type: 'user', userId: testUserId });

      expect(result).toBeDefined();
      expect(result?.cardInstanceId).toBeDefined();
      card = result;
      cardInstanceId = result.cardInstanceId;
    });

    it('should stream AI card content', async () => {
      if (!cardInstanceId || !card) {
        // Skip this test if card creation failed
        return;
      }

      const { __testables } = await import('../test');
      const { streamAICard } = __testables as any;

      await streamAICard(card, 'Streaming update content', false);

      expect(card.inputingStarted).toBe(true);
    });

    it('should finish AI card', async () => {
      if (!cardInstanceId || !card) {
        return;
      }

      const { __testables } = await import('../test');
      const { finishAICard } = __testables as any;

      await finishAICard(card, 'Final card content');

      expect(true).toBe(true);
    });
  });

  describe('Media Upload', () => {
    it('should upload image file', async () => {
      const { __testables } = await import('../test');
      const { uploadMediaToDingTalk, getOapiAccessToken } = __testables as any;

      // Get access token
      const token = await getOapiAccessToken(config);
      if (!token) {
        // Skip if token not available
        return;
      }

      // Create a test image file
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');

      const testImagePath = path.join(os.tmpdir(), 'test-image.png');
      // Create a minimal PNG file (1x1 pixel)
      const minimalPng = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
        0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
      ]);
      fs.writeFileSync(testImagePath, minimalPng);

      try {
        const result = await uploadMediaToDingTalk(testImagePath, 'image', token, 20 * 1024 * 1024);

        expect(result).toBeDefined();
        expect(result.length).toBeGreaterThan(0);
      } finally {
        // Cleanup
        fs.unlinkSync(testImagePath);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid user ID gracefully', async () => {
      const { __testables } = await import('../test');
      const { sendToUser } = __testables as any;

      const result = await sendToUser(config, 'invalid-user-id-12345', 'Test message', {
        useAICard: false,
      });

      // Should not throw, but may return error
      expect(result).toBeDefined();
    });

    it('should handle rate limiting', async () => {
      const { __testables } = await import('../test');
      const { sendToUser } = __testables as any;

      // Send multiple messages rapidly
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          sendToUser(config, testUserId, `Rate limit test ${i}`, { useAICard: false })
        );
      }

      const results = await Promise.all(promises);

      // All should complete without throwing
      results.forEach((result) => {
        expect(result).toBeDefined();
      });
    });
  });
});

describe('Integration Test Setup', () => {
  it('should have required environment variables for integration tests', () => {
    // This test always runs to document what's needed for integration tests
    if (skipIntegration) {
      console.log('Integration tests skipped. To run them, set:');
      console.log('  DINGTALK_CLIENT_ID=your_client_id');
      console.log('  DINGTALK_CLIENT_SECRET=your_client_secret');
      console.log('  DINGTALK_TEST_USER_ID=your_test_user_id (optional)');
    }

    // Always pass - this is just documentation
    expect(true).toBe(true);
  });
});