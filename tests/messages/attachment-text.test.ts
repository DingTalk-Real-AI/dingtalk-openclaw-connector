import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractAttachmentText, MAX_ATTACHMENT_TEXT_BYTES } from '../../src/messages/attachment-text.ts';

const directories: string[] = [];
async function fixture(name: string, value: string | Buffer) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dingtalk-attachment-text-'));
  directories.push(directory);
  const file = path.join(directory, name);
  await fs.writeFile(file, value);
  return file;
}
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

describe('extractAttachmentText', () => {
  it.each(['txt', 'md', 'json', 'xml', 'yaml', 'csv', 'log', 'ts', 'py', 'sh'])('保留已有 %s 文本格式', async (extension) => {
    const file = await fixture(`text.${extension}`, '\uFEFF中文\r\nline\n');
    expect(await extractAttachmentText({ path: file })).toMatchObject({ status: 'extracted', text: '中文\nline', truncated: false });
  });
  it('支持文本 MIME，拒绝图片音频与无支持格式', async () => {
    const file = await fixture('file.bin', 'hello');
    expect(await extractAttachmentText({ path: file, mimeType: 'text/plain; charset=utf-8' })).toMatchObject({ status: 'extracted', text: 'hello' });
    expect(await extractAttachmentText({ path: file })).toMatchObject({ status: 'unsupported' });
    expect(await extractAttachmentText({ path: file, fileName: 'a.txt', mimeType: 'image/png' })).toMatchObject({ status: 'unsupported' });
  });
  it('超过 2 MiB 直接拒绝，恰好上限允许读取但限制正文', async () => {
    const oversized = await fixture('too-big.txt', Buffer.alloc(MAX_ATTACHMENT_TEXT_BYTES + 1, 65));
    expect(await extractAttachmentText({ path: oversized })).toMatchObject({ status: 'too-large' });
    const exact = await fixture('exact.txt', Buffer.alloc(MAX_ATTACHMENT_TEXT_BYTES, 65));
    const result = await extractAttachmentText({ path: exact });
    expect(result).toMatchObject({ status: 'extracted', truncated: true, byteLength: MAX_ATTACHMENT_TEXT_BYTES });
    expect(result.text).toHaveLength(6000);
  });
  it('正文截断不切断 emoji 的 UTF-16 代理对', async () => {
    const file = await fixture('emoji.txt', 'a'.repeat(5999) + '😀tail');
    const result = await extractAttachmentText({ path: file });
    expect(result.text).toBe('a'.repeat(5999));
    expect(result.truncated).toBe(true);
  });
  it('空文件、空白、二进制伪装和无效 UTF-8 返回明确状态', async () => {
    const cases: Array<[string | Buffer, string]> = [
      ['', 'empty'], [' \r\n\t', 'empty'], [Buffer.from([0x61, 0, 0x62]), 'binary'],
      [Buffer.from([0xff, 0xfe, 0x61, 0]), 'invalid-utf8'], [Buffer.from([0xc3, 0x28]), 'invalid-utf8'],
    ];
    for (const [value, status] of cases) {
      const file = await fixture('input.txt', value);
      expect(await extractAttachmentText({ path: file })).toMatchObject({ status, truncated: false });
    }
  });
  it('缺失文件和符号链接不产生正文', async () => {
    const file = await fixture('target.txt', 'private');
    expect(await extractAttachmentText({ path: `${file}.missing`, fileName: 'missing.txt' })).toMatchObject({ status: 'error' });
    const link = `${file}.link.txt`;
    await fs.symlink(file, link);
    expect(await extractAttachmentText({ path: link })).toMatchObject({ status: 'error' });
  });
});
