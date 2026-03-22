import type {
  ChannelMeta,
  ChannelPlugin,
  ClawdbotConfig,
} from "openclaw/plugin-sdk";
import {
  buildBaseChannelStatusSummary,
  createDefaultChannelRuntimeState,
  DEFAULT_ACCOUNT_ID,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
} from "./sdk/helpers.ts";
import { createLogger } from "./utils/logger.ts";
import {
  resolveDingtalkAccount,
  resolveDingtalkCredentials,
  listDingtalkAccountIds,
  resolveDefaultDingtalkAccountId,
} from "./config/accounts.ts";
import {
  listDingtalkDirectoryPeers,
  listDingtalkDirectoryGroups,
  listDingtalkDirectoryPeersLive,
  listDingtalkDirectoryGroupsLive,
} from "./directory.ts";
import { resolveDingtalkGroupToolPolicy } from "./policy.ts";
import { probeDingtalk } from "./probe.ts";
import { normalizeDingtalkTarget, looksLikeDingtalkId } from "./targets.ts";
import { dingtalkOnboardingAdapter } from "./onboarding.ts";
import { monitorDingtalkProvider } from "./core/provider.ts";
import { sendTextToDingTalk, sendMediaToDingTalk } from "./services/messaging/index.ts";
import type { ResolvedDingtalkAccount, DingtalkConfig } from "./types/index.ts";

const meta: ChannelMeta = {
  id: "dingtalk-connector",
  label: "DingTalk",
  selectionLabel: "DingTalk (钉钉)",
  docsPath: "/channels/dingtalk-connector",
  docsLabel: "dingtalk-connector",
  blurb: "钉钉企业内部机器人，使用 Stream 模式，无需公网 IP，支持 AI Card 流式响应。",
  aliases: ["dd", "ding"],
  order: 70,
};

const secretInputJsonSchema = {
  oneOf: [
    { type: "string" },
    {
      type: "object",
      additionalProperties: false,
      required: ["source", "provider", "id"],
      properties: {
        source: { type: "string", enum: ["env", "file", "exec"] },
        provider: { type: "string", minLength: 1 },
        id: { type: "string", minLength: 1 },
      },
    },
  ],
} as const;

export const dingtalkPlugin: ChannelPlugin<ResolvedDingtalkAccount> = {
  id: "dingtalk-connector",
  meta: {
    ...meta,
  },
  pairing: {
    idLabel: "dingtalkUserId",
    normalizeAllowEntry: (entry) => entry.replace(/^(dingtalk|user|dd):/i, ""),
    notifyApproval: async ({ cfg, id }) => {
      // TODO: Implement notification when pairing is approved
      const logger = createLogger(false, 'DingTalk:Pairing');
      logger.info(`Pairing approved for user: ${id}`);
    },
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    polls: false,
    threads: false,
    media: true,  // ✅ 启用媒体支持
    reactions: false,
    edit: false,
    reply: false,
  },
  agentPrompt: {
    messageToolHints: () => [
      "- DingTalk targeting: omit `target` to reply to the current conversation (auto-inferred). Explicit targets: `user:userId` or `group:conversationId`.",
      "- DingTalk supports interactive cards for rich messages.",
    ],
  },
  groups: {
    resolveToolPolicy: resolveDingtalkGroupToolPolicy,
  },
  mentions: {
    stripPatterns: () => ['@[^\\s]+'], // Strip @mentions
  },
  reload: { configPrefixes: ["channels.dingtalk-connector"] },
  configSchema: {
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean" },
        defaultAccount: { type: "string" },
        clientId: { oneOf: [{ type: "string" }, { type: "number" }] },
        clientSecret: secretInputJsonSchema,
        enableMediaUpload: { type: "boolean" },
        systemPrompt: { type: "string" },
        dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
        allowFrom: { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } },
        groupPolicy: { type: "string", enum: ["open", "allowlist", "disabled"] },
        groupAllowFrom: {
          type: "array",
          items: { oneOf: [{ type: "string" }, { type: "number" }] },
        },
        requireMention: { type: "boolean" },
        groupSessionScope: {
          type: "string",
          enum: ["group", "group_sender"],
        },
        separateSessionByConversation: { type: "boolean" },
        sharedMemoryAcrossConversations: { type: "boolean" },
        historyLimit: { type: "integer", minimum: 0 },
        dmHistoryLimit: { type: "integer", minimum: 0 },
        textChunkLimit: { type: "integer", minimum: 1 },
        mediaMaxMb: { type: "number", minimum: 0 },
        typingIndicator: { type: "boolean" },
        resolveSenderNames: { type: "boolean" },
        tools: {
          type: "object",
          additionalProperties: false,
          properties: {
            docs: { type: "boolean" },
            media: { type: "boolean" },
          },
        },
        groups: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              requireMention: { type: "boolean" },
              tools: {
                type: "object",
                properties: {
                  allow: { type: "array", items: { type: "string" } },
                  deny: { type: "array", items: { type: "string" } },
                },
              },
              enabled: { type: "boolean" },
              allowFrom: { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } },
              systemPrompt: { type: "string" },
              groupSessionScope: {
                type: "string",
                enum: ["group", "group_sender"],
              },
            },
          },
        },
        accounts: {
          type: "object",
          additionalProperties: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              name: { type: "string" },
              clientId: { oneOf: [{ type: "string" }, { type: "number" }] },
              clientSecret: secretInputJsonSchema,
              enableMediaUpload: { type: "boolean" },
              systemPrompt: { type: "string" },
              dmPolicy: { type: "string", enum: ["open", "pairing", "allowlist"] },
              allowFrom: { type: "array", items: { oneOf: [{ type: "string" }, { type: "number" }] } },
              groupPolicy: { type: "string", enum: ["open", "allowlist", "disabled"] },
              groupAllowFrom: {
                type: "array",
                items: { oneOf: [{ type: "string" }, { type: "number" }] },
              },
              requireMention: { type: "boolean" },
              groupSessionScope: {
                type: "string",
                enum: ["group", "group_sender"],
              },
              separateSessionByConversation: { type: "boolean" },
              sharedMemoryAcrossConversations: { type: "boolean" },
              historyLimit: { type: "integer", minimum: 0 },
              textChunkLimit: { type: "integer", minimum: 1 },
              mediaMaxMb: { type: "number", minimum: 0 },
              typingIndicator: { type: "boolean" },
              tools: {
                type: "object",
                additionalProperties: false,
                properties: {
                  docs: { type: "boolean" },
                  media: { type: "boolean" },
                },
              },
            },
          },
        },
      },
    },
  },
  config: {
    listAccountIds: (cfg) => listDingtalkAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveDingtalkAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultDingtalkAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const account = resolveDingtalkAccount({ cfg, accountId });
      const isDefault = accountId === DEFAULT_ACCOUNT_ID;

      if (isDefault) {
        // For default account, set top-level enabled
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            "dingtalk-connector": {
              ...cfg.channels?.["dingtalk-connector"],
              enabled,
            },
          },
        };
      }

      // For named accounts, set enabled in accounts[accountId]
      const dingtalkCfg = cfg.channels?.["dingtalk-connector"] as DingtalkConfig | undefined;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          "dingtalk-connector": {
            ...dingtalkCfg,
            accounts: {
              ...dingtalkCfg?.accounts,
              [accountId]: {
                ...dingtalkCfg?.accounts?.[accountId],
                enabled,
              },
            },
          },
        },
      };
    },
    deleteAccount: ({ cfg, accountId }) => {
      const isDefault = accountId === DEFAULT_ACCOUNT_ID;

      if (isDefault) {
        // Delete entire dingtalk-connector config
        const next = { ...cfg } as ClawdbotConfig;
        const nextChannels = { ...cfg.channels };
        delete (nextChannels as Record<string, unknown>)["dingtalk-connector"];
        if (Object.keys(nextChannels).length > 0) {
          next.channels = nextChannels;
        } else {
          delete next.channels;
        }
        return next;
      }

      // Delete specific account from accounts
      const dingtalkCfg = cfg.channels?.["dingtalk-connector"] as DingtalkConfig | undefined;
      const accounts = { ...dingtalkCfg?.accounts };
      delete accounts[accountId];

      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          "dingtalk-connector": {
            ...dingtalkCfg,
            accounts: Object.keys(accounts).length > 0 ? accounts : undefined,
          },
        },
      };
    },
    isConfigured: (account) => account.configured,
    describeAccount: (account) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name,
      clientId: account.clientId,
    }),
    resolveAllowFrom: ({ cfg, accountId }) => {
      const account = resolveDingtalkAccount({ cfg, accountId });
      return (account.config?.allowFrom ?? []).map((entry) => String(entry));
    },
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.toLowerCase()),
  },
  security: {
    collectWarnings: ({ cfg, accountId }) => {
      const account = resolveDingtalkAccount({ cfg, accountId });
      const dingtalkCfg = account.config;
      const defaultGroupPolicy = resolveDefaultGroupPolicy(cfg);
      const { groupPolicy } = resolveAllowlistProviderRuntimeGroupPolicy({
        providerConfigPresent: cfg.channels?.["dingtalk-connector"] !== undefined,
        groupPolicy: dingtalkCfg?.groupPolicy,
        defaultGroupPolicy,
      });
      if (groupPolicy !== "open") return [];
      return [
        `- DingTalk[${account.accountId}] groups: groupPolicy="open" allows any member to trigger (mention-gated). Set channels.dingtalk-connector.groupPolicy="allowlist" + channels.dingtalk-connector.groupAllowFrom to restrict senders.`,
      ];
    },
  },
  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
    applyAccountConfig: ({ cfg, accountId }) => {
      const isDefault = !accountId || accountId === DEFAULT_ACCOUNT_ID;

      if (isDefault) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            "dingtalk-connector": {
              ...cfg.channels?.["dingtalk-connector"],
              enabled: true,
            },
          },
        };
      }

      const dingtalkCfg = cfg.channels?.["dingtalk-connector"] as DingtalkConfig | undefined;
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          "dingtalk-connector": {
            ...dingtalkCfg,
            accounts: {
              ...dingtalkCfg?.accounts,
              [accountId]: {
                ...dingtalkCfg?.accounts?.[accountId],
                enabled: true,
              },
            },
          },
        },
      };
    },
  },
  onboarding: dingtalkOnboardingAdapter,
  messaging: {
    normalizeTarget: (raw) => normalizeDingtalkTarget(raw) ?? undefined,
    targetResolver: {
      looksLikeId: looksLikeDingtalkId,
      hint: "<userId|user:userId|group:conversationId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async ({ cfg, query, limit, accountId }) =>
      listDingtalkDirectoryPeers({
        cfg,
        query: query ?? undefined,
        limit: limit ?? undefined,
        accountId: accountId ?? undefined,
      }),
    listGroups: async ({ cfg, query, limit, accountId }) =>
      listDingtalkDirectoryGroups({
        cfg,
        query: query ?? undefined,
        limit: limit ?? undefined,
        accountId: accountId ?? undefined,
      }),
    listPeersLive: async ({ cfg, query, limit, accountId }) =>
      listDingtalkDirectoryPeersLive({
        cfg,
        query: query ?? undefined,
        limit: limit ?? undefined,
        accountId: accountId ?? undefined,
      }),
    listGroupsLive: async ({ cfg, query, limit, accountId }) =>
      listDingtalkDirectoryGroupsLive({
        cfg,
        query: query ?? undefined,
        limit: limit ?? undefined,
        accountId: accountId ?? undefined,
      }),
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => {
      // Simple markdown chunking - split by newlines
      const chunks: string[] = [];
      const lines = text.split("\n");
      let currentChunk = "";
      
      for (const line of lines) {
        const testChunk = currentChunk + (currentChunk ? "\n" : "") + line;
        if (testChunk.length <= limit) {
          currentChunk = testChunk;
        } else {
          if (currentChunk) chunks.push(currentChunk);
          currentChunk = line;
        }
      }
      if (currentChunk) chunks.push(currentChunk);
      
      return chunks;
    },
    chunkerMode: "markdown",
    textChunkLimit: 2000,
    sendText: async ({ cfg, to, text, accountId, replyToId, threadId }) => {
      const account = resolveDingtalkAccount({ cfg, accountId });
      const result = await sendTextToDingTalk({
        config: account.config,
        target: to,
        text,
        replyToId,
      });
      return {
        channel: "dingtalk-connector",
        messageId: result.processQueryKey ?? result.cardInstanceId ?? "unknown",
        conversationId: to,
      };
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, accountId, mediaLocalRoots, replyToId, threadId }) => {
      const account = resolveDingtalkAccount({ cfg, accountId });
      const logger = createLogger(account.config?.debug ?? false, 'DingTalk:SendMedia');
      
      logger.info('开始处理，参数:', JSON.stringify({
        to,
        text,
        mediaUrl,
        accountId,
        replyToId,
        threadId,
        toType: typeof to,
        mediaUrlType: typeof mediaUrl,
      }));
      
      // 参数校验
      if (!to || typeof to !== 'string') {
        throw new Error(`Invalid 'to' parameter: ${to}`);
      }
      
      if (!mediaUrl || typeof mediaUrl !== 'string') {
        throw new Error(`Invalid 'mediaUrl' parameter: ${mediaUrl}`);
      }

      const result = await sendMediaToDingTalk({
        config: account.config,
        target: to,
        text,
        mediaUrl,
        replyToId,
      });
      
      logger.info('sendMediaToDingTalk 返回结果:', JSON.stringify({
        ok: result.ok,
        error: result.error,
        hasProcessQueryKey: !!result.processQueryKey,
        hasCardInstanceId: !!result.cardInstanceId,
      }));
      
      return {
        channel: "dingtalk-connector",
        messageId: result.processQueryKey ?? result.cardInstanceId ?? "unknown",
        conversationId: to,
      };
    },
  },
  status: {
    defaultRuntime: createDefaultChannelRuntimeState(DEFAULT_ACCOUNT_ID, { port: null }),
    buildChannelSummary: ({ snapshot }) => ({
      ...buildBaseChannelStatusSummary(snapshot),
      port: snapshot.port ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account }) => await probeDingtalk({
      clientId: account.clientId!,
      clientSecret: account.clientSecret!,
      accountId: account.accountId,
    }),
    buildAccountSnapshot: ({ account, runtime, probe }) => ({
      accountId: account.accountId,
      enabled: account.enabled,
      configured: account.configured,
      name: account.name,
      clientId: account.clientId,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      port: runtime?.port ?? null,
      probe,
    }),
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = resolveDingtalkAccount({ cfg: ctx.cfg, accountId: ctx.accountId });

      // 检查账号是否启用和配置
      if (!account.enabled) {
        ctx.log?.info?.(`dingtalk-connector[${ctx.accountId}] is disabled, skipping startup`);
        // 返回一个永不 resolve 的 Promise，保持 pending 状态直到 abort
        return new Promise<void>((resolve) => {
          if (ctx.abortSignal?.aborted) {
            resolve();
            return;
          }
          ctx.abortSignal?.addEventListener('abort', () => resolve(), { once: true });
        });
      }
      
      if (!account.configured) {
        throw new Error(`DingTalk account "${ctx.accountId}" is not properly configured`);
      }
      
      // 去重检查：如果列表中排在当前账号之前的账号已使用相同 clientId，则跳过当前账号
      // 使用静态配置分析（而非运行时状态），避免并发竞态条件
      // 规则：同一 clientId 只有列表中第一个启用且已配置的账号才会建立连接
      if (account.clientId) {
        const clientId = String(account.clientId);
        const allAccountIds = listDingtalkAccountIds(ctx.cfg);
        const currentIndex = allAccountIds.indexOf(ctx.accountId);
        const priorAccountWithSameClientId = allAccountIds.slice(0, currentIndex).find((otherId) => {
          const other = resolveDingtalkAccount({ cfg: ctx.cfg, accountId: otherId });
          return other.enabled && other.configured && other.clientId && String(other.clientId) === clientId;
        });
        if (priorAccountWithSameClientId) {
          ctx.log?.info?.(
            `dingtalk-connector[${ctx.accountId}] skipped: clientId "${clientId.substring(0, 8)}..." is already used by account "${priorAccountWithSameClientId}"`
          );
          return new Promise<void>((resolve) => {
            if (ctx.abortSignal?.aborted) {
              resolve();
              return;
            }
            ctx.abortSignal?.addEventListener('abort', () => resolve(), { once: true });
          });
        }
      }

      ctx.setStatus({ accountId: ctx.accountId, port: null });
      ctx.log?.info(
        `startAccount------starting dingtalk-connector[${ctx.accountId}] (mode: stream)`,
      );
      try {
        return await monitorDingtalkProvider({
          config: ctx.cfg,
          runtime: ctx.runtime,
          abortSignal: ctx.abortSignal,
          accountId: ctx.accountId,
        });
      } catch (err: any) {
        // 打印真实错误到 stderr，绕过框架 log 系统（框架的 runtime.log 可能未初始化）
        console.error(`[dingtalk-connector][${ctx.accountId}] startAccount error:`, err?.message ?? err, err?.stack);
        throw err;
      }
    },
  },
};