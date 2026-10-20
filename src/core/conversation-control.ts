import { randomUUID } from 'node:crypto';
import { isAbortRequestText, isBtwRequestText } from 'openclaw/plugin-sdk/reply-runtime';

export function classifyControl(text: string): 'stop' | 'btw' | undefined {
  if (isAbortRequestText(text)) return 'stop';
  if (isBtwRequestText(text)) return 'btw';
}

export interface ConversationRun {
  accountId: string;
  sessionKey: string;
  senderId: string;
  runId: string;
  controller: AbortController;
}

/** 只保存本进程的运行句柄；宿主仍拥有会话队列、工具取消和子任务生命周期。 */
export class ConversationRuns {
  private readonly runs = new Map<string, ConversationRun>();

  begin(scope: Omit<ConversationRun, 'runId' | 'controller'>): ConversationRun {
    const run = { ...scope, runId: randomUUID(), controller: new AbortController() };
    this.runs.set(run.runId, run);
    return run;
  }

  finish(run: ConversationRun): void { this.runs.delete(run.runId); }

  abortSession(accountId: string, sessionKey: string): ConversationRun[] {
    const matches = [...this.runs.values()].filter((run) => run.accountId === accountId && run.sessionKey === sessionKey);
    for (const run of matches) run.controller.abort();
    return matches;
  }
}

export const conversationRuns = new ConversationRuns();

// 新消息使未开始续聊的旧表单失效；有界淘汰时按失效处理。
const turnTokens = new Map<string, string>();
export function questionTurnScope(accountId: string, conversationId: string, senderId: string): string {
  return JSON.stringify([accountId, conversationId, senderId]);
}
export function beginQuestionTurn(scope: string): string {
  const token = randomUUID();
  turnTokens.delete(scope);
  if (turnTokens.size >= 1000) turnTokens.delete(turnTokens.keys().next().value!);
  turnTokens.set(scope, token);
  return token;
}
export function isCurrentQuestionTurn(scope: string, token: string): boolean {
  return turnTokens.get(scope) === token;
}
