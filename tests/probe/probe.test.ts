import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearProbeCache, probeDingtalk } from "../../src/probe";

describe("probeDingtalk", () => {
  beforeEach(() => {
    clearProbeCache();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns error when credentials are missing", async () => {
    const result = await probeDingtalk(undefined);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("missing credentials");
  });

  it("returns aborted when abort signal is pre-aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await probeDingtalk(
      { clientId: "id", clientSecret: "secret" },
      { abortSignal: controller.signal },
    );
    expect(result).toEqual({
      ok: false,
      clientId: "id",
      error: "probe aborted",
    });
  });

  it("returns timeout when token request exceeds timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise(() => {
            // keep pending
          }),
      ),
    );
    const result = await probeDingtalk(
      { clientId: "id", clientSecret: "secret" },
      { timeoutMs: 1 },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("returns failure when token response has no accessToken", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        json: async () => ({}),
      })),
    );
    const result = await probeDingtalk({ clientId: "id", clientSecret: "secret" });
    expect(result).toEqual({
      ok: false,
      clientId: "id",
      error: "failed to get access token",
    });
  });

  it("returns API error from bot info endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("accessToken")) {
          return { json: async () => ({ accessToken: "tk" }) };
        }
        return { json: async () => ({ errcode: 500, errmsg: "bad" }) };
      }),
    );
    const result = await probeDingtalk({ clientId: "id", clientSecret: "secret" });
    expect(result).toEqual({
      ok: false,
      clientId: "id",
      error: "API error: bad",
    });
  });

  it("returns success and reuses cache", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("accessToken")) {
        return { json: async () => ({ accessToken: "tk" }) };
      }
      return { json: async () => ({ errcode: 0, nick: "bot-a" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const creds = { clientId: "id", clientSecret: "secret", accountId: "acc-1" };
    const first = await probeDingtalk(creds);
    const second = await probeDingtalk(creds);

    expect(first).toEqual({ ok: true, clientId: "id", botName: "bot-a" });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps probe cache separate for different endpoint configs", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("accessToken")) {
        return { json: async () => ({ accessToken: "tk" }) };
      }
      return { json: async () => ({ errcode: 0, nick: "bot-a" }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const baseCreds = { clientId: "id", clientSecret: "secret", accountId: "acc-1" };
    await probeDingtalk({ ...baseCreds, apiEndpoint: "https://api-a.example.com" });
    await probeDingtalk({ ...baseCreds, apiEndpoint: "https://api-b.example.com" });

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("catches unexpected fetch error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    const result = await probeDingtalk({ clientId: "id", clientSecret: "secret" });
    expect(result).toEqual({
      ok: false,
      clientId: "id",
      error: "network down",
    });
  });
});
