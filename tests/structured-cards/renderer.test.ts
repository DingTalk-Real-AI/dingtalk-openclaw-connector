import { describe, expect, it, vi, afterEach } from "vitest";
import { markdownToCardBlocks, splitCardMarkdown, StructuredCardDraft } from "../../src/cards/structured-card.ts";

afterEach(() => vi.useRealTimers());
describe("v2 结构化草稿", () => {
  it("保留正文、原生图片、表格的顺序，代码块图片示例不执行", () => {
    const blocks = markdownToCardBlocks("前文\n![图](@media)\n| 列 |\n| --- |\n| 值 |\n```md\n![示例](@fake)\n```");
    expect(blocks.map(block => block.type)).toEqual([0, 3, 0]);
    expect(blocks[1]).toEqual({ type: 3, mediaId: "@media", text: "图" });
    expect(blocks[2]).toMatchObject({ markdown: expect.stringContaining("![示例](@fake)") });
  });
  it("长中文和代码块拆分时控制 UTF-8 大小并保持围栏", () => {
    const chunks = splitCardMarkdown("```ts\n" + "const x = '正文';\n".repeat(1100) + "```");
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk)).toBeLessThanOrEqual(6000);
      expect(chunk.startsWith("```ts\n")).toBe(true);
      expect(chunk.endsWith("```" )).toBe(true);
    }
  });
  it("跨助手消息保留工具时间线，完成时只提交最终正文一次", () => {
    const draft = new StructuredCardDraft("agent");
    draft.setAnswer("先检查");
    draft.tool("call1", "search", "start");
    draft.beginAnswer();
    draft.setAnswer("最后答复");
    expect(draft.presentation().preview).toBe("最后答复");
    expect(draft.presentation().blocks.map(b => b.type)).toEqual([0, 2]);
    draft.tool("call1", "search", "end");
    expect(draft.presentation(true).blocks).toEqual([
      { type: 0, markdown: "先检查" }, { type: 2, markdown: "search · 已完成" }, { type: 0, markdown: "最后答复" },
    ]);
  });
  it("状态行只显示实际提供的模型、Agent 和实测时长", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-26T00:00:00Z"));
    const draft = new StructuredCardDraft("helper");
    expect(draft.statusLine()).toBe("helper · 0s · 生成中");
    draft.setModel("test-model");
    vi.advanceTimersByTime(3200); draft.outcome = "stopped";
    expect(draft.statusLine()).toBe("helper · test-model · 3s · 已停止");
    expect(new StructuredCardDraft("hidden", false).statusLine()).toBeUndefined();
  });
});
