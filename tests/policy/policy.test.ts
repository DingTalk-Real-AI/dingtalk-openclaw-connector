import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/accounts.ts", () => ({
  resolveDingtalkAccount: vi.fn((params: any) => {
    return params._mockAccount ?? { config: {} };
  }),
}));

import { resolveDingtalkGroupToolPolicy } from "../../src/policy";
import { resolveDingtalkAccount } from "../../src/config/accounts.ts";

describe("resolveDingtalkGroupToolPolicy", () => {
  it("returns group-level tools policy when configured", () => {
    (resolveDingtalkAccount as any).mockReturnValue({
      config: {
        groups: {
          g1: {
            tools: { allow: ["sendMessage"], deny: ["deleteMessage"] },
          },
        },
      },
    });

    const cfg = {} as any;
    const policy = resolveDingtalkGroupToolPolicy({ cfg, groupId: "g1" });
    expect(policy).toEqual({ allow: ["sendMessage"], deny: ["deleteMessage"] });
  });

  it("falls back to allow-all policy when group config missing", () => {
    (resolveDingtalkAccount as any).mockReturnValue({
      config: {
        groups: {},
      },
    });

    const cfg = {} as any;
    const policy = resolveDingtalkGroupToolPolicy({ cfg, groupId: "missing" });
    expect(policy).toEqual({ allow: ["*"] });
  });
});
