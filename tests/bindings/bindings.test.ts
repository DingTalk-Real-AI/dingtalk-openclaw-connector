import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockExistsSync = vi.hoisted(() => vi.fn());
const mockReadFileSync = vi.hoisted(() => vi.fn());

vi.mock('fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));
vi.mock('path', () => ({
  join: (...args: string[]) => args.join('/'),
}));
vi.mock('os', () => ({
  homedir: () => '/fake-home',
}));

// 保证 test 在本文件内加载时使用上面 mock 的 fs/path/os
let resolveAgentIdByBindings: (a: string, b: 'direct' | 'group', c: string, l?: any) => string;

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const CONFIG_PATH = '/fake-home/.openclaw/openclaw.json';

describe('resolveAgentIdByBindings', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    vi.resetModules();
    const { __testables } = await import('../test');
    resolveAgentIdByBindings = (__testables as any).resolveAgentIdByBindings;
    (__testables as any).setRuntimeForTest({});
  });

  it('returns main when accountId is __default__ and no config', () => {
    const out = resolveAgentIdByBindings('__default__', 'direct', 'user1', log);
    expect(out).toBe('main');
  });

  it('returns accountId when accountId is not __default__ and no config', () => {
    const out = resolveAgentIdByBindings('acc1', 'direct', 'user1', log);
    expect(out).toBe('acc1');
  });

  it('returns defaultAgentId when config file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const out = resolveAgentIdByBindings('acc1', 'direct', 'u1', log);
    expect(mockExistsSync).toHaveBeenCalledWith(CONFIG_PATH);
    expect(out).toBe('acc1');
  });

  it('returns defaultAgentId when bindings is empty array', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(JSON.stringify({ bindings: [] }));
    const out = resolveAgentIdByBindings('acc1', 'direct', 'u1', log);
    expect(out).toBe('acc1');
  });

  it('returns defaultAgentId when config has no bindings key', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('{}');
    const out = resolveAgentIdByBindings('acc1', 'direct', 'u1', log);
    expect(out).toBe('acc1');
  });

  it('returns defaultAgentId and logs warn when readFileSync throws', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('read error');
    });
    const out = resolveAgentIdByBindings('acc1', 'direct', 'u1', log);
    expect(out).toBe('acc1');
    expect(log.warn).toHaveBeenCalled();
  });

  it('priority 1: exact peer.kind + peer.id match', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        bindings: [
          { agentId: 'agent1', match: { channel: 'dingtalk-connector', peer: { kind: 'direct', id: 'user1' } } },
        ],
      }),
    );
    const out = resolveAgentIdByBindings('acc1', 'direct', 'user1', log);
    expect(out).toBe('agent1');
  });

  it('priority 1: no match when peerId differs', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        bindings: [
          { agentId: 'agent1', match: { peer: { kind: 'direct', id: 'user1' } } },
        ],
      }),
    );
    const out = resolveAgentIdByBindings('acc1', 'direct', 'user2', log);
    expect(out).toBe('acc1');
  });

  it('priority 1: accountId filter - skip when accountId does not match', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        bindings: [
          { agentId: 'a', match: { accountId: 'acc1', peer: { kind: 'direct', id: 'u1' } } },
        ],
      }),
    );
    const out = resolveAgentIdByBindings('acc2', 'direct', 'u1', log);
    expect(out).toBe('acc2');
  });

  it('priority 1: accountId filter - match when accountId matches', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        bindings: [
          { agentId: 'a', match: { accountId: 'acc1', peer: { kind: 'direct', id: 'u1' } } },
        ],
      }),
    );
    const out = resolveAgentIdByBindings('acc1', 'direct', 'u1', log);
    expect(out).toBe('a');
  });

  it('priority 2: peer.id=* matches any peerId for same kind', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        bindings: [{ agentId: 'wild', match: { peer: { kind: 'direct', id: '*' } } }],
      }),
    );
    const out = resolveAgentIdByBindings('acc1', 'direct', 'any_id', log);
    expect(out).toBe('wild');
  });

  it('priority 3: peer.kind only (no peer.id)', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        bindings: [{ agentId: 'kindOnly', match: { peer: { kind: 'group' } } }],
      }),
    );
    const out = resolveAgentIdByBindings('acc1', 'group', 'cid1', log);
    expect(out).toBe('kindOnly');
  });

  it('priority 4: accountId match (no peer)', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        bindings: [{ agentId: 'accAgent', match: { accountId: 'acc1' } }],
      }),
    );
    const out = resolveAgentIdByBindings('acc1', 'direct', 'u1', log);
    expect(out).toBe('accAgent');
  });

  it('priority 5: channel only (no peer, no accountId)', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        bindings: [{ agentId: 'channelOnly', match: { channel: 'dingtalk-connector' } }],
      }),
    );
    const out = resolveAgentIdByBindings('acc1', 'direct', 'u1', log);
    expect(out).toBe('channelOnly');
  });

  it('channel filter: other channel binding is skipped', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        bindings: [{ agentId: 'other', match: { channel: 'other-channel' } }],
      }),
    );
    const out = resolveAgentIdByBindings('acc1', 'direct', 'u1', log);
    expect(out).toBe('acc1');
  });

  it('returns defaultAgentId when binding.agentId is empty', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        bindings: [{ agentId: '', match: { peer: { kind: 'direct', id: 'u1' } } }],
      }),
    );
    const out = resolveAgentIdByBindings('acc1', 'direct', 'u1', log);
    expect(out).toBe('acc1');
  });

  it('ignores binding when match has no effective criteria', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        bindings: [{ agentId: 'noop', match: {} }],
      }),
    );
    const out = resolveAgentIdByBindings('acc1', 'direct', 'u1', log);
    expect(out).toBe('acc1');
  });
});
