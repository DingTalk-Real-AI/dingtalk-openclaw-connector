import { describe, it, expect } from 'vitest';
import { __testables } from '../test';

const { extractMessageContent } = __testables as any;

const emptyArrays = {
  imageUrls: [],
  downloadCodes: [],
  fileNames: [],
  atDingtalkIds: [],
  atMobiles: [],
};

describe('extractMessageContent', () => {
  describe('msgtype 缺失或 default 分支', () => {
    it.each([
      { data: {}, messageType: 'text', text: '', desc: '空对象' },
      { data: { msgtype: undefined }, messageType: 'text', text: '', desc: 'msgtype undefined' },
      { data: { msgtype: 'unknownType' }, messageType: 'unknownType', text: '[unknownType消息]', desc: '未知类型走 default' },
      { data: { msgtype: null }, messageType: 'text', text: '', desc: 'msgtype null' },
    ] as const)('$desc', ({ data, messageType, text }) => {
      const out = extractMessageContent(data);
      expect(out.messageType).toBe(messageType);
      expect(out.text).toBe(text);
      expect(out.imageUrls).toEqual([]);
      expect(out.downloadCodes).toEqual([]);
      expect(out.fileNames).toEqual([]);
      expect(out.atDingtalkIds).toEqual([]);
      expect(out.atMobiles).toEqual([]);
    });
  });

  describe("msgtype === 'text'", () => {
    it.each([
      { data: { msgtype: 'text' }, text: '', atDingtalkIds: [], atMobiles: [] },
      { data: { msgtype: 'text', text: {} }, text: '', atDingtalkIds: [], atMobiles: [] },
      { data: { msgtype: 'text', text: { content: ' hello ' } }, text: 'hello', atDingtalkIds: [], atMobiles: [] },
      { data: { msgtype: 'text', text: { content: 'hi' } }, text: 'hi', atDingtalkIds: [], atMobiles: [] },
      {
        data: {
          msgtype: 'text',
          text: { content: 'hi', at: { atDingtalkIds: ['id1'], atMobiles: ['13800138000'] } },
        },
        text: 'hi',
        atDingtalkIds: ['id1'],
        atMobiles: ['13800138000'],
      },
      {
        data: {
          msgtype: 'text',
          text: { content: 'x', at: { atDingtalkIds: ['a', 'b'], atMobiles: [] } },
        },
        text: 'x',
        atDingtalkIds: ['a', 'b'],
        atMobiles: [],
      },
      { data: { msgtype: 'text', text: { content: '' } }, text: '', atDingtalkIds: [], atMobiles: [] },
    ] as const)('text=$text atDingtalkIds=$atDingtalkIds atMobiles=$atMobiles', ({ data, text, atDingtalkIds, atMobiles }) => {
      const out = extractMessageContent(data);
      expect(out.messageType).toBe('text');
      expect(out.text).toBe(text);
      expect(out.atDingtalkIds).toEqual(atDingtalkIds);
      expect(out.atMobiles).toEqual(atMobiles);
      expect(out.imageUrls).toEqual([]);
      expect(out.downloadCodes).toEqual([]);
      expect(out.fileNames).toEqual([]);
    });
  });

  describe("msgtype === 'richText'", () => {
    it.each([
      { data: { msgtype: 'richText' }, text: '[富文本消息]', imageUrls: [] },
      { data: { msgtype: 'richText', content: {} }, text: '[富文本消息]', imageUrls: [] },
      { data: { msgtype: 'richText', content: { richText: [] } }, text: '[富文本消息]', imageUrls: [] },
      {
        data: { msgtype: 'richText', content: { richText: [{ text: 'a' }, { text: 'b' }] } },
        text: 'ab',
        imageUrls: [],
      },
      {
        data: { msgtype: 'richText', content: { richText: [{ pictureUrl: 'http://x/y.png' }] } },
        text: '[图片]',
        imageUrls: ['http://x/y.png'],
      },
      {
        data: { msgtype: 'richText', content: { richText: [{ text: 'x', pictureUrl: 'u' }] } },
        text: 'x',
        imageUrls: ['u'],
      },
      {
        data: { msgtype: 'richText', content: { richText: [{ type: 'picture', downloadCode: 'code1' }] } },
        text: '[图片]',
        imageUrls: ['downloadCode:code1'],
      },
      {
        data: {
          msgtype: 'richText',
          content: { richText: [{ text: 't', type: 'picture', downloadCode: 'c' }] },
        },
        text: 't',
        imageUrls: ['downloadCode:c'],
      },
    ] as const)('text=$text imageUrls=$imageUrls', ({ data, text, imageUrls }) => {
      const out = extractMessageContent(data);
      expect(out.messageType).toBe('richText');
      expect(out.text).toBe(text);
      expect(out.imageUrls).toEqual(imageUrls);
      expect(out.downloadCodes).toEqual([]);
      expect(out.fileNames).toEqual([]);
      expect(out.atDingtalkIds).toEqual([]);
      expect(out.atMobiles).toEqual([]);
    });
  });

  describe("msgtype === 'picture'", () => {
    it.each([
      { data: { msgtype: 'picture' }, text: '[图片]', imageUrls: [], downloadCodes: [] },
      {
        data: { msgtype: 'picture', content: { pictureUrl: 'http://p.png' } },
        text: '[图片]',
        imageUrls: ['http://p.png'],
        downloadCodes: [],
      },
      {
        data: { msgtype: 'picture', content: { downloadCode: 'dc1' } },
        text: '[图片]',
        imageUrls: [],
        downloadCodes: ['dc1'],
      },
      {
        data: { msgtype: 'picture', content: { pictureUrl: 'u', downloadCode: 'c' } },
        text: '[图片]',
        imageUrls: ['u'],
        downloadCodes: ['c'],
      },
    ] as const)('picture branch', ({ data, text, imageUrls, downloadCodes }) => {
      const out = extractMessageContent(data);
      expect(out.messageType).toBe('picture');
      expect(out.text).toBe(text);
      expect(out.imageUrls).toEqual(imageUrls);
      expect(out.downloadCodes).toEqual(downloadCodes);
      expect(out.fileNames).toEqual([]);
      expect(out.atDingtalkIds).toEqual([]);
      expect(out.atMobiles).toEqual([]);
    });
  });

  describe("msgtype === 'audio'", () => {
    it('no recognition', () => {
      const out = extractMessageContent({ msgtype: 'audio' });
      expect(out.messageType).toBe('audio');
      expect(out.text).toBe('[语音消息]');
      expect(out.imageUrls).toEqual([]);
      expect(out.downloadCodes).toEqual([]);
      expect(out.fileNames).toEqual([]);
      expect(out.atDingtalkIds).toEqual([]);
      expect(out.atMobiles).toEqual([]);
    });
    it('with recognition', () => {
      const out = extractMessageContent({ msgtype: 'audio', content: { recognition: '转写文字' } });
      expect(out.messageType).toBe('audio');
      expect(out.text).toBe('转写文字');
    });
  });

  describe("msgtype === 'video'", () => {
    it('video branch', () => {
      const out = extractMessageContent({ msgtype: 'video' });
      expect(out.messageType).toBe('video');
      expect(out.text).toBe('[视频]');
      expect(out.imageUrls).toEqual([]);
      expect(out.downloadCodes).toEqual([]);
      expect(out.fileNames).toEqual([]);
      expect(out.atDingtalkIds).toEqual([]);
      expect(out.atMobiles).toEqual([]);
    });
  });

  describe("msgtype === 'file'", () => {
    it.each([
      { data: { msgtype: 'file' }, text: '[文件: 文件]', downloadCodes: [], fileNames: [] },
      {
        data: { msgtype: 'file', content: { fileName: 'a.pdf' } },
        text: '[文件: a.pdf]',
        downloadCodes: [],
        fileNames: [],
      },
      {
        data: { msgtype: 'file', content: { fileName: 'b.docx', downloadCode: 'fc1' } },
        text: '[文件: b.docx]',
        downloadCodes: ['fc1'],
        fileNames: ['b.docx'],
      },
    ] as const)('file branch', ({ data, text, downloadCodes, fileNames }) => {
      const out = extractMessageContent(data);
      expect(out.messageType).toBe('file');
      expect(out.text).toBe(text);
      expect(out.imageUrls).toEqual([]);
      expect(out.downloadCodes).toEqual(downloadCodes);
      expect(out.fileNames).toEqual(fileNames);
      expect(out.atDingtalkIds).toEqual([]);
      expect(out.atMobiles).toEqual([]);
    });
  });
});
