import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAxiosPost = vi.hoisted(() => vi.fn());
const mockAxiosGet = vi.hoisted(() => vi.fn());

vi.mock("axios", () => ({
  default: {
    create: vi.fn(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } })),
    post: mockAxiosPost,
    get: mockAxiosGet,
  },
}));

vi.mock('../../src/utils/http-client.ts', () => ({
  dingtalkHttp: { post: mockAxiosPost, get: mockAxiosGet, put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
  dingtalkOapiHttp: { get: mockAxiosGet, post: mockAxiosPost, put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
  dingtalkUploadHttp: { post: mockAxiosPost, get: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), defaults: { headers: { common: {} } } },
}));

vi.mock("form-data", () => ({
  default: class FormData {
    data: Record<string, any> = {};
    append(k: string, v: any) {
      this.data[k] = v;
    }
    getHeaders() {
      return { "content-type": "multipart/form-data" };
    }
  },
}));

vi.mock("fs", () => ({
  existsSync: vi.fn(() => true),
  statSync: vi.fn(() => ({ size: 100 })),
  readFileSync: vi.fn(() => Buffer.alloc(100)),
  mkdirSync: vi.fn(),
}));

vi.mock("path", () => ({
  resolve: (p: string) => p,
  basename: (p: string) => p.split("/").pop() || "",
}));

describe("chunk-upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enableUploadTransaction returns upload_id on success", async () => {
    mockAxiosPost.mockResolvedValueOnce({
      data: { errcode: 0, upload_id: "uid-1" },
    });
    const { enableUploadTransaction } = await import("../../src/services/media/chunk-upload");
    const id = await enableUploadTransaction("tk", "f.mp4", 1024);
    expect(id).toBe("uid-1");
  });

  it("enableUploadTransaction returns null on API error", async () => {
    mockAxiosPost.mockResolvedValueOnce({
      data: { errcode: 1, errmsg: "bad" },
    });
    const { enableUploadTransaction } = await import("../../src/services/media/chunk-upload");
    expect(await enableUploadTransaction("tk", "f.mp4", 1024)).toBeNull();
  });

  it("enableUploadTransaction returns null on exception", async () => {
    mockAxiosPost.mockRejectedValueOnce(new Error("net"));
    const { enableUploadTransaction } = await import("../../src/services/media/chunk-upload");
    expect(await enableUploadTransaction("tk", "f.mp4", 1024)).toBeNull();
  });

  it("uploadFileBlock returns true/false", async () => {
    mockAxiosPost.mockResolvedValueOnce({ data: { errcode: 0 } });
    const { uploadFileBlock } = await import("../../src/services/media/chunk-upload");
    expect(await uploadFileBlock("tk", "uid", Buffer.alloc(10), 1, 1)).toBe(true);

    mockAxiosPost.mockResolvedValueOnce({ data: { errcode: 1, errmsg: "err" } });
    expect(await uploadFileBlock("tk", "uid", Buffer.alloc(10), 1, 1)).toBe(false);

    mockAxiosPost.mockRejectedValueOnce(new Error("net"));
    expect(await uploadFileBlock("tk", "uid", Buffer.alloc(10), 1, 1)).toBe(false);
  });

  it("submitUploadTransaction returns result on success", async () => {
    mockAxiosGet.mockResolvedValueOnce({
      data: { errcode: 0, file_id: "f1", download_code: "dc1" },
    });
    const { submitUploadTransaction } = await import("../../src/services/media/chunk-upload");
    const out = await submitUploadTransaction("tk", "uid", "f.mp4");
    expect(out).toEqual({ fileId: "f1", downloadCode: "dc1" });
  });

  it("submitUploadTransaction returns null on failure", async () => {
    mockAxiosGet.mockResolvedValueOnce({ data: { errcode: 1, errmsg: "err" } });
    const { submitUploadTransaction } = await import("../../src/services/media/chunk-upload");
    expect(await submitUploadTransaction("tk", "uid", "f.mp4")).toBeNull();

    mockAxiosGet.mockRejectedValueOnce(new Error("net"));
    expect(await submitUploadTransaction("tk", "uid", "f.mp4")).toBeNull();
  });

  it("uploadLargeFileByChunks orchestrates full flow", async () => {
    mockAxiosPost
      .mockResolvedValueOnce({ data: { errcode: 0, upload_id: "uid" } })
      .mockResolvedValueOnce({ data: { errcode: 0 } });
    mockAxiosGet.mockResolvedValueOnce({
      data: { errcode: 0, file_id: "f", download_code: "dc" },
    });
    const { uploadLargeFileByChunks } = await import("../../src/services/media/chunk-upload");
    const code = await uploadLargeFileByChunks("/tmp/f.mp4", "video", "tk");
    expect(code).toBe("dc");
  });

  it("uploadLargeFileByChunks returns null when file missing", async () => {
    const fs = await import("fs");
    (fs.existsSync as any).mockReturnValueOnce(false);
    const { uploadLargeFileByChunks } = await import("../../src/services/media/chunk-upload");
    expect(await uploadLargeFileByChunks("/missing.mp4", "video", "tk")).toBeNull();
  });

  it("CHUNK_CONFIG is exported", async () => {
    const { CHUNK_CONFIG } = await import("../../src/services/media/chunk-upload");
    expect(CHUNK_CONFIG.SIZE_THRESHOLD).toBe(20 * 1024 * 1024);
  });
});
