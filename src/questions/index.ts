import { randomUUID } from 'node:crypto';
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk/core';
import type { DingtalkConfig } from '../types/index.ts';
import { DINGTALK_API, getAccessToken } from '../utils/token.ts';
import { dingtalkHttp } from '../utils/http-client.ts';
import {
  captureQuestionContext, resolveQuestionContext,
  type DingtalkQuestionContext, type DingtalkQuestionScope,
} from './context.ts';
import { asRecord, buildQuestionForm, QUESTION_TOOL_SCHEMA, validateAnswers, type QuestionForm } from './form.ts';

export { withDingtalkQuestionContext } from './context.ts';
export type { DingtalkQuestionContext, DingtalkQuestionScope } from './context.ts';

// 公共模板及 Form 回调契约来自 soimy/openclaw-channel-dingtalk，详见 docs/assets/README.md。
export const DEFAULT_QUESTION_TEMPLATE_ID = 'c2a6355b-9724-4f7e-9653-d33fcb3311bb.schema';
const TRACK_PREFIX = 'dingtalk_question_';
const DEFAULT_TTL_MS = 5 * 60_000;
const TERMINAL_TTL_MS = 30 * 60_000;
type State = 'creating' | 'pending' | 'submitted' | 'cancelled' | 'expired' | 'superseded' | 'failed';
type PendingQuestion = {
  context: DingtalkQuestionContext;
  questionId: string;
  outTrackId: string;
  form: QuestionForm;
  expiresAt: number;
  state: State;
  timer?: ReturnType<typeof setTimeout>;
  ready: Promise<void>;
  activate: () => void;
};
const questions = new Map<string, PendingQuestion>();
const terminal = new Map<string, { accountId: string; state: State; expiresAt: number }>();
const cardUpdates = new Map<string, Promise<void>>();

function sameScope(a: DingtalkQuestionScope, b: DingtalkQuestionScope): boolean {
  return a.accountId === b.accountId && a.conversationId === b.conversationId
    && a.senderId === b.senderId && (!b.sessionKey || a.sessionKey === b.sessionKey);
}

function toolResult(payload: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }], details: payload };
}

function cardParams(values: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]));
}

async function updateCard(
  outTrackId: string,
  config: DingtalkConfig,
  state: State,
  description: string,
  log?: DingtalkQuestionContext['log'],
): Promise<void> {
  const previous = cardUpdates.get(outTrackId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => updateCardNow(outTrackId, config, state, description, log));
  cardUpdates.set(outTrackId, next);
  try { await next; } finally {
    if (cardUpdates.get(outTrackId) === next) cardUpdates.delete(outTrackId);
  }
}

async function updateCardNow(
  outTrackId: string,
  config: DingtalkConfig,
  state: State,
  description: string,
  log?: DingtalkQuestionContext['log'],
): Promise<void> {
  try {
    const token = await getAccessToken(config);
    // 校验错误提示不能覆盖并发提交/超时后的终态，重新打开卡片。
    const recordedState = terminal.get(outTrackId)?.state;
    if (state === 'pending' && recordedState) {
      state = recordedState;
      description = descriptions[state];
    }
    await dingtalkHttp.put(`${DINGTALK_API}/v1.0/card/instances`, {
      outTrackId,
      cardData: { cardParamMap: cardParams({
        card_status: state,
        question_desc: description,
        form_btn_text: ({ submitted: '已提交', cancelled: '已取消', expired: '已过期', superseded: '已失效', failed: '已失效' } as any)[state] ?? '提交',
      }) },
      cardUpdateOptions: { updateCardDataByKey: true },
    }, { headers: { 'x-acs-dingtalk-access-token': token } });
  } catch {
    // 不输出完整错误响应，避免日志泄漏表单答案和应用凭据。
    log?.warn?.('[DingTalk][Question] 卡片状态更新失败；本地终态仍然有效');
  }
}

const descriptions: Record<string, string> = {
  submitted: '已收到回答，正在继续会话。', cancelled: '已取消，本次回答不会继续会话。',
  expired: '此问题已过期，请在会话中重新提问。', superseded: '收到新消息或新问题，此卡已失效。',
  failed: '当前任务无法等待回答，此卡已失效。',
};

/** 先同步领取终态，再执行网络 I/O；重复提交永远不能再次派发。 */
function claim(question: PendingQuestion, state: State): boolean {
  if (question.state !== 'pending' && question.state !== 'creating') return false;
  question.state = state;
  if (question.timer) clearTimeout(question.timer);
  questions.delete(question.outTrackId);
  question.activate();
  for (const [id, item] of terminal) if (item.expiresAt <= Date.now()) terminal.delete(id);
  if (terminal.size >= 2000) terminal.delete(terminal.keys().next().value!);
  terminal.set(question.outTrackId, { accountId: question.context.accountId, state, expiresAt: Date.now() + TERMINAL_TTL_MS });
  return true;
}

async function terminate(question: PendingQuestion, state: State): Promise<void> {
  if (!claim(question, state)) return;
  await updateCard(question.outTrackId, question.context.config, state, descriptions[state], question.context.log);
}

/** 新消息只使原用户/原账号/原会话的问题失效；发卡中的预留记录也会失效。 */
export async function invalidatePendingQuestionsForScope(scope: DingtalkQuestionScope): Promise<void> {
  await Promise.all([...questions.values()].filter((question) => sameScope(question.context, scope))
    .map((question) => terminate(question, 'superseded')));
}

async function sendQuestion(context: DingtalkQuestionContext, raw: unknown) {
  if (context.isCurrent?.() === false) return toolResult({ status: 'superseded', error: '新消息已使本轮问题失效' });
  let form: QuestionForm;
  try {
    form = buildQuestionForm(raw);
  } catch (error) {
    return toolResult({ status: 'failed', error: (error as Error).message });
  }
  if (!context.senderId || !context.accountId || !context.conversationId || !context.sessionKey) {
    return toolResult({ status: 'failed', error: '缺少可信会话身份，不能发送表单' });
  }
  const config = context.config as DingtalkConfig & { questionCardTemplateId?: string; questionTimeoutMs?: number };
  const ttl = Math.max(10_000, Math.min(30 * 60_000, Number(config.questionTimeoutMs) || DEFAULT_TTL_MS));
  let activate!: () => void;
  const question: PendingQuestion = {
    context, questionId: `q_${randomUUID()}`, outTrackId: `${TRACK_PREFIX}${randomUUID()}`,
    form, state: 'creating', expiresAt: Date.now() + ttl,
    ready: new Promise<void>((resolve) => { activate = resolve; }), activate: () => activate(),
  };
  // 预留发生在任何 await 之前，使发送期间抵达的新消息也能正确取消本卡。
  const predecessors = [...questions.values()].filter((item) => sameScope(item.context, context));
  questions.set(question.outTrackId, question);
  question.timer = setTimeout(() => { void terminate(question, 'expired'); }, ttl);
  question.timer.unref?.();
  await Promise.all(predecessors.map((item) => terminate(item, 'superseded')));
  if (question.state !== 'creating') return toolResult({ status: question.state, questionId: question.questionId });
  try {
    const token = await getAccessToken(config);
    // 获取 token 期间也可能收到新消息，不能继续投递已经失效的卡。
    if (context.isCurrent?.() === false) claim(question, 'superseded');
    if (question.state !== 'creating') return toolResult({ status: question.state, questionId: question.questionId });
    const isGroup = !context.isDirect;
    const response = await dingtalkHttp.post(`${DINGTALK_API}/v1.0/card/instances/createAndDeliver`, {
      cardTemplateId: config.questionCardTemplateId || DEFAULT_QUESTION_TEMPLATE_ID,
      outTrackId: question.outTrackId,
      cardData: { cardParamMap: cardParams({
        question_id: question.questionId, question_title: form.title,
        question_desc: form.description, card_status: 'pending', form_btn_text: '提交',
        selected_text: '', selected_values: [], form: { fields: form.fields },
      }) },
      callbackType: 'STREAM', userIdType: 1,
      imGroupOpenSpaceModel: { supportForward: false },
      imRobotOpenSpaceModel: { supportForward: false },
      openSpaceId: isGroup ? `dtv1.card//IM_GROUP.${context.conversationId}` : `dtv1.card//IM_ROBOT.${context.senderId}`,
      ...(isGroup
        ? { imGroupOpenDeliverModel: { robotCode: config.clientId, extension: { dynamicSummary: 'true' } } }
        : { imRobotOpenDeliverModel: { spaceType: 'IM_ROBOT', robotCode: config.clientId, extension: { dynamicSummary: 'true' } } }),
    }, { headers: { 'x-acs-dingtalk-access-token': token } });
    const result = response.data?.result ?? response.data;
    if (response.data?.success === false || result?.success === false
      || result?.deliverResults?.some((item: any) => item.success === false)) throw new Error('delivery_failed');
    if (context.isCurrent?.() === false) claim(question, 'superseded');
    if (question.state !== 'creating') {
      await updateCard(question.outTrackId, config, question.state, descriptions[question.state], context.log);
      return toolResult({ status: question.state, questionId: question.questionId });
    }
    if (await context.stopCurrentGeneration() === false) throw new Error('pause_failed');
    if (context.isCurrent?.() === false) await terminate(question, 'superseded');
    // 暂停钩子有异步边界，不能把并发的新消息或超时终态重新激活。
    if (question.state !== 'creating') return toolResult({ status: question.state, questionId: question.questionId });
    question.state = 'pending';
    question.activate();
    return toolResult({
      status: 'pending', questionId: question.questionId, outTrackId: question.outTrackId,
      expiresAt: new Date(question.expiresAt).toISOString(),
      message: '原生表单已发送。停止本轮回复；用户提交后将在原会话以新消息继续。',
    });
  } catch {
    await terminate(question, 'failed');
    return toolResult({ status: 'failed', questionId: question.questionId, error: '问题卡发送或暂停失败，请检查卡片权限、模板和 Stream 回调配置' });
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return undefined; }
}

export function parseQuestionCallback(data: unknown) {
  const record = asRecord(parseJson(data)) ?? {};
  const content = asRecord(parseJson(record.content)) ?? asRecord(parseJson(record.value)) ?? {};
  const privateData = asRecord(parseJson(content.cardPrivateData)) ?? asRecord(parseJson(record.cardPrivateData)) ?? {};
  const params = asRecord(parseJson(privateData.params)) ?? asRecord(parseJson(content.params)) ?? {};
  return {
    outTrackId: record.outTrackId ?? content.outTrackId ?? privateData.outTrackId,
    questionId: Array.isArray(privateData.actionIds) ? privateData.actionIds[0] : undefined,
    // 只读平台事件信封，绝不从用户可编辑的 params/form 提取身份。
    userId: record.userId,
    params,
  };
}

export async function handleDingtalkQuestionCallback(params: {
  accountId: string;
  data: unknown;
  config: DingtalkConfig;
  /** 必须来自钉钉事件信封，不能来自 cardPrivateData/params。 */
  clickerUserId?: string;
  log?: DingtalkQuestionContext['log'];
}): Promise<{ handled: boolean; status?: string }> {
  const parsed = parseQuestionCallback(params.data);
  if (typeof parsed.outTrackId !== 'string' || !parsed.outTrackId.startsWith(TRACK_PREFIX)) return { handled: false };
  const question = questions.get(parsed.outTrackId);
  if (!question) {
    const previous = terminal.get(parsed.outTrackId);
    if (previous && previous.accountId !== params.accountId) return { handled: true, status: 'forbidden' };
    // 重启后不猜测原路由，也不恢复未知执行。点击陈旧卡时关闭表单。
    if (!previous) await updateCard(parsed.outTrackId, params.config, 'expired', descriptions.expired, params.log);
    return { handled: true, status: previous?.state ?? 'expired' };
  }
  const clicker = params.clickerUserId ?? parsed.userId;
  if (question.context.accountId !== params.accountId || typeof clicker !== 'string'
    || clicker !== question.context.senderId
    || (parsed.questionId && parsed.questionId !== question.questionId)) {
    return { handled: true, status: 'forbidden' };
  }
  if (question.expiresAt <= Date.now()) {
    await terminate(question, 'expired');
    return { handled: true, status: 'expired' };
  }
  if (question.context.isCurrent?.() === false) {
    await terminate(question, 'superseded');
    return { handled: true, status: 'superseded' };
  }
  const cancelled = parsed.params.user_cancel === true || parsed.params.user_cancel === 'true';
  if (!cancelled && !Object.hasOwn(parsed.params, 'form')) return { handled: true, status: 'ignored' };
  if (question.state === 'creating') await question.ready;
  if (question.state !== 'pending') return { handled: true, status: question.state };
  if (cancelled) {
    await terminate(question, 'cancelled');
    return { handled: true, status: 'cancelled' };
  }
  let answers: ReturnType<typeof validateAnswers>;
  try {
    answers = validateAnswers(question.form, parseJson(parsed.params.form));
  } catch (error) {
    await updateCard(question.outTrackId, question.context.config, 'pending', (error as Error).message, params.log);
    return { handled: true, status: 'invalid' };
  }
  if (!claim(question, 'submitted')) return { handled: true, status: question.state };
  await updateCard(question.outTrackId, question.context.config, 'submitted', descriptions.submitted, params.log);
  // 结构化封装答案；所有目标身份仍来自发送时的闭包。
  const answer = JSON.stringify({
    type: 'dingtalk_question_answer', questionId: question.questionId, title: question.form.title,
    status: 'submitted', answers,
    fields: question.form.fields.map((field) => ({ name: field.name, label: field.label })),
  });
  try {
    await question.context.resume(answer, question.questionId);
    return { handled: true, status: 'submitted' };
  } catch {
    await updateCard(question.outTrackId, question.context.config, 'failed', '回答已接收，但继续会话失败；请重新发消息。', params.log);
    return { handled: true, status: 'resume_failed' };
  }
}

export function registerDingtalkQuestionTool(api: OpenClawPluginApi): void {
  api.registerTool((toolContext: any) => {
    const captured = captureQuestionContext();
    return {
      name: 'dingtalk_ask_user_question', label: '钉钉交互表单',
      description: '向当前钉钉用户发送原生交互卡片，收集确认、单选、多选或多个表单字段。确认使用带“确认/取消”选项的单选问题；普通文本问题省略 options。多字段使用 fields；不能同时传 questions 和 fields。成功后立即停止本轮回复，用户提交后在原会话作为新消息继续。仅用于当前用户，不可指定其他收件人。',
      parameters: QUESTION_TOOL_SCHEMA as any,
      execute: async (_toolCallId: string, input: unknown) => {
        const context = resolveQuestionContext(toolContext, captured);
        if (!context) return toolResult({ status: 'failed', error: '只能在当前有效的钉钉会话中使用此工具' });
        return sendQuestion(context, input);
      },
    };
  }, { name: 'dingtalk_ask_user_question' });
}
