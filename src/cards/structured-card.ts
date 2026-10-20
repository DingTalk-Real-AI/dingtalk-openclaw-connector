import { advanceMarkdownFence, isLiteralMarkdownImage, type MarkdownFence } from "./markdown-fence.ts";
/**
 * 钉钉 v2 模板变量契约：blockList/content/copy_content/statusLine/flowStatus。
 * 协议依据（独立实现，未复制社区代码）：
 * https://github.com/soimy/openclaw-channel-dingtalk/blob/8a73a59fd8513a89e5f2219adaec61c7c4ceab9a/src/card/card-template.ts
 * https://github.com/soimy/openclaw-channel-dingtalk/blob/8a73a59fd8513a89e5f2219adaec61c7c4ceab9a/src/card/card-draft-controller.ts
 */
export const V2_CARD_TEMPLATE_ID = "675cde2f-f526-40cb-b828-f5b2b57b8b77.schema";
export type CardBlock =
  | { type: 0 | 2; markdown: string }
  | { type: 3; mediaId: string; text?: string };
export type CardOutcome = "running" | "completed" | "failed" | "stopped";
export interface CardPresentation {
  blocks: CardBlock[];
  preview?: string;
  statusLine?: string;
  outcome?: CardOutcome;
}

// 为模板单 Markdown block 的大小限制保留余量；UTF-8 计数涵盖中文。
const BLOCK_BYTES = 6000;
export function splitCardMarkdown(text: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  let fence: MarkdownFence | undefined;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const transition = advanceMarkdownFence(line, fence);
    const pieces: string[] = [];
    let piece = "";
    for (const char of line) {
      if (Buffer.byteLength(piece + char) > BLOCK_BYTES - 256) {
        pieces.push(piece);
        piece = "";
      }
      piece += char;
    }
    pieces.push(piece);
    for (const part of pieces) {
      if (chunk && Buffer.byteLength(chunk + "\n" + part) > BLOCK_BYTES - 128) {
        chunks.push(chunk + (fence ? `\n${fence.marker}` : ""));
        chunk = fence ? `${fence.opening}\n${part}` : part;
      } else {
        chunk += (chunk ? "\n" : "") + part;
      }
    }
    fence = transition.current;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

/** 仅已上传的钉钉 mediaId 转原生图片；URL 仍由 Markdown 渲染，不主动抓取。 */
export function markdownToCardBlocks(text: string): CardBlock[] {
  const blocks: CardBlock[] = [];
  let pending = "";
  let fence: MarkdownFence | undefined;
  const flush = () => {
    if (pending.trim()) blocks.push(...splitCardMarkdown(pending.trim()).map(markdown => ({ type: 0 as const, markdown })));
    pending = "";
  };
  for (const line of text.split("\n")) {
    const transition = advanceMarkdownFence(line, fence);
    fence = transition.current;
    if (fence || transition.isFence) {
      pending += line + "\n";
      continue;
    }
    let cursor = 0;
    for (const image of line.matchAll(/!\[([^\]]*)\]\((@[^\s)]+)\)/g)) {
      if (isLiteralMarkdownImage(line, image.index!)) continue;
      pending += line.slice(cursor, image.index);
      flush();
      blocks.push({ type: 3, mediaId: image[2], ...(image[1] ? { text: image[1] } : {}) });
      cursor = image.index! + image[0].length;
    }
    pending += line.slice(cursor) + "\n";
  }
  flush();
  return blocks;
}

interface Entry { kind: "answer" | "tool"; text: string; id?: string }
export class StructuredCardDraft {
  private entries: Entry[] = [];
  private answer: Entry | undefined;
  private model: string | undefined;
  private usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number } | undefined;
  private startedAt = Date.now();
  outcome: CardOutcome = "running";
  constructor(private agentId: string, private showMetadata = true) {}

  setModel(model: string) { this.model = model; }
  setUsage(usage: typeof this.usage) { this.usage = usage; }
  beginAnswer() { this.answer = undefined; }
  setAnswer(text: string) {
    if (!this.answer) {
      this.answer = { kind: "answer", text };
      this.entries.push(this.answer);
    } else this.answer.text = text;
  }
  tool(id: string, name: string, phase?: string) {
    const safeName = name.replace(/[\r\n]/g, " ").slice(0, 100);
    const text = `${safeName || "工具"} · ${phase === "end" || phase === "completed" ? "已完成" : phase === "error" || phase === "failed" ? "失败" : "执行中"}`;
    const existing = this.entries.find(e => e.kind === "tool" && e.id === id);
    if (existing) existing.text = text;
    else {
      this.entries.push({ kind: "tool", id, text });
      // 工具进度只保留最近 32 条，避免长任务耗尽卡片变量空间。
      if (this.entries.filter(e => e.kind === "tool").length > 32) {
        this.entries.splice(this.entries.findIndex(e => e.kind === "tool"), 1);
      }
    }
  }
  statusLine(): string | undefined {
    if (!this.showMetadata) return undefined;
    const label = { running: "生成中", completed: "已完成", failed: "失败", stopped: "已停止" }[this.outcome];
    const counts = Object.entries({ input: "输入", output: "输出", cacheRead: "缓存读", cacheWrite: "缓存写", total: "总计" })
      .flatMap(([key, label]) => {
        const value = this.usage?.[key as keyof NonNullable<typeof this.usage>];
        return typeof value === "number" && Number.isFinite(value) && value >= 0 ? [`${label} ${value}`] : [];
      });
    return [this.agentId, this.model, ...counts, `${Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000))}s`, label].filter(Boolean).join(" · ");
  }
  presentation(final = false): CardPresentation {
    const blocks: CardBlock[] = [];
    let preview = "";
    for (const entry of this.entries) {
      if (entry.kind === "tool") blocks.push({ type: 2, markdown: entry.text });
      else {
        const answerBlocks = markdownToCardBlocks(entry.text);
        if (!final && entry === this.answer && !answerBlocks.some(b => b.type === 3) && answerBlocks.length <= 1) preview = entry.text;
        else blocks.push(...answerBlocks);
      }
    }
    return { blocks, preview, statusLine: this.statusLine(), outcome: this.outcome };
  }
}
