import { describe, expect, it } from "vitest";
import { DingtalkConfigSchema } from "../../src/config/schema";

describe("DingtalkConfigSchema", () => {
  it("applies defaults", () => {
    const out = DingtalkConfigSchema.parse({});
    expect(out.dmPolicy).toBe("open");
    expect(out.groupPolicy).toBe("open");
    expect(out.requireMention).toBe(true);
  });

  it("rejects unknown defaultAccount when accounts provided", () => {
    expect(() =>
      DingtalkConfigSchema.parse({
        defaultAccount: "missing",
        accounts: { main: { enabled: true } },
      }),
    ).toThrow(/defaultAccount/);
  });

  it("requires allowFrom when dmPolicy is allowlist", () => {
    expect(() => DingtalkConfigSchema.parse({ dmPolicy: "allowlist", allowFrom: [] })).toThrow(/allowFrom/);
  });

  it("accepts enableMediaUpload in per-account config", () => {
    const out = DingtalkConfigSchema.parse({
      accounts: { work: { enableMediaUpload: true } },
    });
    expect((out.accounts?.work as any)?.enableMediaUpload).toBe(true);
  });

  it("accepts systemPrompt in per-account config", () => {
    const out = DingtalkConfigSchema.parse({
      accounts: { work: { systemPrompt: "你是一个助手" } },
    });
    expect((out.accounts?.work as any)?.systemPrompt).toBe("你是一个助手");
  });
});
