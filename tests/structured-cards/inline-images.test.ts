import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInlineImageProcessor } from "../../src/cards/inline-images.ts";
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe("v2 图片安全与缓存", () => {
  it("在允许根中上传一次，保留代码示例并拒绝 symlink 越界", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dingtalk-card-test-")); dirs.push(dir);
    const root = path.join(dir, "workspace"); await mkdir(root);
    await writeFile(path.join(root, "image.png"), "png");
    await writeFile(path.join(dir, "outside.png"), "secret");
    await symlink(path.join(dir, "outside.png"), path.join(root, "linked.png"));
    const upload = vi.fn().mockResolvedValue("@media");
    const process = createInlineImageProcessor({ roots: [root], upload });
    expect(await process("![正常](image.png)\n![越界](linked.png)\n![远端](https://example.org/a.png)"))
      .toBe("![正常](@media)\n[越界：图片未上传]\n![远端](https://example.org/a.png)");
    expect(await process("![正常](image.png)")).toBe("![正常](@media)");
    expect(await process("```md\n![代码](image.png)\n```")).toContain("(image.png)");
    expect(await process("~~~~md\n```\n![仍在代码里](other.png)\n~~~\n![仍在长围栏里](another.png)\n~~~~")).toContain("(another.png)");
    expect(await process("`![代码](secret.png)` 和 \\![转义](other.png)")).toContain("(secret.png)");
    expect(upload).toHaveBeenCalledTimes(1);
  });
  it("未知根与上传失败都保留可读占位，不扩大本地文件读取范围", async () => {
    const upload = vi.fn().mockRejectedValue(new Error("failed"));
    const process = createInlineImageProcessor({ roots: [], upload });
    expect(await process("![图片](/private/secret.png)")).toBe("[图片：图片未上传]");
    expect(upload).not.toHaveBeenCalled();
  });
});
