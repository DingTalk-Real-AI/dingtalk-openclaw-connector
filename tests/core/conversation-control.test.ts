import { describe, expect, it } from 'vitest';
import { classifyControl, ConversationRuns } from '../../src/core/conversation-control.ts';
import { resolveMentionTargets } from '../../src/core/mention-routing.ts';

describe('ConversationRuns', () => {
  it('中止只作用于完全匹配的账户和 session，同时取消同会话内的在途句柄', () => {
    const registry = new ConversationRuns();
    const scope = { accountId: 'BotA', sessionKey: 'agent:main:group:one', senderId: 'u1' };
    const first = registry.begin(scope);
    const sameSession = registry.begin({ ...scope, senderId: 'u2' });
    const otherAccount = registry.begin({ ...scope, accountId: 'BotB' });
    const lowerCaseAccount = registry.begin({ ...scope, accountId: 'bota' });
    const otherSession = registry.begin({ ...scope, sessionKey: 'agent:other:group:one' });
    expect(registry.abortSession(scope.accountId, scope.sessionKey)).toEqual([first, sameSession]);
    expect(first.controller.signal.aborted).toBe(true);
    expect(sameSession.controller.signal.aborted).toBe(true);
    for (const run of [otherAccount, lowerCaseAccount, otherSession]) expect(run.controller.signal.aborted).toBe(false);
  });

  it('finish 只移除该次运行，旧运行结束不会误删同 scope 的新运行', () => {
    const registry = new ConversationRuns();
    const scope = { accountId: 'bot', sessionKey: 'session', senderId: 'u' };
    const old = registry.begin(scope);
    const current = registry.begin(scope);
    expect(old.runId).not.toBe(current.runId);
    registry.finish(old);
    expect(registry.abortSession('bot', 'session')).toEqual([current]);
    expect(old.controller.signal.aborted).toBe(false);
    registry.finish(current);
    expect(registry.abortSession('bot', 'session')).toEqual([]);
  });

  it('实例间无共享状态，重复 abort 保持幂等', () => {
    const first = new ConversationRuns();
    const other = new ConversationRuns();
    const run = first.begin({ accountId: 'bot', sessionKey: 'session', senderId: 'u' });
    let abortEvents = 0;
    run.controller.signal.addEventListener('abort', () => { abortEvents += 1; });
    expect(other.abortSession('bot', 'session')).toEqual([]);
    first.abortSession('bot', 'session');
    first.abortSession('bot', 'session');
    expect(abortEvents).toBe(1);
  });
});

describe('宿主控制命令识别', () => {
  it.each(['停止', 'stop', 'STOP', '/stop', 'esc'])('识别 %s 为停止', (text) => {
    expect(classifyControl(text)).toBe('stop');
  });
  it.each(['/btw', '/btw 问题'])('识别 %s 为旁路', (text) => {
    expect(classifyControl(text)).toBe('btw');
  });
  it.each(['请解释 /stop', '不要停止', 'stopwatch', 'hello\n[引用] /stop'])('普通正文 %s 不作为控制命令', (text) => {
    expect(classifyControl(text)).toBeUndefined();
  });
});

describe('显式别名路由边界', () => {
  const config = { enabled: true, aliases: { 编程: 'coder', 代码: 'coder', 帮手: 'support', 坏配置: 'not-configured' } };
  const agents = ['coder', 'support'];

  it('未启用时保持正文且不选择目标', () => {
    expect(resolveMentionTargets('@编程 你好', undefined, agents)).toEqual({ agentIds: [], text: '@编程 你好' });
    expect(resolveMentionTargets('@编程 你好', { ...config, enabled: false }, agents)).toEqual({ agentIds: [], text: '@编程 你好' });
  });
  it('同 agent 多个别名去重，未知别名和未配置 agent 保留原文', () => {
    expect(resolveMentionTargets('@编程 @代码 @张三 @坏配置 你好', config, agents)).toEqual({ agentIds: ['coder'], text: '@张三 @坏配置 你好' });
    expect(resolveMentionTargets('@张三 你好', config, agents)).toEqual({ agentIds: [], text: '@张三 你好' });
  });
  it('不会匹配邮件、嵌在词内的 @ 或别名的子字符串', () => {
    expect(resolveMentionTargets('x@编程 @编程专家 hello@example.test', config, agents)).toEqual({ agentIds: [], text: 'x@编程 @编程专家 hello@example.test' });
  });
  it('只使用 aliases 自身属性，不能路由到原型链属性', () => {
    const aliases = Object.assign(Object.create({ inherited: 'coder' }), { own: 'support' });
    expect(resolveMentionTargets('@inherited @own hello', { enabled: true, aliases }, agents)).toEqual({ agentIds: ['support'], text: '@inherited  hello' });
  });
  it('多目标 slash 命令只选择第一个，普通内容保留多个目标', () => {
    expect(resolveMentionTargets('@编程 @帮手 /stop', config, agents)).toEqual({ agentIds: ['coder'], text: '/stop' });
    expect(resolveMentionTargets('@帮手 @编程 讨论', config, agents)).toEqual({ agentIds: ['support', 'coder'], text: '讨论' });
  });
  it('最大目标数按去重后的 agent 计算，并有 5 个目标的硬上限', () => {
    expect(resolveMentionTargets('@编程 @代码 hello', { ...config, maxTargets: 1 }, agents).agentIds).toEqual(['coder']);
    expect(() => resolveMentionTargets('@编程 @帮手 hello', { ...config, maxTargets: 1 }, agents)).toThrow('最多可指定 1 个助手');
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(() => resolveMentionTargets(ids.map((id) => `@${id}`).join(' ') + ' hello', { enabled: true, maxTargets: 100, aliases: Object.fromEntries(ids.map((id) => [id, id])) }, ids)).toThrow('最多可指定 5 个助手');
  });
});
