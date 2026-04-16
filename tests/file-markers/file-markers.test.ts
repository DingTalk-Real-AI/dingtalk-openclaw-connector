import { describe, it, expect, vi } from 'vitest';
import { __testables } from '../test';

const { extractFileMarkers, isAudioFile } = __testables as any;

describe('isAudioFile', () => {
  it.each([
    ['mp3', true],
    ['MP3', true],
    ['Mp3', true],
    ['wav', true],
    ['amr', true],
    ['ogg', true],
    ['aac', true],
    ['flac', true],
    ['m4a', true],
    ['txt', false],
    ['', false],
    ['mp4', false],
    ['pdf', false],
  ] as const)('isAudioFile(%s) === %s', (fileType, expected) => {
    expect(isAudioFile(fileType)).toBe(expected);
  });
});

describe('extractFileMarkers', () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

  describe('no markers', () => {
    it.each([
      ['', '', []],
      ['plain text', 'plain text', []],
    ] as const)('content="%s" -> cleanedContent="%s", fileInfos.length=%s', (content, cleaned, len) => {
      const out = extractFileMarkers(content, log);
      expect(out.cleanedContent).toBe(cleaned);
      expect(out.fileInfos).toHaveLength(len);
    });
  });

  describe('valid single marker', () => {
    it('extracts path, fileName, fileType and removes marker', () => {
      const content = 'hi [DINGTALK_FILE]{"path":"/tmp/a.pdf","fileName":"a.pdf","fileType":"pdf"}[/DINGTALK_FILE] end';
      const out = extractFileMarkers(content, log);
      expect(out.fileInfos).toHaveLength(1);
      expect(out.fileInfos[0]).toEqual({ path: '/tmp/a.pdf', fileName: 'a.pdf', fileType: 'pdf' });
      expect(out.cleanedContent).toBe('hi  end');
    });
    it('accepts optional fileType and unicode fileName', () => {
      const content = '[DINGTALK_FILE]{"path":"/x.docx","fileName":"文档.docx"}[/DINGTALK_FILE]';
      const out = extractFileMarkers(content, log);
      expect(out.fileInfos).toHaveLength(1);
      expect(out.fileInfos[0].path).toBe('/x.docx');
      expect(out.fileInfos[0].fileName).toBe('文档.docx');
      expect(out.cleanedContent).toBe('');
    });
  });

  describe('missing path or fileName -> not collected', () => {
    it.each([
      ['[DINGTALK_FILE]{"path":"/x.pdf","fileName":""}[/DINGTALK_FILE]', 0],
      ['[DINGTALK_FILE]{"path":"","fileName":"a.pdf"}[/DINGTALK_FILE]', 0],
      ['[DINGTALK_FILE]{"fileName":"a.pdf"}[/DINGTALK_FILE]', 0],
      ['[DINGTALK_FILE]{"path":"/a.pdf"}[/DINGTALK_FILE]', 0],
    ] as const)('content -> fileInfos.length=%s', (content, len) => {
      const out = extractFileMarkers(content, log);
      expect(out.fileInfos).toHaveLength(len);
    });
  });

  describe('invalid JSON in marker', () => {
    it('returns empty fileInfos and removes marker', () => {
      const content = '[DINGTALK_FILE]{invalid-json}[/DINGTALK_FILE]';
      const out = extractFileMarkers(content, log);
      expect(out.fileInfos).toHaveLength(0);
      expect(out.cleanedContent).toBe('');
      expect(log.warn).toHaveBeenCalled();
    });
    it('empty object -> no path/fileName', () => {
      const content = '[DINGTALK_FILE]{}[/DINGTALK_FILE]';
      const out = extractFileMarkers(content, log);
      expect(out.fileInfos).toHaveLength(0);
      expect(out.cleanedContent).toBe('');
    });
  });

  describe('multiple markers', () => {
    it('two valid markers', () => {
      const content =
        'a [DINGTALK_FILE]{"path":"/1.pdf","fileName":"1.pdf"}[/DINGTALK_FILE] b [DINGTALK_FILE]{"path":"/2.pdf","fileName":"2.pdf"}[/DINGTALK_FILE] c';
      const out = extractFileMarkers(content, log);
      expect(out.fileInfos).toHaveLength(2);
      expect(out.fileInfos[0].fileName).toBe('1.pdf');
      expect(out.fileInfos[1].fileName).toBe('2.pdf');
      expect(out.cleanedContent).toBe('a  b  c');
    });
  });

  describe('trim cleanedContent', () => {
    it('leading/trailing spaces trimmed', () => {
      const content = '  [DINGTALK_FILE]{"path":"/a","fileName":"a"}[/DINGTALK_FILE]  ';
      const out = extractFileMarkers(content, log);
      expect(out.cleanedContent).toBe('');
    });
  });
});
