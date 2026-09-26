import { beforeEach, describe, expect, it, vi } from "vitest";
const post = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/token.ts", () => ({ DINGTALK_API: "https://api.dingtalk.com", getAccessToken: vi.fn(async () => "token") }));
vi.mock("../../src/utils/http-client.ts", () => ({ dingtalkHttp: { post, put } }));
import { createAICardForTarget, streamAICard, finishAICard } from "../../src/services/messaging/card.ts";
import { V2_CARD_TEMPLATE_ID } from "../../src/cards/structured-card.ts";
const config = { clientId: "robot", clientSecret: "secret", cardTemplateMode: "v2" as const };
beforeEach(() => { vi.clearAllMocks(); post.mockResolvedValue({ status: 200 }); put.mockResolvedValue({ status: 200 }); });

describe("v2 模板真实传输契约", () => {
  it("使用 v2 模板及变量，投放成功才返回实例", async () => {
    const card = await createAICardForTarget(config, { type: "user", userId: "u" });
    expect(card?.templateMode).toBe("v2");
    expect(post.mock.calls[0][1]).toMatchObject({ cardTemplateId: V2_CARD_TEMPLATE_ID, cardData: { cardParamMap: { blockList: "[]", content: "", hasAction: "false" } } });
    expect(post.mock.calls[1][0]).toContain("/deliver");
    post.mockRejectedValueOnce(new Error("no template permission"));
    expect(await createAICardForTarget(config, { type: "user", userId: "u" })).toBeNull();
  });
  it("流式正文使用 content，完成以 instances 原子提交 blocks 和终态，拒绝迟到帧", async () => {
    const card = (await createAICardForTarget(config, { type: "user", userId: "u" }))!;
    await streamAICard(card, "正文", false, config, undefined, { blocks: [{ type: 2, markdown: "工具已完成" }], preview: "正文", statusLine: "model" });
    expect(put.mock.calls[0][1]).toMatchObject({ key: "content", content: "正文", isFinalize: false });
    const finish = finishAICard(card, "终稿", config, undefined, { blocks: [{ type: 0, markdown: "终稿" }], statusLine: "model · 已完成" });
    const late = streamAICard(card, "迟到数据", false, config);
    await Promise.all([finish, late]);
    const final = put.mock.calls.at(-1)![1].cardData.cardParamMap;
    expect(final).toMatchObject({ flowStatus: "3", copy_content: "终稿", statusLine: "model · 已完成" });
    expect(JSON.parse(final.blockList)).toEqual([{ type: 0, markdown: "终稿" }]);
    expect(put.mock.calls.some(([, data]) => data.content === "迟到数据")).toBe(false);
  });
  it("最终提交失败向调用方报告，不能误报已交付", async () => {
    const card = (await createAICardForTarget(config, { type: "user", userId: "u" }))!;
    put.mockImplementation(async (url: string) => { if (url.endsWith("/instances")) throw new Error("final rejected"); return { status: 200 }; });
    await expect(finishAICard(card, "text", config)).rejects.toThrow("final rejected");
    expect(card.terminal).not.toBe(true);
  });
  it("保留 create/deliver 的平台消息 ID，包括真实 carrierId 引用键", async () => {
    post.mockResolvedValueOnce({ status: 200, data: { messageId: "create-id" } })
      .mockResolvedValueOnce({ status: 200, data: { processQueryKey: "query-id", result: { deliverResults: [{ carrierId: "carrier-id", success: true }] } } });
    const card = await createAICardForTarget(config, { type: "user", userId: "u" });
    expect(card?.messageIds).toEqual(["query-id", "carrier-id", "create-id"]);
  });
  it("streaming 关闭失败仍提交 instances 终态", async () => {
    const card = (await createAICardForTarget(config, { type: "user", userId: "u" }))!;
    put.mockImplementation(async (url: string) => { if (url.endsWith("/streaming")) throw new Error("stream rejected"); return { status: 200 }; });
    await expect(finishAICard(card, "final", config)).resolves.toBe(true);
    expect(card.terminal).toBe(true);
  });

});
