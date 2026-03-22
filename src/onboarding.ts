import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingDmPolicy,
  ClawdbotConfig,
  DmPolicy,
  SecretInput,
  WizardPrompter,
} from "openclaw/plugin-sdk";
import {
  addWildcardAllowFrom,
  DEFAULT_ACCOUNT_ID,
  formatDocsLink,
  hasConfiguredSecretInput,
} from "./sdk/helpers.ts";
import { promptSingleChannelSecretInput } from "openclaw/plugin-sdk";
import { resolveDingtalkCredentials } from "./config/accounts.ts";
import { probeDingtalk } from "./probe.ts";
import type { DingtalkConfig } from "./types/index.ts";

const channel = "dingtalk-connector" as const;

function normalizeString(value: unknown): string | undefined {
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function setDingtalkDmPolicy(cfg: ClawdbotConfig, dmPolicy: DmPolicy): ClawdbotConfig {
  const allowFrom =
    dmPolicy === "open"
      ? addWildcardAllowFrom(cfg.channels?.["dingtalk-connector"]?.allowFrom)?.map((entry) => String(entry))
      : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "dingtalk-connector": {
        ...cfg.channels?.["dingtalk-connector"],
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

function setDingtalkAllowFrom(cfg: ClawdbotConfig, allowFrom: string[]): ClawdbotConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "dingtalk-connector": {
        ...cfg.channels?.["dingtalk-connector"],
        allowFrom,
      },
    },
  };
}

function parseAllowFromInput(raw: string): string[] {
  return raw
    .split(/[\n,;]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function promptDingtalkAllowFrom(params: {
  cfg: ClawdbotConfig;
  prompter: WizardPrompter;
}): Promise<ClawdbotConfig> {
  const existing = params.cfg.channels?.["dingtalk-connector"]?.allowFrom ?? [];
  await params.prompter.note(
    [
      "Allowlist DingTalk DMs by user ID.",
      "You can find user ID in DingTalk admin console or via API.",
      "Examples:",
      "- user123456",
      "- user789012",
    ].join("\n"),
    "DingTalk allowlist",
  );

  while (true) {
    const entry = await params.prompter.text({
      message: "DingTalk allowFrom (user IDs)",
      placeholder: "user123456, user789012",
      initialValue: existing[0] ? String(existing[0]) : undefined,
      validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
    });
    const parts = parseAllowFromInput(String(entry));
    if (parts.length === 0) {
      await params.prompter.note("Enter at least one user.", "DingTalk allowlist");
      continue;
    }

    const unique = [
      ...new Set([
        ...existing.map((v: string | number) => String(v).trim()).filter(Boolean),
        ...parts,
      ]),
    ];
    return setDingtalkAllowFrom(params.cfg, unique);
  }
}

async function noteDingtalkCredentialHelp(prompter: WizardPrompter): Promise<void> {
  await prompter.note(
    [
      "1) Go to DingTalk Open Platform (open-dev.dingtalk.com)",
      "2) Create an enterprise internal app",
      "3) Get Client ID and Client Secret from Credentials page",
      "4) Enable required permissions: im:message, im:chat",
      "5) Publish the app or add it to a test group",
      "Tip: you can also set DINGTALK_CLIENT_ID / DINGTALK_CLIENT_SECRET env vars.",
      `Docs: ${formatDocsLink("/channels/dingtalk-connector", "dingtalk-connector")}`,
    ].join("\n"),
    "DingTalk credentials",
  );
}

async function promptDingtalkClientId(params: {
  prompter: WizardPrompter;
  initialValue?: string;
}): Promise<string> {
  const clientId = String(
    await params.prompter.text({
      message: "Enter DingTalk Client ID",
      initialValue: params.initialValue,
      validate: (value) => (value?.trim() ? undefined : "Required"),
    }),
  ).trim();
  return clientId;
}

function setDingtalkGroupPolicy(
  cfg: ClawdbotConfig,
  groupPolicy: "open" | "allowlist" | "disabled",
): ClawdbotConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "dingtalk-connector": {
        ...cfg.channels?.["dingtalk-connector"],
        enabled: true,
        groupPolicy,
      },
    },
  };
}

function setDingtalkGroupAllowFrom(cfg: ClawdbotConfig, groupAllowFrom: string[]): ClawdbotConfig {
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      "dingtalk-connector": {
        ...cfg.channels?.["dingtalk-connector"],
        groupAllowFrom,
      },
    },
  };
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "DingTalk",
  channel,
  policyKey: "channels.dingtalk-connector.dmPolicy",
  allowFromKey: "channels.dingtalk-connector.allowFrom",
  getCurrent: (cfg) => (cfg.channels?.["dingtalk-connector"] as DingtalkConfig | undefined)?.dmPolicy ?? "open",
  setPolicy: (cfg, policy) => setDingtalkDmPolicy(cfg, policy),
  promptAllowFrom: promptDingtalkAllowFrom,
};

export const dingtalkOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const dingtalkCfg = cfg.channels?.["dingtalk-connector"] as DingtalkConfig | undefined;

    const isClientIdConfigured = (value: unknown): boolean => {
      const asString = normalizeString(value);
      if (asString) {
        return true;
      }
      if (!value || typeof value !== "object") {
        return false;
      }
      const rec = value as Record<string, unknown>;
      const source = normalizeString(rec.source)?.toLowerCase();
      const id = normalizeString(rec.id);
      if (source === "env" && id) {
        return Boolean(normalizeString(process.env[id]));
      }
      return hasConfiguredSecretInput(value);
    };

    const topLevelConfigured = Boolean(
      isClientIdConfigured(dingtalkCfg?.clientId) && hasConfiguredSecretInput(dingtalkCfg?.clientSecret),
    );

    const accountConfigured = Object.values(dingtalkCfg?.accounts ?? {}).some((account) => {
      if (!account || typeof account !== "object") {
        return false;
      }
      const hasOwnClientId = Object.prototype.hasOwnProperty.call(account, "clientId");
      const hasOwnClientSecret = Object.prototype.hasOwnProperty.call(account, "clientSecret");
      const accountClientIdConfigured = hasOwnClientId
        ? isClientIdConfigured((account as Record<string, unknown>).clientId)
        : isClientIdConfigured(dingtalkCfg?.clientId);
      const accountSecretConfigured = hasOwnClientSecret
        ? hasConfiguredSecretInput((account as Record<string, unknown>).clientSecret)
        : hasConfiguredSecretInput(dingtalkCfg?.clientSecret);
      return Boolean(accountClientIdConfigured && accountSecretConfigured);
    });

    const configured = topLevelConfigured || accountConfigured;
    const resolvedCredentials = resolveDingtalkCredentials(dingtalkCfg, {
      allowUnresolvedSecretRef: true,
    });

    // Try to probe if configured
    let probeResult = null;
    if (configured && resolvedCredentials) {
      try {
        probeResult = await probeDingtalk(resolvedCredentials);
      } catch {
        // Ignore probe errors
      }
    }

    const statusLines: string[] = [];
    if (!configured) {
      statusLines.push("DingTalk: needs app credentials");
    } else if (probeResult?.ok) {
      statusLines.push(
        `DingTalk: connected as ${probeResult.botName ?? "bot"}`,
      );
    } else {
      statusLines.push("DingTalk: configured (connection not verified)");
    }

    return {
      channel,
      configured,
      statusLines,
      selectionHint: configured ? "configured" : "needs app creds",
      quickstartScore: configured ? 2 : 0,
    };
  },

  configure: async ({ cfg, prompter }) => {
    const dingtalkCfg = cfg.channels?.["dingtalk-connector"] as DingtalkConfig | undefined;
    const resolved = resolveDingtalkCredentials(dingtalkCfg, {
      allowUnresolvedSecretRef: true,
    });
    const hasConfigSecret = hasConfiguredSecretInput(dingtalkCfg?.clientSecret);
    const hasConfigCreds = Boolean(
      typeof dingtalkCfg?.clientId === "string" && dingtalkCfg.clientId.trim() && hasConfigSecret,
    );
    const canUseEnv = Boolean(
      !hasConfigCreds && process.env.DINGTALK_CLIENT_ID?.trim() && process.env.DINGTALK_CLIENT_SECRET?.trim(),
    );

    let next = cfg;
    let clientId: string | null = null;
    let clientSecret: SecretInput | null = null;
    let clientSecretProbeValue: string | null = null;

    if (!resolved) {
      await noteDingtalkCredentialHelp(prompter);
    }

    // Check if we can use environment variables
    if (canUseEnv) {
      const useEnv = await prompter.confirm({
        message: "DINGTALK_CLIENT_ID + DINGTALK_CLIENT_SECRET detected. Use env vars?",
        initialValue: true,
      });

      if (useEnv) {
        next = {
          ...next,
          channels: {
            ...next.channels,
            "dingtalk-connector": { ...next.channels?.["dingtalk-connector"], enabled: true },
          },
        };
        // Environment variables will be used, skip manual input
      } else {
        // User chose not to use env vars, proceed to manual input
        canUseEnv = false;
      }
    }

    // If not using env vars, prompt for credentials
    if (!canUseEnv) {
      // Check if we should keep existing configuration
      if (resolved && hasConfigSecret) {
        const keepExisting = await prompter.confirm({
          message: "DingTalk credentials already configured. Keep them?",
          initialValue: true,
        });

        if (!keepExisting) {
          // User wants to reconfigure, proceed to input
          // Step 1: Prompt for Client ID first
          clientId = await promptDingtalkClientId({
            prompter,
            initialValue:
              normalizeString(dingtalkCfg?.clientId) ?? normalizeString(process.env.DINGTALK_CLIENT_ID),
          });

          // Step 2: Then prompt for Client Secret
          const clientSecretResult = await promptSingleChannelSecretInput({
            cfg: next,
            prompter,
            providerHint: "dingtalk",
            credentialLabel: "Client Secret",
            accountConfigured: false, // Force new input
            canUseEnv: false, // Already handled above
            hasConfigToken: false, // Force new input
            envPrompt: "", // Not used
            keepPrompt: "", // Not used
            inputPrompt: "Enter DingTalk Client Secret",
            preferredEnvVar: "DINGTALK_CLIENT_SECRET",
          });

          if (clientSecretResult.action === "set") {
            clientSecret = clientSecretResult.value;
            clientSecretProbeValue = clientSecretResult.resolvedValue;
          }
        }
        // If keepExisting is true, we don't modify anything
      } else {
        // No existing config, prompt for new credentials
        // Step 1: Prompt for Client ID first
        clientId = await promptDingtalkClientId({
          prompter,
          initialValue:
            normalizeString(dingtalkCfg?.clientId) ?? normalizeString(process.env.DINGTALK_CLIENT_ID),
        });

        // Step 2: Then prompt for Client Secret
        const clientSecretResult = await promptSingleChannelSecretInput({
          cfg: next,
          prompter,
          providerHint: "dingtalk",
          credentialLabel: "Client Secret",
          accountConfigured: false,
          canUseEnv: false,
          hasConfigToken: false,
          envPrompt: "",
          keepPrompt: "",
          inputPrompt: "Enter DingTalk Client Secret",
          preferredEnvVar: "DINGTALK_CLIENT_SECRET",
        });

        if (clientSecretResult.action === "set") {
          clientSecret = clientSecretResult.value;
          clientSecretProbeValue = clientSecretResult.resolvedValue;
        }
      }
    }

    if (clientId && clientSecret) {
      next = {
        ...next,
        channels: {
          ...next.channels,
          "dingtalk-connector": {
            ...next.channels?.["dingtalk-connector"],
            enabled: true,
            clientId,
            clientSecret,
          },
        },
      };

      // Test connection
      try {
        const probe = await probeDingtalk({
          clientId,
          clientSecret: clientSecretProbeValue ?? undefined,
        });
        if (probe.ok) {
          await prompter.note(
            `Connected as ${probe.botName ?? "bot"}`,
            "DingTalk connection test",
          );
        } else {
          await prompter.note(
            `Connection failed: ${probe.error ?? "unknown error"}`,
            "DingTalk connection test",
          );
        }
      } catch (err) {
        await prompter.note(`Connection test failed: ${String(err)}`, "DingTalk connection test");
      }
    }

    // Group policy
    const groupPolicy = await prompter.select({
      message: "Group chat policy",
      options: [
        { value: "allowlist", label: "Allowlist - only respond in specific groups" },
        { value: "open", label: "Open - respond in all groups (requires mention)" },
        { value: "disabled", label: "Disabled - don't respond in groups" },
      ],
      initialValue: (next.channels?.["dingtalk-connector"] as DingtalkConfig | undefined)?.groupPolicy ?? "open",
    });
    if (groupPolicy) {
      next = setDingtalkGroupPolicy(next, groupPolicy as "open" | "allowlist" | "disabled");
    }

    // Group allowlist if needed
    if (groupPolicy === "allowlist") {
      const existing = (next.channels?.["dingtalk-connector"] as DingtalkConfig | undefined)?.groupAllowFrom ?? [];
      const entry = await prompter.text({
        message: "Group chat allowlist (conversation IDs)",
        placeholder: "cidxxxx, cidyyyy",
        initialValue: existing.length > 0 ? existing.map(String).join(", ") : undefined,
      });
      if (entry) {
        const parts = parseAllowFromInput(String(entry));
        if (parts.length > 0) {
          next = setDingtalkGroupAllowFrom(next, parts);
        }
      }
    }

    return { cfg: next, accountId: DEFAULT_ACCOUNT_ID };
  },

  dmPolicy,

  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      "dingtalk-connector": { ...cfg.channels?.["dingtalk-connector"], enabled: false },
    },
  }),
};
