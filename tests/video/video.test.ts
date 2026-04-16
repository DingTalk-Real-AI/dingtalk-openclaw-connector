import { describe, it, expect, vi } from 'vitest';
import { __testables } from '../test';

const { processVideoMarkers } = __testables as any;

describe('video markers processing', () => {
  const dummyConfig = {};
  const dummyWebhook = 'https://example.com/webhook';
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  it('should bypass processing when oapiToken is null', async () => {
    const content = 'hello [DINGTALK_VIDEO]{"path":"/tmp/a.mp4"}[/DINGTALK_VIDEO]';
    const result = await processVideoMarkers(content, dummyWebhook, dummyConfig, null, log);

    // oapiToken 为空时，函数会跳过处理并保留原内容（包括标记），仅输出 warning 日志
    expect(result).toBe(content);
    expect(log.warn).toHaveBeenCalled();
  });

  it('should keep content when no markers present', async () => {
    const content = 'plain text without markers';
    const result = await processVideoMarkers(content, dummyWebhook, dummyConfig, 'token', log);

    expect(result).toBe(content);
    expect(log.info).toHaveBeenCalled();
  });

  it('should ignore invalid json markers gracefully', async () => {
    const content = 'text [DINGTALK_VIDEO]{invalid-json}[/DINGTALK_VIDEO]';
    const result = await processVideoMarkers(content, dummyWebhook, dummyConfig, 'token', log);

    expect(result).toBe('text');
    expect(log.warn).toHaveBeenCalled();
  });
});

