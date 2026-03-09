/**
 * Session 管理模块测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { isMessageProcessed, markMessageProcessed, isNewSessionCommand, getSessionKey } from '../src/session';

describe('Session Management', () => {
  beforeEach(() => {
    // 清理状态（如果需要）
  });

  describe('isMessageProcessed', () => {
    it('should return false for new message', () => {
      expect(isMessageProcessed('msg-123')).toBe(false);
    });

    it('should return true for processed message', () => {
      markMessageProcessed('msg-123');
      expect(isMessageProcessed('msg-123')).toBe(true);
    });

    it('should return false for empty messageId', () => {
      expect(isMessageProcessed('')).toBe(false);
    });
  });

  describe('isNewSessionCommand', () => {
    it('should recognize /new command', () => {
      expect(isNewSessionCommand('/new')).toBe(true);
    });

    it('should recognize 新会话 command', () => {
      expect(isNewSessionCommand('新会话')).toBe(true);
    });

    it('should recognize case-insensitive commands', () => {
      expect(isNewSessionCommand('/NEW')).toBe(true);
      expect(isNewSessionCommand('新会话')).toBe(true);
    });

    it('should return false for normal message', () => {
      expect(isNewSessionCommand('hello')).toBe(false);
    });
  });

  describe('getSessionKey', () => {
    it('should create new session for new user', () => {
      const result = getSessionKey('user-123', 'account-1', false, 1800000);
      expect(result.isNew).toBe(false);
      expect(result.sessionKey).toContain('dingtalk-connector:account-1');
      expect(result.sessionKey).toContain('user-123');
    });

    it('should create new session when forceNew is true', () => {
      const result1 = getSessionKey('user-123', 'account-1', false, 1800000);
      const result2 = getSessionKey('user-123', 'account-1', true, 1800000);
      expect(result2.isNew).toBe(true);
      expect(result2.sessionKey).not.toBe(result1.sessionKey);
    });
  });
});
