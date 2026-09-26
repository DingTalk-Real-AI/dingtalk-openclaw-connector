import { advanceMarkdownFence, isLiteralMarkdownImage, type MarkdownFence } from "./markdown-fence.ts";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 每次生成独享缓存，避免多个增量帧重复上传同一张图片。 */
export function createInlineImageProcessor(options: {
  roots: readonly string[];
  upload: (filePath: string) => Promise<string | undefined>;
}) {
  const cache = new Map<string, Promise<string | undefined>>();
  const roots = Promise.all(options.roots.map(root => realpath(root).catch(() => "")));
  const upload = (raw: string) => {
    if (!cache.has(raw)) cache.set(raw, (async () => {
      let candidate: string;
      try { candidate = raw.startsWith("file://") ? fileURLToPath(raw) : decodeURIComponent(raw.replace(/\\ /g, " ")); }
      catch { return undefined; }
      const allowed = (await roots).filter(Boolean);
      if (!allowed.length) return undefined;
      const candidates = path.isAbsolute(candidate) ? [candidate] : allowed.map(root => path.resolve(root, candidate));
      for (const file of candidates) {
        try {
          const resolved = await realpath(file);
          if (!allowed.some(root => { const rel = path.relative(root, resolved); return rel !== "" && rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel); })) continue;
          const info = await stat(resolved);
          if (!info.isFile() || info.size > 20 * 1024 * 1024) continue;
          return await options.upload(resolved);
        } catch { /* 上传失败保留说明文字，不中断正文交付。 */ }
      }
      return undefined;
    })());
    return cache.get(raw)!;
  };
  return async (text: string): Promise<string> => {
    let fence: MarkdownFence | undefined;
    const lines: string[] = [];
    for (const line of text.split("\n")) {
      const transition = advanceMarkdownFence(line, fence);
      fence = transition.current;
      if (fence || transition.isFence) { lines.push(line); continue; }
      let result = line;
      for (const image of [...line.matchAll(/!\[([^\]]*)\]\(([^\n)]+)\)/g)].reverse()) {
        if (isLiteralMarkdownImage(line, image.index!)) continue;
        const source = image[2];
        if (source.startsWith("@") || /^https?:\/\//i.test(source)) continue;
        const mediaId = await upload(source);
        const replacement = mediaId ? `![${image[1]}](${mediaId})` : `[${image[1] || "图片"}：图片未上传]`;
        result = result.slice(0, image.index) + replacement + result.slice(image.index! + image[0].length);
      }
      lines.push(result);
    }
    return lines.join("\n");
  };
}
