import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAxiosGet = vi.hoisted(() => vi.fn());
const mockAxiosPost = vi.hoisted(() => vi.fn());
const mockGetAccessToken = vi.hoisted(() => vi.fn());

vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } })),
    get: mockAxiosGet,
    post: mockAxiosPost,
  },
}));

vi.mock('../../src/utils/http-client.ts', () => ({
  dingtalkHttp: { post: mockAxiosPost, get: mockAxiosGet, put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
  dingtalkOapiHttp: { get: mockAxiosGet, post: mockAxiosPost, put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
  dingtalkUploadHttp: { post: mockAxiosPost, get: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
}));

vi.mock("../../src/utils/index.ts", () => ({
  getAccessToken: mockGetAccessToken,
  DINGTALK_API: "https://api.dingtalk.com",
}));

describe("DingtalkDocsClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAccessToken.mockResolvedValue("token-1");
  });

  it("getDocInfo returns mapped doc info", async () => {
    const { DingtalkDocsClient } = await import("../../src/docs");
    mockAxiosGet.mockResolvedValue({
      data: { docId: "d1", title: "T", docType: "alidoc", creatorId: "u1" },
    });
    const client = new DingtalkDocsClient({} as any);
    const out = await client.getDocInfo("s1", "d1");
    expect(out).toEqual({
      docId: "d1",
      title: "T",
      docType: "alidoc",
      creatorId: "u1",
      updatedAt: undefined,
    });
  });

  it("readDoc requires operatorId", async () => {
    const { DingtalkDocsClient } = await import("../../src/docs");
    const client = new DingtalkDocsClient({} as any, { error: vi.fn() });
    const out = await client.readDoc("node-1");
    expect(out).toBeNull();
  });

  it("readDoc returns formatted node text", async () => {
    const { DingtalkDocsClient } = await import("../../src/docs");
    mockAxiosGet.mockResolvedValue({
      data: {
        node: { name: "N", category: "doc", url: "u", workspaceId: "w" },
      },
    });
    const client = new DingtalkDocsClient({} as any);
    const out = await client.readDoc("node-1", "operator-1");
    expect(out).toContain("文档名: N");
    expect(out).toContain("类型: doc");
  });

  it("appendToDoc succeeds and handles failure", async () => {
    const { DingtalkDocsClient } = await import("../../src/docs");
    const client = new DingtalkDocsClient({} as any);

    mockAxiosPost.mockResolvedValueOnce({ data: {} });
    await expect(client.appendToDoc("d1", "hello")).resolves.toBe(true);

    mockAxiosPost.mockRejectedValueOnce(new Error("fail"));
    await expect(client.appendToDoc("d1", "hello")).resolves.toBe(false);
  });

  it("createDoc returns info and appends content", async () => {
    const { DingtalkDocsClient } = await import("../../src/docs");
    mockAxiosPost
      .mockResolvedValueOnce({ data: { docId: "d2", docType: "alidoc" } })
      .mockResolvedValueOnce({ data: {} });
    const client = new DingtalkDocsClient({} as any);
    const out = await client.createDoc("s1", "title", "content");
    expect(out).toEqual({ docId: "d2", title: "title", docType: "alidoc" });
    expect(mockAxiosPost).toHaveBeenCalledTimes(2);
  });

  it("searchDocs/listDocs map items and fallback on errors", async () => {
    const { DingtalkDocsClient } = await import("../../src/docs");
    const client = new DingtalkDocsClient({} as any);

    mockAxiosPost.mockResolvedValueOnce({
      data: { items: [{ docId: "d1", name: "A", docType: "alidoc" }] },
    });
    const search = await client.searchDocs("k", "s1");
    expect(search[0]).toMatchObject({ docId: "d1", title: "A" });

    mockAxiosGet.mockResolvedValueOnce({
      data: { items: [{ dentryUuid: "x1", name: "B", dentryType: "folder" }] },
    });
    const list = await client.listDocs("s1");
    expect(list[0]).toMatchObject({ docId: "x1", title: "B" });

    mockAxiosPost.mockRejectedValueOnce(new Error("search-fail"));
    await expect(client.searchDocs("k")).resolves.toEqual([]);

    mockAxiosGet.mockRejectedValueOnce(new Error("list-fail"));
    await expect(client.listDocs("s1")).resolves.toEqual([]);
  });
});
