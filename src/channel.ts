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
} from "./sdk-helpers.ts";
import {
  resolveDingtalkAccount,
  resolveDingtalkCredentials,
  listDingtalkAccountIds,
  resolveDefaultDingtalkAccountId,
} from "./accounts.ts";
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
import { sendTextToDingTalk, sendMediaToDingTalk } from "./messaging.ts";
import type { ResolvedDingtalkAccount, DingtalkConfig } from "./types.ts";

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
      console.log(`[DingTalk] Pairing approved for user: ${id}`);
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
      console.log('[channel.ts][sendMedia] 开始处理，参数:', JSON.stringify({
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
        console.error('[channel.ts][sendMedia] to 参数无效:', to);
        throw new Error(`Invalid 'to' parameter: ${to}`);
      }
      
      if (!mediaUrl || typeof mediaUrl !== 'string') {
        console.error('[channel.ts][sendMedia] mediaUrl 参数无效:', mediaUrl);
        throw new Error(`Invalid 'mediaUrl' parameter: ${mediaUrl}`);
      }
      
      const account = resolveDingtalkAccount({ cfg, accountId });
      console.log('[channel.ts][sendMedia] account 解析完成，准备调用 sendMediaToDingTalk');
      
      const result = await sendMediaToDingTalk({
        config: account.config,
        target: to,
        text,
        mediaUrl,
        replyToId,
      });
      
      console.log('[channel.ts][sendMedia] sendMediaToDingTalk 返回结果:', JSON.stringify({
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
      ctx.log?.info?.(`[channel.ts] startAccount 被调用：accountId=${ctx.accountId}`);
console.log(`[channel.ts] startAccount 被调用：accountId=${ctx.accountId}`);
      try {
        console.log('='.repeat(60));
        console.log('[channel.ts] 开始加载 monitor 模块...');
        const monitorModule = await import("./monitor.ts");
        ctx.log?.info?.(`[channel.ts] monitor module 加载完成`);
        ctx.log?.info?.(`[channel.ts] monitor module keys: ${Object.keys(monitorModule).join(', ')}`);
        ctx.log?.info?.(`[channel.ts] monitorModule 类型: ${typeof monitorModule}`);
        ctx.log?.info?.(`[channel.ts] monitorModule 是否为 null: ${monitorModule === null}`);
        ctx.log?.info?.(`[channel.ts] monitorModule 是否为 undefined: ${monitorModule === undefined}`);
        
        // 使用 Object.getOwnPropertyDescriptor 检查属性
        const descriptor = Object.getOwnPropertyDescriptor(monitorModule, 'monitorSingleAccount');
        ctx.log?.info?.(`[channel.ts] monitorSingleAccount descriptor: ${JSON.stringify(descriptor)}`);
        
        // 尝试安全地访问 monitorSingleAccount
        let monitorSingleAccountType = 'unknown';
        try {
          monitorSingleAccountType = typeof monitorModule.monitorSingleAccount;
        } catch (e) {
          monitorSingleAccountType = `error: ${e.message}`;
        }
        ctx.log?.info?.(`[channel.ts] monitorModule.monitorSingleAccount: ${monitorSingleAccountType}`);
        
        ctx.log?.info?.(`[channel.ts] monitorModule.monitorDingtalkProvider: ${typeof monitorModule.monitorDingtalkProvider}`);
        
        // 使用直接属性访问而不是解构
        const monitorDingtalkProvider = monitorModule.monitorDingtalkProvider;
        ctx.log?.info?.(`[channel.ts] 解构 monitorDingtalkProvider 完成: ${typeof monitorDingtalkProvider}`);
        
        if (!monitorDingtalkProvider) {
          ctx.log?.error?.(`[channel.ts] monitorDingtalkProvider 未找到！可用导出: ${Object.keys(monitorModule).join(', ')}`);
          throw new Error("monitorDingtalkProvider not found in monitor module");
        }
        ctx.log?.info?.(`[channel.ts] monitorDingtalkProvider 找到`);
        
        const account = resolveDingtalkAccount({ cfg: ctx.cfg, accountId: ctx.accountId });
        ctx.log?.info?.(`[channel.ts] account 解析完成: ${account.accountId}, enabled=${account.enabled}, configured=${account.configured}`);
        
        ctx.setStatus({ accountId: ctx.accountId, port: null });
        ctx.log?.info(
          `starting dingtalk-connector[${ctx.accountId}] (mode: stream)`,
        );
        ctx.log?.info?.(`[channel.ts] 准备调用 monitorDingtalkProvider`);
        
        const result = await monitorDingtalkProvider({
          config: ctx.cfg,
          runtime: ctx.runtime,
          abortSignal: ctx.abortSignal,
          accountId: ctx.accountId,
        });
        ctx.log?.info?.(`[channel.ts] monitorDingtalkProvider 调用完成`);
        return result;
      } catch (error) {
        ctx.log?.error?.(`[channel.ts] startAccount 发生错误: ${error.message}`);
        ctx.log?.error?.(`[channel.ts] 错误堆栈: ${error.stack}`);
        throw error;
      }
    },
  },
};