/**
 * AI Card 流式响应模块
 * 支持 AI Card 创建、流式更新、完成
 */

import type { DingtalkConfig } from "../../types/index.ts";
import { DINGTALK_API, getAccessToken } from "../../utils/token.ts";
import { dingtalkHttp } from "../../utils/http-client.ts";

// ============ 常量 ============

const AI_CARD_TEMPLATE_ID = "02fcf2f4-5e02-4a85-b672-46d1f715543e.schema";

/** AI Card 状态 */
const AICardStatus = {
  PROCESSING: "1",
  INPUTING: "2",
  FINISHED: "3",
  EXECUTING: "4",
  FAILED: "5",
} as const;

/** AI Card 实例接口 */
export interface AICardInstance {
  cardInstanceId: string;
  accessToken: string;
  tokenExpireTime: number;
  inputingStarted: boolean;
}

/** AI Card 投放目标类型 */
export type AICardTarget =
  | { type: "user"; userId: string }
  | { type: "group"; openConversationId: string };

// ============ Markdown 格式修正 ============

/**
 * 确保 Markdown 表格前有空行，否则钉钉无法正确渲染表格
 */
function ensureTableBlankLines(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];

  const tableDividerRegex = /^\s*\|?\s*:?-+:?\s*(\|?\s*:?-+:?\s*)+\|?\s*$/;
  const tableRowRegex = /^\s*\|?.*\|.*\|?\s*$/;

  const isDivider = (line: string) =>
    line &&
    typeof line === "string" &&
    line.includes("|") &&
    tableDividerRegex.test(line);

  for (let i = 0; i < lines.length; i++) {
    const currentLine = lines[i];
    const nextLine = lines[i + 1] ?? "";

    if (
      tableRowRegex.test(currentLine) &&
      isDivider(nextLine) &&
      i > 0 &&
      lines[i - 1].trim() !== "" &&
      !tableRowRegex.test(lines[i - 1])
    ) {
      result.push("");
    }

    result.push(currentLine);
  }
  return result.join("\n");
}

// ============ AI Card 相关 ============

/**
 * 构建卡片投放请求体
 */
export function buildDeliverBody(
  cardInstanceId: string,
  target: AICardTarget,
  robotCode: string,
): any {
  const base = { outTrackId: cardInstanceId, userIdType: 1 };

  if (target.type === "group") {
    return {
      ...base,
      openSpaceId: `dtv1.card//IM_GROUP.${target.openConversationId}`,
      imGroupOpenDeliverModel: {
        robotCode,
      },
    };
  }

  return {
    ...base,
    openSpaceId: `dtv1.card//IM_ROBOT.${target.userId}`,
    imRobotOpenDeliverModel: {
      spaceType: 'IM_ROBOT',
      robotCode,
      extension: {
        dynamicSummary: 'true',
      },
    },
  };
}

/**
 * 通用 AI Card 创建函数
 */
export async function createAICardForTarget(
  config: DingtalkConfig,
  target: AICardTarget,
  log?: any,
): Promise<AICardInstance | null> {
  const targetDesc =
    target.type === "group"
      ? `群聊 ${target.openConversationId}`
      : `用户 ${target.userId}`;

  try {
    const token = await getAccessToken(config);
    const cardInstanceId = `card_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    log?.info?.(
      `[DingTalk][AICard] 开始创建卡片：${targetDesc}, outTrackId=${cardInstanceId}`,
    );

    // 1. 创建卡片实例
    const createBody = {
      cardTemplateId: AI_CARD_TEMPLATE_ID,
      outTrackId: cardInstanceId,
      cardData: {
          cardParamMap: {
              config: JSON.stringify({ autoLayout: true }),
          }
      },
      callbackType: "STREAM",
      imGroupOpenSpaceModel: { supportForward: true },
      imRobotOpenSpaceModel: { supportForward: true },
    };

    const createResp = await dingtalkHttp.post(
      `${DINGTALK_API}/v1.0/card/instances`,
      createBody,
      {
        headers: {
          "x-acs-dingtalk-access-token": token,
          "Content-Type": "application/json",
        },
      },
    );

    // 2. 投放卡片
    const deliverBody = buildDeliverBody(
      cardInstanceId,
      target,
      String(config.clientId ?? ""),
    );

    const deliverResp = await dingtalkHttp.post(
      `${DINGTALK_API}/v1.0/card/instances/deliver`,
      deliverBody,
      {
        headers: {
          "x-acs-dingtalk-access-token": token,
          "Content-Type": "application/json",
        },
      },
    );

    // 记录 token 过期时间（钉钉 token 有效期 2 小时）
    const tokenExpireTime = Date.now() + 2 * 60 * 60 * 1000;
    
    return { cardInstanceId, accessToken: token, tokenExpireTime, inputingStarted: false };
  } catch (err: any) {
    log?.error?.(
      `[DingTalk][AICard] 创建卡片失败 (${targetDesc}): ${err.message}`,
    );
    if (err.response) {
      log?.error?.(
        `[DingTalk][AICard] 错误响应：status=${err.response.status}`,
      );
    }
    return null;
  }
}

/**
 * 确保 Token 有效（自动刷新过期的 Token）
 */
async function ensureValidToken(
  card: AICardInstance,
  config: DingtalkConfig,
): Promise<string> {
  // 如果 token 即将过期（提前 5 分钟刷新）
  if (Date.now() > card.tokenExpireTime - 5 * 60 * 1000) {
    const newToken = await getAccessToken(config);
    card.accessToken = newToken;
    card.tokenExpireTime = Date.now() + 2 * 60 * 60 * 1000;
  }
  return card.accessToken;
}

/**
 * 流式更新 AI Card 内容
 */
export async function streamAICard(
  card: AICardInstance,
  content: string,
  finished: boolean = false,
  config?: DingtalkConfig,
  log?: any,
): Promise<void> {
  // 确保 token 有效
  if (config) {
    await ensureValidToken(card, config);
  }
  if (!card.inputingStarted) {
    const statusBody = {
      outTrackId: card.cardInstanceId,
      cardData: {
        cardParamMap: {
          flowStatus: AICardStatus.INPUTING,
          msgContent: content,
          staticMsgContent: "",
          sys_full_json_obj: JSON.stringify({
            order: ["msgContent"],
          }),
          config: JSON.stringify({ autoLayout: true }),
        },
      },
    };
    try {
      const statusResp = await dingtalkHttp.put(
        `${DINGTALK_API}/v1.0/card/instances`,
        statusBody,
        {
          headers: {
            "x-acs-dingtalk-access-token": card.accessToken,
            "Content-Type": "application/json",
          },
        },
      );
      log?.info?.(
        `[DingTalk][AICard] INPUTING 响应：status=${statusResp.status}`,
      );
    } catch (err: any) {
      log?.error?.(`[DingTalk][AICard] INPUTING 切换失败：${err.message}`);
      throw err;
    }
    card.inputingStarted = true;
  }

  const fixedContent = ensureTableBlankLines(content);
  const body = {
    outTrackId: card.cardInstanceId,
    guid: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    key: "msgContent",
    content: fixedContent,
    isFull: true,
    isFinalize: finished,
    isError: false,
  };

  log?.info?.(
    `[DingTalk][AICard] PUT /v1.0/card/streaming contentLen=${content.length} isFinalize=${finished}`,
  );
  try {
    const streamResp = await dingtalkHttp.put(
      `${DINGTALK_API}/v1.0/card/streaming`,
      body,
      {
        headers: {
          "x-acs-dingtalk-access-token": card.accessToken,
          "Content-Type": "application/json",
        },
      },
    );
    log?.info?.(
      `[DingTalk][AICard] streaming 响应：status=${streamResp.status}`,
    );
  } catch (err: any) {
    throw err;
  }
}

/**
 * 完成 AI Card
 */
export async function finishAICard(
  card: AICardInstance,
  content: string,
  config?: DingtalkConfig,
  log?: any,
): Promise<void> {
  // 确保 token 有效
  if (config) {
    await ensureValidToken(card, config);
  }
  const fixedContent = ensureTableBlankLines(content);
  log?.info?.(
    `[DingTalk][AICard] 开始 finish，最终内容长度=${fixedContent.length}`,
  );

  await streamAICard(card, fixedContent, true, log);

  const body = {
    outTrackId: card.cardInstanceId,
    cardData: {
      cardParamMap: {
        flowStatus: AICardStatus.FINISHED,
        msgContent: fixedContent,
        staticMsgContent: "",
        sys_full_json_obj: JSON.stringify({
          order: ["msgContent"],
        }),
        config: JSON.stringify({ autoLayout: true }),
      },
    },
    cardUpdateOptions: { updateCardDataByKey: true },
  };

  try {
    const finishResp = await dingtalkHttp.put(
      `${DINGTALK_API}/v1.0/card/instances`,
      body,
      {
        headers: {
          "x-acs-dingtalk-access-token": card.accessToken,
          "Content-Type": "application/json",
        },
      },
    );
    log?.info?.(
      `[DingTalk][AICard] FINISHED 响应：status=${finishResp.status}`,
    );
  } catch (err: any) {
    log?.error?.(`[DingTalk][AICard] FINISHED 更新失败：${err.message}`);
  }
}
