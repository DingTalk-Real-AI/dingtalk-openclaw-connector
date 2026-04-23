/**
 * 多 bot @ 提及解析器的端到端用例
 */
import { describe, it, expect } from 'vitest';
import {
  buildBotMentionTable,
  prepareMultiBotMentions,
  substituteBotMentions,
  resolveAtAccountIdsToChatbotUserIds,
} from '../src/services/messaging/mentions.ts';

const CFG = {
  channels: {
    'dingtalk-connector': {
      accounts: {
        'main-bot': {
          name: '主助手机器人',
          chatbotUserId: '$:LWCP_v1:$6WU3eL8Xvn2qW40hDSakqZ7ESytOrAB5',
          chatbotCorpId: 'ding3b2e428dfde07ac7ffe93478753d9884',
          clientId: 'dingf9vdlfmr0vp6ye3q',
        },
        'dev-bot': {
          name: '开发助手机器人',
          chatbotUserId: '$:LWCP_v1:$L+2ds8Ws8XBTGZX0XMGY72Z7xZ/7v0k6',
          chatbotCorpId: 'ding3b2e428dfde07ac7ffe93478753d9884',
          clientId: 'ding83ocnnxdxjzmjeq0',
        },
        'no-identity-bot': {
          name: '新建但未激活的机器人',
          clientId: 'dingxxxx',
        },
      },
    },
  },
  bindings: [
    { agentId: 'main', match: { channel: 'dingtalk-connector', accountId: 'main-bot' } },
    { agentId: 'dev-agent', match: { channel: 'dingtalk-connector', accountId: 'dev-bot' } },
  ],
};

const MAIN_ID = '$:LWCP_v1:$6WU3eL8Xvn2qW40hDSakqZ7ESytOrAB5';
const DEV_ID = '$:LWCP_v1:$L+2ds8Ws8XBTGZX0XMGY72Z7xZ/7v0k6';

describe('buildBotMentionTable', () => {
  it('按 accountId 聚合 name / agentIds / aliases', () => {
    const table = buildBotMentionTable(CFG);
    expect(table).toHaveLength(3);

    const dev = table.find((e) => e.accountId === 'dev-bot')!;
    expect(dev.chatbotUserId).toBe(DEV_ID);
    expect(dev.agentIds).toEqual(['dev-agent']);
    expect(dev.aliases).toEqual(expect.arrayContaining(['dev-bot', '开发助手机器人', 'dev-agent']));
  });
});

describe('substituteBotMentions', () => {
  it('@agentId 被替换成 @chatbotUserId', () => {
    const r = substituteBotMentions('@dev-agent 来看下', CFG);
    expect(r.text).toBe(`@${DEV_ID} 来看下`);
    expect(r.injectedChatbotUserIds).toEqual([DEV_ID]);
  });

  it('@accountId 被替换', () => {
    const r = substituteBotMentions('@dev-bot 加油', CFG);
    expect(r.text).toBe(`@${DEV_ID} 加油`);
  });

  it('@友好名 被替换', () => {
    const r = substituteBotMentions('@开发助手机器人 到你了', CFG);
    expect(r.text).toBe(`@${DEV_ID} 到你了`);
  });

  it('已经是加密 ID 的片段幂等保留', () => {
    const input = `已通知 @${DEV_ID} 查看`;
    const r = substituteBotMentions(input, CFG);
    expect(r.text).toBe(input);
    expect(r.injectedChatbotUserIds).toContain(DEV_ID);
  });

  it('无关的 @ 不被改动', () => {
    const r = substituteBotMentions('hi @all 和 @13800000000', CFG);
    expect(r.text).toBe('hi @all 和 @13800000000');
    expect(r.injectedChatbotUserIds).toEqual([]);
  });

  it('detectBareAliases=true 时，裸别名也会注入 chatbotUserId', () => {
    const r = substituteBotMentions('已拉上 dev-agent 来 review', CFG, {
      detectBareAliases: true,
    });
    expect(r.text).toBe('已拉上 dev-agent 来 review');
    expect(r.injectedChatbotUserIds).toEqual([DEV_ID]);
  });
});

describe('resolveAtAccountIdsToChatbotUserIds', () => {
  it('解析已知 accountId 并报告 missing', () => {
    const r = resolveAtAccountIdsToChatbotUserIds(CFG, ['main-bot', 'no-identity-bot', 'ghost']);
    expect(r.resolved).toEqual([MAIN_ID]);
    expect(r.missing).toEqual(['no-identity-bot', 'ghost']);
  });
});

describe('prepareMultiBotMentions', () => {
  it('atAccountIds + 文本 @ 合并去重', () => {
    const r = prepareMultiBotMentions({
      cfg: CFG,
      content: '@dev-agent 同时也叫一下 main',
      atAccountIds: ['main-bot'],
    });
    expect(r.atDingtalkIds.sort()).toEqual([DEV_ID, MAIN_ID].sort());
    expect(r.content).toContain(`@${DEV_ID}`);
    expect(r.content).toContain(`@${MAIN_ID}`);
    expect(r.missingAccountIds).toEqual([]);
  });

  it('missingAccountIds 透出给上层 log', () => {
    const r = prepareMultiBotMentions({
      cfg: CFG,
      content: 'hi',
      atAccountIds: ['no-identity-bot'],
    });
    expect(r.atDingtalkIds).toEqual([]);
    expect(r.missingAccountIds).toEqual(['no-identity-bot']);
  });
});
