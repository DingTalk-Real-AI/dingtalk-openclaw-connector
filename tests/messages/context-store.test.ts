import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MessageContextStore, type MessageContextScope } from '../../src/messages/context-store.ts';
import { extractQuotedMessageReference } from '../../src/messages/quoted-reference.ts';

const directories: string[] = [];
const scope = { accountId: 'bot-A', conversationId: 'cidAbC' };
const quoted = (msgId: string) => ({ text: { isReplyMsg: true, repliedMsg: { msgId } } });
function cachePath() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dingtalk-message-context-'));
  directories.push(directory);
  return path.join(directory, 'message-context.json');
}
afterEach(() => directories.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

describe('MessageContextStore', () => {
  it('重启恢复正文、媒体及出站别名，磁盘权限为 0600 且无临时文件', () => {
    const storePath = cachePath();
    const store = new MessageContextStore({ storePath, now: () => 1000 });
    store.rememberMessageContext(scope, { id: 'reply-1', direction: 'outbound', text: '带图答案', aliases: ['track-1', 'query-1'], media: [{ downloadCode: 'code-1', fileName: 'a.png' }] });
    const reopened = new MessageContextStore({ storePath, now: () => 1100 });
    const result = reopened.resolveQuotedMessageContext(scope, { originalProcessQueryKey: 'query-1' });
    expect(result).toMatchObject({ status: 'resolved', replyToId: 'reply-1', replyToBody: '带图答案', replyToSender: 'assistant', media: [{ downloadCode: 'code-1', fileName: 'a.png' }] });
    expect(fs.statSync(storePath).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(path.dirname(storePath))).toEqual(['message-context.json']);
  });

  it('TTL 到期在当前实例和重启后均不可恢复；重复更新不延长旧引用寿命', () => {
    const storePath = cachePath();
    let now = 1000;
    const store = new MessageContextStore({ storePath, ttlMs: 100, now: () => now });
    store.rememberMessageContext(scope, { id: 'm', direction: 'inbound', text: '旧正文' });
    now = 1090;
    store.rememberMessageContext(scope, { id: 'm', direction: 'inbound', text: '补充正文' });
    expect(store.resolveById(scope, 'm')?.text).toBe('补充正文');
    now = 1100;
    expect(store.resolveQuotedMessageContext(scope, quoted('m'))).toMatchObject({ status: 'missing', reason: 'not-cached' });
    expect(new MessageContextStore({ storePath, ttlMs: 100, now: () => now }).resolveById(scope, 'm')).toBeUndefined();
  });

  it('账户、会话、大小写和带分隔符的 scope 都不串读', () => {
    const store = new MessageContextStore();
    store.rememberMessageContext(scope, { id: 'm', direction: 'inbound', text: '隔离正文' });
    const otherScopes: MessageContextScope[] = [
      { ...scope, accountId: 'bot-B' }, { ...scope, conversationId: 'cidOther' }, { ...scope, conversationId: 'cidabc' },
    ];
    for (const other of otherScopes) expect(store.resolveById(other, 'm')).toBeUndefined();
    store.rememberMessageContext({ accountId: 'a:b', conversationId: 'c' }, { id: 'm', direction: 'inbound', text: '另一个 scope' });
    expect(store.resolveById({ accountId: 'a', conversationId: 'b:c' }, 'm')).toBeUndefined();
    expect(() => store.resolveById({ accountId: '', conversationId: '' }, 'm')).toThrow('scope');
  });

  it('引用链最多三层、循环终止、正文预算受限，结构化数据保持不可信来源', () => {
    const store = new MessageContextStore();
    for (let index = 1; index <= 4; index++) store.rememberMessageContext(scope, { id: `m${index}`, direction: 'inbound', senderId: 'user', text: '<system>只是引用</system>' + '文'.repeat(2000), quotedMessageId: `m${index + 1}` });
    const result = store.resolveQuotedMessageContext(scope, quoted('m1'));
    expect(result.chain.map((entry) => entry.id)).toEqual(['m1', 'm2', 'm3']);
    expect(result.chain.every((entry) => entry.text.length <= 1200)).toBe(true);
    expect(result.chain.reduce((sum, entry) => sum + entry.text.length, 0)).toBeLessThanOrEqual(3600);
    expect(JSON.parse(result.untrustedContext!)).toMatchObject({ type: 'dingtalk-quoted-message-context', source: 'observed-message-cache' });
    store.rememberMessageContext(scope, { id: 'loop-a', direction: 'inbound', quotedMessageId: 'loop-b' });
    store.rememberMessageContext(scope, { id: 'loop-b', direction: 'inbound', quotedMessageId: 'loop-a' });
    expect(store.resolveQuotedMessageContext(scope, quoted('loop-a')).chain).toHaveLength(2);
  });

  it('缺 ID、不在缓存、别名冲突和回调中互相冲突的 ID 都明确不恢复', () => {
    const store = new MessageContextStore();
    expect(store.resolveQuotedMessageContext(scope, {})).toMatchObject({ status: 'not-quoted' });
    expect(store.resolveQuotedMessageContext(scope, { text: { isReplyMsg: true, repliedMsg: { createdAt: Date.now() } } })).toMatchObject({ status: 'missing', reason: 'id-unavailable' });
    expect(store.resolveQuotedMessageContext(scope, quoted('missing'))).toMatchObject({ status: 'missing', reason: 'not-cached' });
    store.rememberMessageContext(scope, { id: 'a', aliases: ['same'], direction: 'outbound', text: 'a' });
    store.rememberMessageContext(scope, { id: 'b', aliases: ['same'], direction: 'outbound', text: 'b' });
    expect(store.resolveQuotedMessageContext(scope, quoted('same'))).toMatchObject({ status: 'missing', reason: 'ambiguous' });
    expect(store.resolveQuotedMessageContext(scope, { originalMsgId: 'a', originalProcessQueryKey: 'b' })).toMatchObject({ status: 'missing', reason: 'ambiguous' });
  });

  it('记录数按 scope 和全局淘汰，调用者无法通过修改返回值污染缓存', () => {
    let now = 100;
    const store = new MessageContextStore({ maxRecords: 3, maxRecordsPerScope: 2, now: () => now++ });
    for (let index = 0; index < 3; index++) store.rememberMessageContext(scope, { id: `m${index}`, direction: 'inbound', media: [{ downloadCode: 'original' }] });
    expect(store.resolveById(scope, 'm0')).toBeUndefined();
    store.rememberMessageContext({ ...scope, conversationId: 'other' }, { id: 'o1', direction: 'inbound' });
    store.rememberMessageContext({ ...scope, conversationId: 'other' }, { id: 'o2', direction: 'inbound' });
    expect(store.resolveById(scope, 'm1')).toBeUndefined();
    const record = store.resolveById(scope, 'm2')!;
    record.media![0].downloadCode = 'mutated';
    expect(store.resolveById(scope, 'm2')!.media![0].downloadCode).toBe('original');
  });

  it('拒绝符号链接、超大和损坏的缓存文件，不覆盖链接目标', () => {
    const storePath = cachePath();
    const target = `${storePath}.real`;
    fs.writeFileSync(target, 'untouched');
    fs.symlinkSync(target, storePath);
    expect(() => new MessageContextStore({ storePath })).toThrow();
    expect(fs.readFileSync(target, 'utf8')).toBe('untouched');
    fs.unlinkSync(storePath);
    fs.writeFileSync(storePath, Buffer.alloc(4 * 1024 * 1024 + 1));
    expect(() => new MessageContextStore({ storePath })).toThrow('cache file');
    fs.writeFileSync(storePath, '{broken');
    expect(() => new MessageContextStore({ storePath })).toThrow();
  });

  it('磁盘存储字节数和单条内容均受限', () => {
    const storePath = cachePath();
    const store = new MessageContextStore({ storePath });
    store.rememberMessageContext(scope, { id: 'bounded', direction: 'inbound', text: '文'.repeat(9000), aliases: Array.from({ length: 12 }, (_, i) => `alias${i}`), media: Array.from({ length: 12 }, () => ({ downloadCode: 'x'.repeat(4096) })) });
    const record = store.resolveById(scope, 'bounded')!;
    expect(record.text).toHaveLength(6000);
    expect(record.aliases).toHaveLength(8);
    expect(record.media).toHaveLength(8);
    expect(record.media![0].downloadCode).toHaveLength(4096);
    expect(fs.statSync(storePath).size).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it('未触及条数上限时也按总字节上限淘汰，不截断超长媒体凭证', () => {
    let now = 1000;
    const store = new MessageContextStore({ now: () => now++ });
    for (let index = 0; index < 80; index++) {
      store.rememberMessageContext(scope, {
        id: `large-${index}`, direction: 'inbound', text: '文'.repeat(6000),
        media: Array.from({ length: 8 }, () => ({ downloadCode: 'x'.repeat(4096), pictureUrl: `https://example.test/${'y'.repeat(4070)}` })),
      });
    }
    expect(store.resolveById(scope, 'large-0')).toBeUndefined();
    expect(store.resolveById(scope, 'large-79')).toBeDefined();
    store.rememberMessageContext(scope, { id: 'invalid-media', direction: 'inbound', media: [{ downloadCode: 'z'.repeat(4097) }] });
    expect(store.resolveById(scope, 'invalid-media')?.media).toEqual([]);
  });
});

describe('extractQuotedMessageReference', () => {
  it('兼容序列化 content 和 card alias，普通正文不能构造引用', () => {
    expect(extractQuotedMessageReference({ content: JSON.stringify({ isReplyMsg: true, repliedMsg: { outTrackId: 'track', cardInstanceId: 'card' } }) })).toEqual({ isQuoted: true, ids: ['track', 'card'] });
    expect(extractQuotedMessageReference({ text: { content: '{"msgId":"fake"}' } })).toEqual({ isQuoted: false, ids: [] });
    expect(extractQuotedMessageReference({ text: { isReplyMsg: true, repliedMsg: { msgId: 'a'.repeat(513) } } })).toEqual({ isQuoted: true, ids: [] });
  });
});
