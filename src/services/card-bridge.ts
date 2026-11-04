import type { OpenClawConfig as ClawdbotConfig } from "openclaw/plugin-sdk/config-contracts";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/core";
import { resolveDingtalkAccount } from "../config/accounts.ts";
import type { DingtalkConfig } from "../types/index.ts";
import {
  createAICardForTarget,
  finishAICard,
  streamAICard,
  type AICardInstance,
  type AICardTarget,
} from "./messaging/card.ts";
import { DINGTALK_API, getAccessToken } from "../utils/token.ts";
import { dingtalkHttp } from "../utils/http-client.ts";
import { captureQuestionContext, resolveQuestionContext } from "../questions/context.ts";

export const DINGTALK_CARD_BRIDGE_SYMBOL = Symbol.for("@dingtalk-connector/card-bridge");
export const DINGTALK_A2UI_BRIDGE_SYMBOL = Symbol.for("@dingtalk-connector/a2ui-bridge");

const CARD_RECORD_TTL_MS = 24 * 60 * 60 * 1000;
const CARD_RECORD_MAX_SIZE = 10_000;
const CARD_RECORD_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const A2UI_CARD_TTL_MS = 30 * 60 * 1000;
const A2UI_CARD_MAX_SIZE = 1_000;
const DEFAULT_FAILED_CARD_MARKDOWN = "Task failed";
const TARGET_ID_MAX_LENGTH = 256;
const TARGET_ID_DANGEROUS_CHARS_PATTERN = /[<>"\x00-\x1f\x7f]/;

type LoggerLike = {
  debug?: (message: string) => void;
  error?: (message: string) => void;
  info?: (message: string) => void;
  warn?: (message: string) => void;
};

type CardRecord = {
  card: AICardInstance;
  config: DingtalkConfig;
  lastUsedAt: number;
  queue: Promise<unknown>;
};

export type CardUpdateStatus = "running" | "completed" | "failed";

export type CardCreateParams = {
  cfg?: ClawdbotConfig;
  accountId?: string;
  target: string;
  markdown?: string;
  log?: LoggerLike;
};

export type CardUpdateParams = {
  cardInstanceId: string;
  markdown?: string;
  status?: CardUpdateStatus;
  log?: LoggerLike;
};

export type DingtalkCardBridge = {
  create(params: CardCreateParams): Promise<{
    cardInstanceId: string;
    accountId: string;
    target: string;
  }>;
  update(params: CardUpdateParams): Promise<{
    cardInstanceId: string;
    status: CardUpdateStatus;
  }>;
};

export type DingtalkA2UIActionEvent = {
  accountId: string;
  messageId: string;
  senderId?: string;
  outTrackId?: string;
  cardInstanceId?: string;
  trustedContext?: {
    accountId: string;
    senderId: string;
    sessionKey: string;
    conversationId: string;
    robotCode: string;
    isDirect: true;
  };
  data: unknown;
};

export type DingtalkA2UIBridge = {
  getCurrentContext(context: unknown): {
    accountId: string;
    senderId: string;
    sessionKey: string;
    conversationId: string;
    robotCode: string;
    isDirect: true;
    isCurrent: () => boolean;
  } | undefined;
  createCurrentCard(params: {
    context: unknown;
    outTrackId: string;
    summary: string;
    messages: unknown[];
  }): Promise<{ status: "accepted" | "failed" | "unknown"; cardInstanceId?: string }>;
  updateCard(params: {
    cardInstanceId: string;
    outTrackId: string;
    outUpdateId: string;
    status: "PROCESSING" | "FINISH" | "FAIL";
    messages: unknown[];
  }): Promise<{ status: "accepted" | "failed" | "unknown" }>;
  onCardAction(handler: (event: DingtalkA2UIActionEvent) => void | Promise<void>): () => void;
};

const cards = new Map<string, CardRecord>();
const a2uiActionHandlers = new Set<(event: DingtalkA2UIActionEvent) => void | Promise<void>>();
const a2uiContexts = new WeakMap<object, any>();
const a2uiCards = new Map<string, { cardInstanceId: string; config: DingtalkConfig; context: any; accountId: string; senderId: string; sessionKey: string; expiresAt: number; queue: Promise<unknown> }>();
let cleanupTimerInstalled = false;

class PublicError extends Error {}

function nowMs(): number {
  return Date.now();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
}

function publicErrorMessage(err: unknown, fallback: string): string {
  return err instanceof PublicError ? err.message : fallback;
}

function isValidTargetId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= TARGET_ID_MAX_LENGTH &&
    !TARGET_ID_DANGEROUS_CHARS_PATTERN.test(value)
  );
}

function parseCardTarget(target: unknown): AICardTarget | null {
  if (typeof target !== "string") return null;
  const raw = target.trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (lowered.startsWith("user:")) {
    const userId = raw.slice("user:".length).trim();
    return isValidTargetId(userId) ? { type: "user", userId } : null;
  }
  if (lowered.startsWith("group:")) {
    const openConversationId = raw.slice("group:".length).trim();
    return isValidTargetId(openConversationId) ? { type: "group", openConversationId } : null;
  }
  if (raw.startsWith("cid") && isValidTargetId(raw)) {
    return { type: "group", openConversationId: raw };
  }
  return null;
}

function targetToString(target: AICardTarget): string {
  return target.type === "user" ? `user:${target.userId}` : `group:${target.openConversationId}`;
}

function normalizeStatus(value: unknown): CardUpdateStatus {
  if (value === "completed" || value === "failed") return value;
  return "running";
}

function cleanupExpiredCards(log?: LoggerLike, timestamp = nowMs()): number {
  let removed = 0;
  for (const [cardInstanceId, record] of cards) {
    if (timestamp - record.lastUsedAt > CARD_RECORD_TTL_MS) {
      cards.delete(cardInstanceId);
      removed += 1;
    }
  }
  if (removed > 0) {
    log?.info?.(`[DingTalk][CardBridge] cleaned expired cards count=${removed}`);
  }
  return removed;
}

function evictOverflowCards(log?: LoggerLike): number {
  const overflow = cards.size - CARD_RECORD_MAX_SIZE;
  if (overflow <= 0) return 0;

  const oldest = [...cards.entries()]
    .sort(([, a], [, b]) => a.lastUsedAt - b.lastUsedAt)
    .slice(0, overflow);

  for (const [cardInstanceId] of oldest) {
    cards.delete(cardInstanceId);
  }
  log?.warn?.(`[DingTalk][CardBridge] evicted old cards count=${oldest.length}`);
  return oldest.length;
}

function ensureCleanupTimerInstalled(): void {
  if (cleanupTimerInstalled) return;
  const cleanupTimer = setInterval(() => {
    cleanupExpiredCards();
  }, CARD_RECORD_CLEANUP_INTERVAL_MS);
  cleanupTimer.unref?.();
  cleanupTimerInstalled = true;
}

function rememberCard(card: AICardInstance, config: DingtalkConfig, log?: LoggerLike): CardRecord {
  cleanupExpiredCards(log);
  const timestamp = nowMs();
  const record: CardRecord = {
    card,
    config,
    lastUsedAt: timestamp,
    queue: Promise.resolve(),
  };
  cards.set(card.cardInstanceId, record);
  evictOverflowCards(log);
  return record;
}

function getCardRecord(cardInstanceId: string): CardRecord {
  const record = cards.get(cardInstanceId);
  if (!record) throw new PublicError(`Unknown cardInstanceId: ${cardInstanceId}`);
  record.lastUsedAt = nowMs();
  return record;
}

function resolveAccountConfig(
  cfg: ClawdbotConfig,
  accountId: unknown,
  log: LoggerLike | undefined,
  method: string,
) {
  const account = resolveDingtalkAccount({
    cfg,
    accountId: typeof accountId === "string" ? accountId : undefined,
  });
  if (!account.enabled || !account.configured) {
    throw new PublicError("DingTalk not configured");
  }
  log?.debug?.(`[DingTalk][CardBridge][${method}] using accountId=${account.accountId}`);
  return account;
}

async function createCard(params: {
  cfg: ClawdbotConfig;
  accountId?: string;
  target: AICardTarget;
  markdown?: string;
  log?: LoggerLike;
}) {
  const account = resolveAccountConfig(params.cfg, params.accountId, params.log, "card.create");
  const card = await createAICardForTarget(account.config, params.target, params.log);
  if (!card) throw new PublicError("Failed to create DingTalk AI Card");
  rememberCard(card, account.config, params.log);
  try {
    if (params.markdown) {
      await streamAICard(card, params.markdown, false, account.config, params.log);
    }
  } catch (err) {
    cards.delete(card.cardInstanceId);
    throw err;
  }
  params.log?.info?.(`[DingTalk][CardBridge][card.create] created cardInstanceId=${card.cardInstanceId}`);
  return {
    cardInstanceId: card.cardInstanceId,
    accountId: account.accountId,
    target: targetToString(params.target),
  };
}

async function updateCard(params: {
  cardInstanceId: string;
  markdown: string;
  status?: CardUpdateStatus;
  log?: LoggerLike;
}) {
  const record = getCardRecord(params.cardInstanceId);
  const status = normalizeStatus(params.status);
  const operation = record.queue.then(
    () => updateCardRecord(record, params.cardInstanceId, params.markdown, status, params.log),
    () => updateCardRecord(record, params.cardInstanceId, params.markdown, status, params.log),
  );
  record.queue = operation.catch(() => undefined);
  await operation;
  return {
    cardInstanceId: params.cardInstanceId,
    status,
  };
}

async function updateCardRecord(
  record: CardRecord,
  cardInstanceId: string,
  markdown: string,
  status: CardUpdateStatus,
  log?: LoggerLike,
) {
  if (cards.get(cardInstanceId) !== record) {
    throw new PublicError(`Unknown cardInstanceId: ${cardInstanceId}`);
  }
  record.lastUsedAt = nowMs();
  log?.info?.(`[DingTalk][CardBridge][card.update] cardInstanceId=${cardInstanceId} status=${status}`);
  if (status === "completed") {
    try {
      await finishAICard(record.card, markdown || " ", record.config, log);
    } finally {
      cards.delete(cardInstanceId);
    }
  } else if (status === "failed") {
    const content = markdown.trim() ? markdown : DEFAULT_FAILED_CARD_MARKDOWN;
    try {
      await finishAICard(record.card, content, record.config, log);
    } finally {
      cards.delete(cardInstanceId);
    }
  } else {
    await streamAICard(record.card, markdown || " ", false, record.config, log);
  }
}

/**
 * Return the in-process DingTalk card bridge installed by this connector.
 *
 * Contract:
 * - Symbol key: `Symbol.for("@dingtalk-connector/card-bridge")`
 * - `create({ target, accountId?, markdown?, cfg?, log? })`
 * - `update({ cardInstanceId, markdown?, status?, log? })`
 *
 * This bridge is intentionally process-local. Cross-process callers should use
 * the gateway methods registered below instead.
 */
export function getDingtalkCardBridge(): DingtalkCardBridge | undefined {
  return (globalThis as any)[DINGTALK_CARD_BRIDGE_SYMBOL];
}

export function installDingtalkCardBridge(api: OpenClawPluginApi): void {
  ensureCleanupTimerInstalled();
  const g = globalThis as any;
  g[DINGTALK_CARD_BRIDGE_SYMBOL] = {
    async create(params: CardCreateParams) {
      const cfg = params?.cfg ?? api.runtime.config.current() as ClawdbotConfig;
      const target = parseCardTarget(params?.target);
      if (!target) throw new PublicError("target is required (user:<userId>, group:<openConversationId>, or cid...)");
      return createCard({
        cfg,
        accountId: params?.accountId,
        target,
        markdown: optionalString(params?.markdown),
        log: params?.log ?? api.logger,
      });
    },
    async update(params: CardUpdateParams) {
      if (!params?.cardInstanceId) throw new PublicError("cardInstanceId is required");
      return updateCard({
        cardInstanceId: String(params.cardInstanceId),
        markdown: String(params?.markdown ?? ""),
        status: normalizeStatus(params?.status),
        log: params?.log ?? api.logger,
      });
    },
  } satisfies DingtalkCardBridge;
}

function serializeA2uiMessages(messages: unknown[]): string[] {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 128) {
    throw new PublicError("A2UI messages must contain between 1 and 128 entries");
  }
  return messages.map((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      throw new PublicError("A2UI messages must be objects");
    }
    return JSON.stringify(message);
  });
}

function pruneA2uiCards(timestamp = nowMs()): void {
  for (const [outTrackId, record] of a2uiCards) {
    if (record.expiresAt <= timestamp) a2uiCards.delete(outTrackId);
  }
  while (a2uiCards.size >= A2UI_CARD_MAX_SIZE) {
    const oldest = a2uiCards.keys().next().value as string | undefined;
    if (!oldest) break;
    a2uiCards.delete(oldest);
  }
}

export function dispatchDingtalkA2uiAction(event: DingtalkA2UIActionEvent): void {
  pruneA2uiCards();
  const record = event.outTrackId ? a2uiCards.get(event.outTrackId) : undefined;
  if (!record || event.accountId !== record.accountId || event.senderId !== record.senderId) return;
  const enriched = {
    ...event,
    cardInstanceId: record?.cardInstanceId,
    trustedContext: record.context,
  };
  for (const handler of a2uiActionHandlers) {
    void Promise.resolve(handler(enriched)).catch(() => undefined);
  }
}

export function installDingtalkA2UIBridge(api: OpenClawPluginApi): void {
  const g = globalThis as any;
  const bridge: DingtalkA2UIBridge = {
    getCurrentContext(toolContext: unknown) {
      const context = resolveQuestionContext(toolContext, captureQuestionContext()) as any;
      if (context?.isDirect !== true || typeof context?.isCurrent !== "function"
        || context.isCurrent() !== true || typeof context.accountId !== "string"
        || typeof context.senderId !== "string" || typeof context.sessionKey !== "string"
        || typeof context.conversationId !== "string") return undefined;
      const trustedContext = {
        accountId: context.accountId,
        senderId: context.senderId,
        sessionKey: context.sessionKey,
        conversationId: context.conversationId,
        robotCode: String(context.config?.clientId ?? ""),
        isDirect: true as const,
        isCurrent: () => context.isCurrent() === true,
      };
      a2uiContexts.set(trustedContext, context);
      return trustedContext;
    },
    async createCurrentCard(params) {
      const context = params?.context && typeof params.context === "object"
        ? a2uiContexts.get(params.context as object) : undefined;
      if (!context || context.isDirect !== true || context.isCurrent?.() !== true
        || typeof context.senderId !== "string" || typeof context.accountId !== "string"
        || typeof context.conversationId !== "string" || typeof context.config !== "object"
        || typeof params?.outTrackId !== "string" || typeof params?.summary !== "string") {
        return { status: "failed" };
      }
      let a2uiMessages: string[];
      try { a2uiMessages = serializeA2uiMessages(params.messages); } catch { return { status: "failed" }; }
      try {
        const token = await getAccessToken(context.config);
        if (context.isCurrent?.() !== true) return { status: "failed" };
        const response = await dingtalkHttp.post(`${DINGTALK_API}/v1.0/card/ai/instances/createAndDeliver`, {
          outTrackId: params.outTrackId,
          openSpaceId: `dtv1.card//im_robot.${context.senderId}`,
          protocolVersion: "1.0",
          flowStatus: "PROCESSING",
          a2uiMessages,
          summary: params.summary,
          callbackType: "STREAM",
          imRobotOpenSpaceModel: { supportForward: false },
          imRobotOpenDeliverModel: { robotCode: String(context.config.clientId ?? "") },
        }, { headers: { "x-acs-dingtalk-access-token": token, "Content-Type": "application/json" }, maxRedirects: 0 });
        const result = asRecord(response.data?.result);
        const deliveries = Array.isArray(result.deliverResults) ? result.deliverResults : [];
        if (response.status !== 200 || response.data?.success !== true
          || deliveries.some((item: any) => item?.success !== true)) {
          return { status: response.status >= 200 && response.status < 300 ? "unknown" : "failed" };
        }
        pruneA2uiCards();
        const cardInstanceId = String(result.cardInstanceId ?? params.outTrackId);
        const callbackContext = Object.freeze({
          accountId: context.accountId,
          senderId: context.senderId,
          sessionKey: context.sessionKey,
          conversationId: context.conversationId,
          robotCode: String(context.config.clientId ?? ""),
          isDirect: true as const,
        });
        a2uiCards.set(params.outTrackId, {
          cardInstanceId, config: context.config, context: callbackContext, accountId: context.accountId,
          senderId: context.senderId, sessionKey: context.sessionKey, expiresAt: Date.now() + A2UI_CARD_TTL_MS,
          queue: Promise.resolve(),
        });
        return { status: "accepted", cardInstanceId };
      } catch { return { status: "unknown" }; }
    },
    async updateCard(params) {
      if (typeof params?.cardInstanceId !== "string" || typeof params?.outTrackId !== "string"
        || typeof params?.outUpdateId !== "string") return { status: "failed" };
      let a2uiMessages: string[];
      try { a2uiMessages = serializeA2uiMessages(params.messages); } catch { return { status: "failed" }; }
      const flowStatus = params.status === "FINISH" || params.status === "FAIL" ? params.status : "PROCESSING";
      const record = a2uiCards.get(params.outTrackId);
      if (!record || record.expiresAt <= nowMs() || record.cardInstanceId !== params.cardInstanceId) return { status: "failed" };
      const run = record.queue.then(async () => {
        try {
          const response = await dingtalkHttp.put(`${DINGTALK_API}/v1.0/card/ai/instances/update`, {
            outTrackId: params.outTrackId,
            outUpdateId: params.outUpdateId,
            flowStatus,
            a2uiMessages,
          }, { headers: { "x-acs-dingtalk-access-token": await getAccessToken(record.config), "Content-Type": "application/json" }, maxRedirects: 0 });
          if (response.status !== 200 || response.data?.success !== true) {
            return { status: response.status >= 200 && response.status < 300 ? "unknown" : "failed" } as const;
          }
          if (flowStatus !== "PROCESSING") a2uiCards.delete(params.outTrackId);
          return { status: "accepted" } as const;
        } catch { return { status: "unknown" } as const; }
      });
      record.queue = run.then(() => undefined, () => undefined);
      return run;
    },
    onCardAction(handler) {
      a2uiActionHandlers.add(handler);
      return () => a2uiActionHandlers.delete(handler);
    },
  };
  g[DINGTALK_A2UI_BRIDGE_SYMBOL] = bridge;
}

export function registerDingtalkCardGatewayMethods(api: OpenClawPluginApi): void {
  const log = api.logger;

  api.registerGatewayMethod("dingtalk-connector.card.create", async ({ params, respond }) => {
    try {
      const cfg = api.runtime.config.current() as ClawdbotConfig;
      const rawParams = asRecord(params);
      const target = parseCardTarget(rawParams.target);
      if (!target) {
        return respond(false, {
          error: "target is required (user:<userId>, group:<openConversationId>, or cid...)",
        });
      }
      const result = await createCard({
        cfg,
        accountId: optionalString(rawParams.accountId),
        target,
        markdown: optionalString(rawParams.markdown),
        log,
      });
      respond(true, result);
    } catch (err: unknown) {
      log?.error?.(`[Gateway][card.create] 错误: ${errorMessage(err)}`);
      respond(false, { error: publicErrorMessage(err, "card.create failed") });
    }
  });

  api.registerGatewayMethod("dingtalk-connector.card.update", async ({ params, respond }) => {
    try {
      const rawParams = asRecord(params);
      if (!rawParams.cardInstanceId) {
        return respond(false, { error: "cardInstanceId is required" });
      }
      const result = await updateCard({
        cardInstanceId: String(rawParams.cardInstanceId),
        markdown: String(rawParams.markdown ?? ""),
        status: normalizeStatus(rawParams.status),
        log,
      });
      respond(true, result);
    } catch (err: unknown) {
      log?.error?.(`[Gateway][card.update] 错误: ${errorMessage(err)}`);
      respond(false, { error: publicErrorMessage(err, "card.update failed") });
    }
  });
}
