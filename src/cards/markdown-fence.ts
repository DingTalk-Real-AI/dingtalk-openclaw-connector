export interface MarkdownFence { marker: string; opening: string }
/** 围栏只由同字符、足够长度且无尾随内容的行关闭，代码示例不得触发图片上传。 */
export function advanceMarkdownFence(line: string, current?: MarkdownFence): {
  current?: MarkdownFence; isFence: boolean;
} {
  const match = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
  if (!match) return { current, isFence: false };
  if (!current) return { current: { marker: match[1], opening: match[1] + match[2] }, isFence: true };
  if (match[1][0] === current.marker[0] && match[1].length >= current.marker.length && !match[2].trim()) return { isFence: true };
  return { current, isFence: false };
}

/** 行内代码和转义图片只展示原文，不能被解释成媒体操作。 */
export function isLiteralMarkdownImage(line: string, index: number): boolean {
  let escapes = 0;
  for (let i = index - 1; i >= 0 && line[i] === "\\"; i--) escapes++;
  if (escapes % 2) return true;
  let ticks = 0;
  for (const token of line.slice(0, index).matchAll(/`+/g)) {
    if (token.index! > 0 && line[token.index! - 1] === "\\") continue;
    if (!ticks) ticks = token[0].length;
    else if (ticks === token[0].length) ticks = 0;
  }
  return ticks > 0;
}
