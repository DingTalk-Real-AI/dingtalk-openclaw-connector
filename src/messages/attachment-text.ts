import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import * as path from 'node:path';

export const MAX_ATTACHMENT_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENT_TEXT_CHARS = 6000;

// 与现有入站文本及媒体文件格式取并集；不新增 OCR 或文档解析依赖。
const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.xml', '.yaml', '.yml', '.csv', '.log',
  '.html', '.htm', '.css', '.js', '.ts', '.py', '.java', '.c', '.cpp', '.h', '.sh', '.bat',
]);

export type AttachmentTextStatus = 'extracted' | 'empty' | 'too-large' | 'unsupported' | 'binary' | 'invalid-utf8' | 'error';
export interface AttachmentTextResult {
  status: AttachmentTextStatus;
  text?: string;
  truncated: boolean;
  byteLength?: number;
}

export async function extractAttachmentText(input: {
  path: string;
  fileName?: string;
  mimeType?: string;
}): Promise<AttachmentTextResult> {
  const mime = input.mimeType?.split(';')[0].trim().toLowerCase();
  const extension = path.extname(input.fileName ?? input.path).toLowerCase();
  if ((mime && /^(image|audio|video)\//.test(mime)) || (!TEXT_EXTENSIONS.has(extension)
    && !mime?.startsWith('text/') && !['application/json', 'application/xml', 'application/javascript', 'application/x-yaml'].includes(mime ?? ''))) {
    return { status: 'unsupported', truncated: false };
  }
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(input.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await handle.stat();
    if (!stat.isFile()) return { status: 'unsupported', truncated: false };
    if (stat.size > MAX_ATTACHMENT_TEXT_BYTES) return { status: 'too-large', truncated: false, byteLength: stat.size };
    // 有界读取防止 stat 后文件增长导致无界分配。
    const buffer = Buffer.alloc(MAX_ATTACHMENT_TEXT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_ATTACHMENT_TEXT_BYTES) return { status: 'too-large', truncated: false, byteLength: length };
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)); }
    catch { return { status: 'invalid-utf8', truncated: false, byteLength: length }; }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
      return { status: 'binary', truncated: false, byteLength: length };
    }
    text = text.replace(/\r\n/g, '\n').trim();
    if (!text) return { status: 'empty', truncated: false, byteLength: length };
    const truncated = text.length > MAX_ATTACHMENT_TEXT_CHARS;
    let cut = MAX_ATTACHMENT_TEXT_CHARS;
    // UTF-16 截断边界不能留下孤立高代理项。
    if (truncated && /[\uD800-\uDBFF]/.test(text[cut - 1])) cut -= 1;
    return { status: 'extracted', text: text.slice(0, cut), truncated, byteLength: length };
  } catch {
    return { status: 'error', truncated: false };
  } finally { await handle?.close(); }
}
