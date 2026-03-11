/**
 * Session 管理模块测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MESSAGE_DEDUP_TTL } from '../src/constants';

describe('Session Management', () => {
  beforeEach(() => {
    // 通过重置模块缓存，隔离 session.ts 内部 Map 状态，避免用例互相污染
    vi.resetModules();
    vi.restoreAllMocks();
  });

  describe('isMessageProcessed', () => {
    it('should return false for new message', async () => {
      const { isMessageProcessed } = await import('../src/session');
      expect(isMessageProcessed('msg-123')).toBe(false);
    });

    it('should return true for processed message', async () => {
      const { markMessageProcessed, isMessageProcessed } = await import('../src/session');
      markMessageProcessed('msg-123');
      expect(isMessageProcessed('msg-123')).toBe(true);
    });

    it('should return false for empty messageId', async () => {
      const { isMessageProcessed } = await import('../src/session');
      expect(isMessageProcessed('')).toBe(false);
    });

    it('should ignore empty messageId when marking processed', async () => {
      const { markMessageProcessed, isMessageProcessed } = await import('../src/session');
      markMessageProcessed('');
      expect(isMessageProcessed('')).toBe(false);
    });

    it('should not cleanup when size is below threshold', async () => {
      const { markMessageProcessed, isMessageProcessed } = await import('../src/session');
      for (let i = 0; i < 99; i++) {
        markMessageProcessed(`msg-${i}`);
      }
      for (let i = 0; i < 99; i++) {
        expect(isMessageProcessed(`msg-${i}`)).toBe(true);
      }
    });

    it('should cleanup expired processed messages when size exceeds threshold', async () => {
      const { markMessageProcessed, isMessageProcessed } = await import('../src/session');
      const nowSpy = vi.spyOn(Date, 'now');
      let currentTime = 1_000_000;
      nowSpy.mockImplementation(() => currentTime);

      // 标记足够多的消息，触发清理逻辑
      for (let i = 0; i < 100; i++) {
        markMessageProcessed(`msg-old-${i}`);
      }

      // 时间前进到超过 TTL
      currentTime += MESSAGE_DEDUP_TTL + 1;

      // 再标记一条新消息，触发 cleanupProcessedMessages
      const newMsgId = 'msg-new';
      markMessageProcessed(newMsgId);

      // 旧消息应被清理，新消息仍然存在
      for (let i = 0; i < 100; i++) {
        expect(isMessageProcessed(`msg-old-${i}`)).toBe(false);
      }
      expect(isMessageProcessed(newMsgId)).toBe(true);

      nowSpy.mockRestore();
    });
  });

  describe('isNewSessionCommand', () => {
    it('should recognize /new command', async () => {
      const { isNewSessionCommand } = await import('../src/session');
      expect(isNewSessionCommand('/new')).toBe(true);
    });

    it('should recognize 新会话 command', async () => {
      const { isNewSessionCommand } = await import('../src/session');
      expect(isNewSessionCommand('新会话')).toBe(true);
    });

    it('should recognize case-insensitive commands', async () => {
      const { isNewSessionCommand } = await import('../src/session');
      expect(isNewSessionCommand('/NEW')).toBe(true);
      expect(isNewSessionCommand('新会话')).toBe(true);
    });

    it('should recognize other configured commands', async () => {
      const { isNewSessionCommand } = await import('../src/session');
      expect(isNewSessionCommand('/reset')).toBe(true);
      expect(isNewSessionCommand('/clear')).toBe(true);
      expect(isNewSessionCommand('重新开始')).toBe(true);
      expect(isNewSessionCommand('清空对话')).toBe(true);
    });

    it('should handle surrounding whitespace', async () => {
      const { isNewSessionCommand } = await import('../src/session');
      expect(isNewSessionCommand('   /new  ')).toBe(true);
      expect(isNewSessionCommand('   新会话  ')).toBe(true);
    });

    it('should return false for empty or whitespace-only text', async () => {
      const { isNewSessionCommand } = await import('../src/session');
      expect(isNewSessionCommand('')).toBe(false);
      expect(isNewSessionCommand('   ')).toBe(false);
    });

    it('should return false for normal message', async () => {
      const { isNewSessionCommand } = await import('../src/session');
      expect(isNewSessionCommand('hello')).toBe(false);
    });
  });

  describe('getSessionKey', () => {
    it('should create initial session key for new user (no timestamp)', async () => {
      const { getSessionKey } = await import('../src/session');
      const result = getSessionKey('user-123', 'account-1', false, 1800000);
      expect(result.isNew).toBe(false);
      expect(result.sessionKey).toBe('dingtalk-connector:account-1:user-123');
    });

    it('should create new session when forceNew is true (timestamped key)', async () => {
      const { getSessionKey } = await import('../src/session');
      const nowSpy = vi.spyOn(Date, 'now');
      nowSpy.mockReturnValue(4_000_000);

      const result1 = getSessionKey('user-123', 'account-1', false, 1800000);
      const result2 = getSessionKey('user-123', 'account-1', true, 1800000);
      expect(result2.isNew).toBe(true);
      expect(result2.sessionKey).not.toBe(result1.sessionKey);
      expect(result2.sessionKey).toBe('dingtalk-connector:account-1:user-123:4000000');

      nowSpy.mockRestore();
    });

    it('should reuse existing session within timeout window', async () => {
      const { getSessionKey } = await import('../src/session');
      const nowSpy = vi.spyOn(Date, 'now');
      let currentTime = 2_000_000;
      nowSpy.mockImplementation(() => currentTime);

      const first = getSessionKey('user-reuse', 'account-reuse', false, 30 * 60 * 1000);
      expect(first.isNew).toBe(false);

      // 1 分钟内再次访问，应复用同一 session
      currentTime += 60 * 1000;
      const second = getSessionKey('user-reuse', 'account-reuse', false, 30 * 60 * 1000);
      expect(second.isNew).toBe(false);
      expect(second.sessionKey).toBe(first.sessionKey);

      nowSpy.mockRestore();
    });

    it('should NOT create new session when elapsed equals timeout boundary', async () => {
      const { getSessionKey } = await import('../src/session');
      const nowSpy = vi.spyOn(Date, 'now');
      let currentTime = 5_000_000;
      nowSpy.mockImplementation(() => currentTime);

      const timeoutMs = 1000;
      const first = getSessionKey('user-boundary', 'account-boundary', false, timeoutMs);

      // elapsed == timeoutMs 时，代码是 ">"，因此不应超时新建
      currentTime += timeoutMs;
      const second = getSessionKey('user-boundary', 'account-boundary', false, timeoutMs);
      expect(second.isNew).toBe(false);
      expect(second.sessionKey).toBe(first.sessionKey);

      nowSpy.mockRestore();
    });

    it('should update lastActivity on reuse and prevent timeout later', async () => {
      const { getSessionKey } = await import('../src/session');
      const nowSpy = vi.spyOn(Date, 'now');
      let currentTime = 6_000_000;
      nowSpy.mockImplementation(() => currentTime);

      const timeoutMs = 10_000;
      const first = getSessionKey('user-activity', 'account-activity', false, timeoutMs);

      // 9 秒后复用，应该更新 lastActivity
      currentTime += 9_000;
      const reuse = getSessionKey('user-activity', 'account-activity', false, timeoutMs);
      expect(reuse.sessionKey).toBe(first.sessionKey);
      expect(reuse.isNew).toBe(false);

      // 再过 9 秒（总共 18 秒），如果没更新 lastActivity 会超时；但更新后不应超时
      currentTime += 9_000;
      const stillReuse = getSessionKey('user-activity', 'account-activity', false, timeoutMs);
      expect(stillReuse.isNew).toBe(false);
      expect(stillReuse.sessionKey).toBe(first.sessionKey);

      nowSpy.mockRestore();
    });

    it('should create new session when existing one timed out', async () => {
      const { getSessionKey } = await import('../src/session');
      const nowSpy = vi.spyOn(Date, 'now');
      let currentTime = 3_000_000;
      nowSpy.mockImplementation(() => currentTime);

      const timeoutMs = 1000;
      const first = getSessionKey('user-timeout', 'account-timeout', false, timeoutMs);
      expect(first.isNew).toBe(false);

      // 超过超时时间后再次访问，应创建新会话
      currentTime += timeoutMs + 1;
      const second = getSessionKey('user-timeout', 'account-timeout', false, timeoutMs);
      expect(second.isNew).toBe(true);
      expect(second.sessionKey).not.toBe(first.sessionKey);

      nowSpy.mockRestore();
    });

    it('should isolate sessions between different accounts', async () => {
      const { getSessionKey } = await import('../src/session');
      const resultA = getSessionKey('user-multi', 'account-A', false, 1800000);
      const resultB = getSessionKey('user-multi', 'account-B', false, 1800000);

      expect(resultA.sessionKey).not.toBe(resultB.sessionKey);
      expect(resultA.sessionKey).toContain('dingtalk-connector:account-A');
      expect(resultB.sessionKey).toContain('dingtalk-connector:account-B');
    });

    it('should emit log info on first session / forceNew / timeout', async () => {
      const { getSessionKey } = await import('../src/session');
      const nowSpy = vi.spyOn(Date, 'now');
      let currentTime = 7_000_000;
      nowSpy.mockImplementation(() => currentTime);

      const log = { info: vi.fn() };

      // 首次会话（isNew false 但应打 log）
      getSessionKey('user-log', 'account-log', false, 10_000, log);
      expect(log.info).toHaveBeenCalledTimes(1);

      // 强制新会话
      currentTime += 1;
      getSessionKey('user-log', 'account-log', true, 10_000, log);
      expect(log.info).toHaveBeenCalledTimes(2);

      // 超时新会话
      currentTime += 20_000;
      getSessionKey('user-log', 'account-log', false, 10_000, log);
      expect(log.info).toHaveBeenCalledTimes(3);

      nowSpy.mockRestore();
    });
  });
});
