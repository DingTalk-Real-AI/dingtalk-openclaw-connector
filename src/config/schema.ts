import { normalizeAccountId } from "../sdk/helpers.ts";
import { z } from "zod";
export { z };
import { buildSecretInputSchema, hasConfiguredSecretInput } from "../secret-input.ts";

const DmPolicySchema = z.enum(["open", "pairing", "allowlist"]);
const GroupPolicySchema = z.enum(["open", "allowlist", "disabled"]);

const ToolPolicySchema = z
  .object({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  })
  .strict()
  .optional();

/**
 * Group session scope for routing DingTalk group messages.
 * - "group" (default): one session per group chat
 * - "group_sender": one session per (group + sender)
 */
const GroupSessionScopeSchema = z
  .enum(["group", "group_sender"])
  .optional();

/**
 * Dingtalk tools configuration.
 * Controls which tool categories are enabled.
 */
const DingtalkToolsConfigSchema = z
  .object({
    docs: z.boolean().optional(), // Document operations (default: true)
    media: z.boolean().optional(), // Media upload operations (default: true)
  })
  .strict()
  .optional();

const SupportCaseRouterToolPolicySchema = z
  .object({
    mode: z.literal("allowlist").optional().default("allowlist"),
    allow: z.array(z.string()).min(1).optional(),
    deny: z.array(z.string()).optional(),
  })
  .strict();

const SupportCaseRouterSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    allowedGroups: z.array(z.union([z.string(), z.number()])).optional(),
    requireMentionForNewRoot: z.boolean().optional().default(true),
    safeAgentId: z.string().trim().min(1).optional(),
    replyMapStorePath: z.string().trim().min(1).optional(),
    runLockStorePath: z.string().trim().min(1).optional(),
    caseMarkerMode: z.enum(["short-ref", "none"]).optional().default("short-ref"),
    staleAfterMs: z.number().int().positive().optional().default(5 * 60 * 1000),
    doneTtlMs: z.number().int().positive().optional().default(24 * 60 * 60 * 1000),
    toolPolicy: SupportCaseRouterToolPolicySchema.optional(),
  })
  .strict();

export const DingtalkGroupSchema = z
  .object({
    requireMention: z.boolean().optional(),
    tools: ToolPolicySchema,
    enabled: z.boolean().optional(),
    allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
    systemPrompt: z.string().optional(),
    groupSessionScope: GroupSessionScopeSchema,
  })
  .strict();

const DingtalkSharedConfigShape = {
  dmPolicy: DmPolicySchema.optional(),
  allowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  groupPolicy: GroupPolicySchema.optional(),
  groupAllowFrom: z.array(z.union([z.string(), z.number()])).optional(),
  requireMention: z.boolean().optional(),
  groups: z.record(z.string(), DingtalkGroupSchema.optional()).optional(),
  historyLimit: z.number().int().min(0).optional(),
  textChunkLimit: z.number().int().positive().optional(),
  mediaMaxMb: z.number().positive().optional(),
  tools: DingtalkToolsConfigSchema,
  typingIndicator: z.boolean().optional(),
  resolveSenderNames: z.boolean().optional(),
  separateSessionByConversation: z.boolean().optional(),
  sharedMemoryAcrossConversations: z.boolean().optional(),
  groupSessionScope: GroupSessionScopeSchema,
  asyncMode: z.boolean().optional(),
  ackText: z.string().optional(),
  endpoint: z.string().optional(), // DWClient gateway endpoint
  debug: z.boolean().optional(), // DWClient debug mode
  enableMediaUpload: z.boolean().optional(),
  systemPrompt: z.string().optional(),
  supportCaseRouter: SupportCaseRouterSchema.optional().default({
    enabled: false,
    requireMentionForNewRoot: true,
    caseMarkerMode: "short-ref",
    staleAfterMs: 5 * 60 * 1000,
    doneTtlMs: 24 * 60 * 60 * 1000,
  }),
};

/**
 * Per-account configuration.
 * All fields are optional - missing fields inherit from top-level config.
 */
export const DingtalkAccountConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().optional(), // Display name for this account
    clientId: z.union([z.string(), z.number()]).optional(),
    clientSecret: buildSecretInputSchema().optional(),
    ...DingtalkSharedConfigShape,
  })
  .strict();

/**
 * Base schema (ZodObject) without superRefine, used for JSON Schema generation (Web UI).
 * superRefine turns the schema into ZodEffects which is not compatible with buildChannelConfigSchema.
 */
export const DingtalkConfigBaseSchema = z
  .object({
    enabled: z.boolean().optional(),
    defaultAccount: z.string().optional(),
    // Top-level credentials (backward compatible for single-account mode)
    clientId: z.union([z.string(), z.number()]).optional(),
    clientSecret: buildSecretInputSchema().optional(),
    ...DingtalkSharedConfigShape,
    dmPolicy: DmPolicySchema.optional().default("open"),
    groupPolicy: GroupPolicySchema.optional().default("open"),
    requireMention: z.boolean().optional().default(true),
    separateSessionByConversation: z.boolean().optional().default(true),
    sharedMemoryAcrossConversations: z.boolean().optional().default(false),
    groupSessionScope: GroupSessionScopeSchema.optional().default("group"),
    // Multi-account configuration
    accounts: z.record(z.string(), DingtalkAccountConfigSchema.optional()).optional(),
  })
  .strict();

export const DingtalkConfigSchema = DingtalkConfigBaseSchema.superRefine((value, ctx) => {
    const defaultAccount = value.defaultAccount?.trim();
    if (defaultAccount && value.accounts && Object.keys(value.accounts).length > 0) {
      const normalizedDefaultAccount = normalizeAccountId(defaultAccount);
      if (!Object.prototype.hasOwnProperty.call(value.accounts, normalizedDefaultAccount)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["defaultAccount"],
          message: `channels.dingtalk-connector.defaultAccount="${defaultAccount}" does not match a configured account key`,
        });
      }
    }

    // Validate dmPolicy and allowFrom consistency
    if (value.dmPolicy === "allowlist") {
      const allowFrom = value.allowFrom ?? [];
      if (allowFrom.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["allowFrom"],
          message:
            'channels.dingtalk-connector.dmPolicy="allowlist" requires channels.dingtalk-connector.allowFrom to contain at least one entry',
        });
      }
    }
    
    // Validate groupPolicy and groupAllowFrom consistency
    if (value.groupPolicy === "allowlist") {
      const groupAllowFrom = value.groupAllowFrom ?? [];
      if (groupAllowFrom.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groupAllowFrom"],
          message:
            'channels.dingtalk-connector.groupPolicy="allowlist" requires channels.dingtalk-connector.groupAllowFrom to contain at least one entry',
        });
      }
    }

    if (value.supportCaseRouter?.enabled === true) {
      const allowedGroups = value.supportCaseRouter.allowedGroups ?? [];
      if (allowedGroups.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["supportCaseRouter", "allowedGroups"],
          message:
            'channels.dingtalk-connector.supportCaseRouter.enabled=true requires supportCaseRouter.allowedGroups to contain at least one entry',
        });
      }

      if (!value.supportCaseRouter.safeAgentId?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["supportCaseRouter", "safeAgentId"],
          message:
            'channels.dingtalk-connector.supportCaseRouter.enabled=true requires supportCaseRouter.safeAgentId',
        });
      }

      const toolPolicy = value.supportCaseRouter.toolPolicy;
      if (!toolPolicy || (toolPolicy.allow?.length ?? 0) === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["supportCaseRouter", "toolPolicy"],
          message:
            'channels.dingtalk-connector.supportCaseRouter.enabled=true requires supportCaseRouter.toolPolicy.allow to define a safe allowlist',
        });
      }
    }
  });
