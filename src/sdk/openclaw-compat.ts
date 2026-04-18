type RuntimeIssue = {
  path?: Array<string | number>;
  message?: string;
  code?: string;
  [key: string]: unknown;
};

type ChannelConfigSchemaCompat = {
  schema: Record<string, unknown>;
  uiHints?: Record<string, unknown>;
  runtime?: {
    safeParse: (value: unknown) =>
      | { success: true; data: unknown }
      | { success: false; issues: RuntimeIssue[] };
  };
};

type PromptSingleChannelSecretInputParams = {
  cfg?: unknown;
  prompter: {
    confirm: (params: { message: string; initialValue?: boolean }) => Promise<boolean>;
    text: (params: {
      message: string;
      placeholder?: string;
      initialValue?: string;
      validate?: (value: string) => string | undefined;
    }) => Promise<string>;
  };
  providerHint?: string;
  credentialLabel: string;
  accountConfigured?: boolean;
  canUseEnv?: boolean;
  hasConfigToken?: boolean;
  envPrompt?: string;
  keepPrompt?: string;
  inputPrompt?: string;
  preferredEnvVar?: string;
  secretInputMode?: string;
};

type PromptSingleChannelSecretInputResult = {
  action: "use-env" | "set" | "keep";
  value?: string;
  resolvedValue?: string;
};

let promptSingleChannelSecretInputImplPromise:
  | Promise<((params: PromptSingleChannelSecretInputParams) => Promise<PromptSingleChannelSecretInputResult>) | null>
  | undefined;

function cloneRuntimeIssue(issue: RuntimeIssue): RuntimeIssue {
  const record = issue && typeof issue === "object" ? issue : {};
  const path = Array.isArray(record.path)
    ? record.path.filter((segment) => {
        const kind = typeof segment;
        return kind === "string" || kind === "number";
      })
    : undefined;
  return {
    ...record,
    ...(path ? { path } : {}),
  };
}

function safeParseRuntimeSchema(schema: any, value: unknown) {
  const result = schema.safeParse(value);
  if (result.success) {
    return {
      success: true as const,
      data: result.data,
    };
  }

  return {
    success: false as const,
    issues: result.error.issues.map((issue: RuntimeIssue) => cloneRuntimeIssue(issue)),
  };
}

export function buildChannelConfigSchemaCompat(
  schema: any,
  options?: { uiHints?: Record<string, unknown> },
): ChannelConfigSchemaCompat {
  // Keep this logic local and synchronous so channel registration never depends
  // on resolving the host `openclaw` package from the plugin process.
  const schemaWithJson = schema as { toJSONSchema?: (args: unknown) => unknown };
  if (typeof schemaWithJson.toJSONSchema === "function") {
    return {
      schema: schemaWithJson.toJSONSchema({
        target: "draft-07",
        unrepresentable: "any",
      }) as Record<string, unknown>,
      ...(options?.uiHints ? { uiHints: options.uiHints } : {}),
      runtime: { safeParse: (value: unknown) => safeParseRuntimeSchema(schema, value) },
    };
  }

  return {
    schema: {
      type: "object",
      additionalProperties: true,
    } as Record<string, unknown>,
    ...(options?.uiHints ? { uiHints: options.uiHints } : {}),
    runtime: { safeParse: (value: unknown) => safeParseRuntimeSchema(schema, value) },
  };
}

async function loadPromptSingleChannelSecretInputImpl() {
  if (!promptSingleChannelSecretInputImplPromise) {
    promptSingleChannelSecretInputImplPromise = (async () => {
      try {
        const setupModule = await import("openclaw/plugin-sdk/setup");
        if (typeof (setupModule as any).promptSingleChannelSecretInput === "function") {
          return (setupModule as any).promptSingleChannelSecretInput;
        }
      } catch {}

      try {
        const sdkModule = await import("openclaw/plugin-sdk");
        if (typeof (sdkModule as any).promptSingleChannelSecretInput === "function") {
          return (sdkModule as any).promptSingleChannelSecretInput;
        }
      } catch {}

      return null;
    })();
  }

  return promptSingleChannelSecretInputImplPromise;
}

export async function promptSingleChannelSecretInputCompat(
  params: PromptSingleChannelSecretInputParams,
): Promise<PromptSingleChannelSecretInputResult> {
  const officialImpl = await loadPromptSingleChannelSecretInputImpl();
  if (officialImpl) {
    try {
      return await officialImpl(params);
    } catch {
      // Fall through to the local compatibility path when the host runtime can
      // resolve the SDK entry but still cannot execute it in this plugin setup.
    }
  }

  if (params.hasConfigToken && params.accountConfigured && params.keepPrompt) {
    const keepExisting = await params.prompter.confirm({
      message: params.keepPrompt,
      initialValue: true,
    });
    if (keepExisting) {
      return { action: "keep" };
    }
  }

  if (params.canUseEnv && params.preferredEnvVar) {
    const useEnv = await params.prompter.confirm({
      message:
        params.envPrompt ||
        `Use environment variable ${params.preferredEnvVar} for ${params.credentialLabel}?`,
      initialValue: true,
    });
    if (useEnv) {
      return { action: "use-env" };
    }
  }

  const value = String(
    await params.prompter.text({
      message: params.inputPrompt || `Enter ${params.credentialLabel}`,
      placeholder: params.preferredEnvVar ? `env:${params.preferredEnvVar} or plain text` : undefined,
      validate: (input) => (String(input ?? "").trim() ? undefined : "Required"),
    }),
  ).trim();

  return {
    action: "set",
    value,
    resolvedValue: value,
  };
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function extractShortModelName(model: unknown): string | undefined {
  const value = normalizeString(model);
  if (!value) {
    return undefined;
  }
  const segments = value.split("/");
  return segments[segments.length - 1] || value;
}

function resolveResponsePrefix(cfg: any, agentId: string): string | undefined {
  return normalizeString(
    cfg?.agents?.[agentId]?.messages?.responsePrefix ??
      cfg?.agent?.messages?.responsePrefix ??
      cfg?.messages?.responsePrefix,
  );
}

export function createReplyPrefixOptionsCompat(params: {
  cfg: any;
  agentId: string;
  channel: string;
  accountId?: string;
}) {
  // Local compatibility version. This path remains synchronous so reply
  // dispatch can initialize even when plugin-side SDK resolution fails.
  const prefixContext: Record<string, string> = {};
  const onModelSelected = (ctx: { provider?: unknown; model?: unknown; thinkLevel?: unknown }) => {
    const provider = normalizeString(ctx?.provider);
    const model = normalizeString(ctx?.model);
    const thinkingLevel = normalizeString(ctx?.thinkLevel) || "off";
    if (provider) {
      prefixContext.provider = provider;
    }
    if (model) {
      prefixContext.model = extractShortModelName(model) || model;
      prefixContext.modelFull = provider ? `${provider}/${model}` : model;
    }
    prefixContext.thinkingLevel = thinkingLevel;
  };

  return {
    responsePrefix: resolveResponsePrefix(params.cfg, params.agentId),
    responsePrefixContextProvider: () => prefixContext,
    onModelSelected,
  };
}

export function createTypingCallbacksCompat(params: {
  start: () => Promise<void>;
  stop?: () => Promise<void>;
  onStartError?: (err: unknown) => void;
  onStopError?: (err: unknown) => void;
  keepaliveIntervalMs?: number;
  maxConsecutiveFailures?: number;
  maxDurationMs?: number;
}) {
  // Local compatibility version matching the subset of typing semantics used by
  // this connector.
  const stop = params.stop;
  const keepaliveIntervalMs = params.keepaliveIntervalMs ?? 3000;
  const maxConsecutiveFailures = Math.max(1, params.maxConsecutiveFailures ?? 2);
  const maxDurationMs = params.maxDurationMs ?? 60000;

  let stopSent = false;
  let closed = false;
  let ttlTimer: ReturnType<typeof setTimeout> | undefined;
  let keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  let consecutiveFailures = 0;

  const clearTtlTimer = () => {
    if (ttlTimer) {
      clearTimeout(ttlTimer);
      ttlTimer = undefined;
    }
  };

  const clearKeepaliveTimer = () => {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = undefined;
    }
  };

  const fireStart = async () => {
    try {
      await params.start();
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      params.onStartError?.(err);
      if (consecutiveFailures >= maxConsecutiveFailures) {
        clearKeepaliveTimer();
      }
    }
  };

  const fireStop = () => {
    closed = true;
    clearKeepaliveTimer();
    clearTtlTimer();
    if (!stop || stopSent) {
      return;
    }
    stopSent = true;
    stop().catch((err) => (params.onStopError ?? params.onStartError)?.(err));
  };

  const startTtlTimer = () => {
    if (maxDurationMs <= 0) {
      return;
    }
    clearTtlTimer();
    ttlTimer = setTimeout(() => {
      if (!closed) {
        fireStop();
      }
    }, maxDurationMs);
  };

  return {
    onReplyStart: async () => {
      if (closed) {
        return;
      }
      stopSent = false;
      consecutiveFailures = 0;
      clearKeepaliveTimer();
      clearTtlTimer();
      await fireStart();
      if (consecutiveFailures >= maxConsecutiveFailures) {
        return;
      }
      keepaliveTimer = setInterval(() => {
        void fireStart();
      }, keepaliveIntervalMs);
      startTtlTimer();
    },
    onActive: () => {
      if (closed || keepaliveTimer) {
        return;
      }
      startTtlTimer();
    },
    onIdle: fireStop,
    onCleanup: fireStop,
  };
}

export function logTypingFailureCompat(params: {
  log: (message: string) => void;
  channel: string;
  action?: string;
  target?: string;
  error: unknown;
}) {
  const target = params.target ? ` target=${params.target}` : "";
  const action = params.action ? ` action=${params.action}` : "";
  params.log(`${params.channel} typing${action} failed${target}: ${String(params.error)}`);
}
