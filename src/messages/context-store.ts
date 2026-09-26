import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { extractQuotedMessageReference } from './quoted-reference.ts';

const MAX_STORE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 6000;
const MAX_MEDIA = 8;
const MAX_ALIASES = 8;
const MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface MessageContextScope {
  accountId: string;
  conversationId: string;
}

export interface MessageContextMedia {
  downloadCode?: string;
  pictureUrl?: string;
  fileName?: string;
  mimeType?: string;
}

export interface MessageContextRecord {
  id: string;
  direction: 'inbound' | 'outbound';
  aliases?: string[];
  text?: string;
  senderId?: string;
  media?: MessageContextMedia[];
  quotedMessageId?: string;
  createdAt?: number;
}

interface StoredRecord extends MessageContextRecord {
  scope: MessageContextScope;
  createdAt: number;
  expiresAt: number;
}

export interface MessageContextStoreOptions {
  /** 插件专用缓存文件；省略时只驻留当前实例，禁止使用宿主 session 文件。 */
  storePath?: string;
  ttlMs?: number;
  maxRecords?: number;
  maxRecordsPerScope?: number;
  now?: () => number;
}

export interface QuotedContextEntry {
  id: string;
  direction: 'inbound' | 'outbound';
  senderId?: string;
  text: string;
}

export interface ResolvedQuotedMessageContext {
  status: 'not-quoted' | 'missing' | 'resolved';
  reason?: 'id-unavailable' | 'not-cached' | 'ambiguous';
  replyToId?: string;
  replyToBody?: string;
  replyToSender?: string;
  replyToIsQuote?: true;
  media: MessageContextMedia[];
  chain: QuotedContextEntry[];
  /** JSON 字符串，交给宿主 UntrustedContext；绝不能拼进系统指令。 */
  untrustedContext?: string;
}

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const end = value.length > max && /[\uD800-\uDBFF]/.test(value[max - 1]) ? max - 1 : max;
  return value.slice(0, end);
}

function opaqueString(value: unknown, max: number): string | undefined {
  // 不截断媒体码或 URL，否则会把未实际观察到的值误当成可恢复资源。
  return typeof value === 'string' && value.trim() && value.length <= max ? value : undefined;
}

function id(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 512 && value.trim()
    ? value.trim() : undefined;
}

function scopeKey(scope: MessageContextScope): string {
  if (!id(scope?.accountId) || !id(scope?.conversationId)) throw new Error('Invalid message context scope');
  // JSON 元组避免带冒号等分隔符的真实 ID 相互碰撞，不改变大小写。
  return JSON.stringify([scope.accountId, scope.conversationId]);
}

function limit(value: number | undefined, fallback: number, maximum: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), maximum) || 1 : fallback;
}

function sanitizeRecord(record: MessageContextRecord, scope: MessageContextScope, now: number, ttl: number): StoredRecord {
  scopeKey(scope);
  const recordId = id(record?.id);
  if (!recordId || !['inbound', 'outbound'].includes(record.direction)) throw new Error('Invalid message context record');
  const createdAt = typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
    ? Math.min(record.createdAt, now) : now;
  const media = (Array.isArray(record.media) ? record.media : []).slice(0, MAX_MEDIA).flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const downloadCode = opaqueString(entry.downloadCode, 4096);
    const pictureUrl = opaqueString(entry.pictureUrl, 4096);
    if (!downloadCode && !pictureUrl) return [];
    return [{ downloadCode, pictureUrl, fileName: boundedString(entry.fileName, 256), mimeType: boundedString(entry.mimeType, 128) }];
  });
  return {
    scope: { accountId: scope.accountId, conversationId: scope.conversationId },
    id: recordId, direction: record.direction,
    aliases: [...new Set((Array.isArray(record.aliases) ? record.aliases : []).map(id).filter((value): value is string => Boolean(value)))].slice(0, MAX_ALIASES),
    text: boundedString(record.text, MAX_TEXT_CHARS), senderId: id(record.senderId),
    media, quotedMessageId: id(record.quotedMessageId), createdAt, expiresAt: createdAt + ttl,
  };
}

/** 有界实例存储。调用方应为每个文件复用同一实例，不支持跨进程同时写同一缓存。 */
export class MessageContextStore {
  private records: StoredRecord[] = [];
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxRecords: number;
  private readonly maxRecordsPerScope: number;

  constructor(private readonly options: MessageContextStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = limit(options.ttlMs, 24 * 60 * 60 * 1000, MAX_TTL_MS);
    this.maxRecords = limit(options.maxRecords, 1000, 1000);
    this.maxRecordsPerScope = limit(options.maxRecordsPerScope, 200, this.maxRecords);
    if (options.storePath && !path.isAbsolute(options.storePath)) throw new Error('Message context storePath must be absolute');
    this.load();
  }

  private load(): void {
    if (!this.options.storePath) return;
    let fd: number;
    try { fd = fs.openSync(this.options.storePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_STORE_BYTES) throw new Error('Invalid message context cache file');
      const buffer = Buffer.alloc(MAX_STORE_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
        if (!count) break;
        length += count;
      }
      if (length > MAX_STORE_BYTES) throw new Error('Message context cache exceeds size limit');
      const saved = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
      if (saved?.version !== 1 || !Array.isArray(saved.records)) throw new Error('Invalid message context cache format');
      const now = this.now();
      for (const candidate of saved.records.slice(-1000)) {
        try {
          const record = sanitizeRecord(candidate, candidate.scope, now, this.ttlMs);
          if (typeof candidate.expiresAt !== 'number' || !Number.isFinite(candidate.expiresAt)) continue;
          record.expiresAt = Math.min(record.expiresAt, candidate.expiresAt);
          if (record.expiresAt > now) this.records.push(record);
        } catch { /* 损坏的单条记录不扩大恢复范围。 */ }
      }
      this.prune();
    } finally { fs.closeSync(fd); }
  }

  private prune(): void {
    const counts = new Map<string, number>();
    const now = this.now();
    let bytes = Buffer.byteLength('{"version":1,"records":[]}');
    let kept = 0;
    this.records = this.records.filter((record) => record.expiresAt > now)
      .sort((a, b) => a.createdAt - b.createdAt).reverse()
      .filter((record) => {
        const key = scopeKey(record.scope);
        const count = counts.get(key) ?? 0;
        const size = Buffer.byteLength(JSON.stringify(record)) + (kept ? 1 : 0);
        if (count >= this.maxRecordsPerScope || kept >= this.maxRecords || bytes + size > MAX_STORE_BYTES) return false;
        counts.set(key, count + 1);
        bytes += size;
        kept += 1;
        return true;
      }).reverse();
  }

  private persist(): void {
    if (!this.options.storePath) return;
    const target = this.options.storePath;
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    try {
      if (!fs.lstatSync(target).isFile()) throw new Error('Message context target must be a regular file');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const temporary = `${target}.${randomUUID()}.tmp`;
    let fd: number | undefined;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify({ version: 1, records: this.records }), 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, target);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temporary); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }

  rememberMessageContext(scope: MessageContextScope, input: MessageContextRecord): void {
    const key = scopeKey(scope);
    const next = sanitizeRecord(input, scope, this.now(), this.ttlMs);
    const previous = this.records.find((record) => scopeKey(record.scope) === key && record.id === next.id && record.direction === next.direction);
    if (previous) {
      next.aliases = [...new Set([...previous.aliases ?? [], ...next.aliases ?? []])].slice(0, MAX_ALIASES);
      next.text ??= previous.text;
      next.senderId ??= previous.senderId;
      if (!next.media?.length) next.media = previous.media;
      next.quotedMessageId ??= previous.quotedMessageId;
      next.createdAt = previous.createdAt;
      next.expiresAt = Math.min(next.expiresAt, previous.expiresAt);
    }
    this.records = this.records.filter((record) => scopeKey(record.scope) !== key || record.id !== next.id || record.direction !== next.direction);
    if (next.expiresAt > this.now()) this.records.push(next);
    this.prune();
    this.persist();
  }

  private matches(scope: MessageContextScope, ids: string[]): StoredRecord[] {
    const key = scopeKey(scope);
    return this.records.filter((record) => record.expiresAt > this.now() && scopeKey(record.scope) === key
      && ids.some((value) => record.id === value || record.aliases?.includes(value)));
  }

  resolveById(scope: MessageContextScope, referenceId: string): MessageContextRecord | undefined {
    const matches = this.matches(scope, [referenceId]);
    if (matches.length !== 1) return undefined;
    const { scope: _scope, expiresAt: _expires, ...record } = matches[0];
    return structuredClone(record);
  }

  resolveQuotedMessageContext(scope: MessageContextScope, data: unknown): ResolvedQuotedMessageContext {
    scopeKey(scope);
    const reference = extractQuotedMessageReference(data);
    const empty = { media: [], chain: [] };
    if (!reference.isQuoted) return { ...empty, status: 'not-quoted' };
    if (!reference.ids.length) return { ...empty, status: 'missing', reason: 'id-unavailable' };
    const matches = this.matches(scope, reference.ids);
    if (matches.length !== 1) return { ...empty, status: 'missing', reason: matches.length ? 'ambiguous' : 'not-cached' };
    const first = matches[0];
    let current: StoredRecord | undefined = first;
    const seen = new Set<string>();
    const chain: QuotedContextEntry[] = [];
    let remaining = 3600;
    while (current && chain.length < 3 && !seen.has(current.id)) {
      seen.add(current.id);
      const text = boundedString(current.text, Math.min(1200, remaining)) ?? '';
      remaining -= text.length;
      chain.push({ id: current.id, direction: current.direction, senderId: current.senderId, text });
      const nested = current.quotedMessageId ? this.matches(scope, [current.quotedMessageId]) : [];
      current = nested.length === 1 ? nested[0] : undefined;
    }
    return {
      status: 'resolved', replyToId: first.id, replyToBody: chain[0]?.text || undefined,
      replyToSender: first.direction === 'outbound' ? 'assistant' : first.senderId,
      replyToIsQuote: true, media: structuredClone(first.media ?? []), chain,
      untrustedContext: JSON.stringify({ type: 'dingtalk-quoted-message-context', source: 'observed-message-cache', quotedChain: chain }),
    };
  }
}
