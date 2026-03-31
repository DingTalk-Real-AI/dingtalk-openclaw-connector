/**
 * Gateway Methods 注册
 * 
 * 提供钉钉插件的 RPC 接口，允许外部系统、AI Agent 和其他插件调用钉钉功能
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { resolveDingtalkAccount } from "./config/accounts.ts";
import { DingtalkDocsClient } from "./docs.ts";
import { sendProactive } from "./services/messaging.ts";
import { getUnionId } from "./utils/utils-legacy.ts";

/**
 * 注册所有 Gateway Methods
 */
export function registerGatewayMethods(api: OpenClawPluginApi) {
  const log = api.logger;
  
  // ============ 消息发送类 ============

  /**
   * 主动发送单聊消息
   * 
   * @example
   * ```typescript
   * await gateway.call('dingtalk-connector.sendToUser', {
   *   userId: 'user123',
   *   content: '任务已完成！',
   *   useAICard: true
   * });
   * ```
   */
  api.registerGatewayMethod('dingtalk-connector.sendToUser', async ({ context, params, respond }) => {
    const { loadConfig } = await import('openclaw/plugin-sdk/config-runtime');
    const cfg = loadConfig();
    try {
      const { userId, userIds, content, msgType, title, useAICard, fallbackToNormal, accountId } = params || {};
      const account = resolveDingtalkAccount({ cfg, accountId });
      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }

      const targetUserIds = userIds || (userId ? [userId] : []);
      if (targetUserIds.length === 0) {
        return respond(false, { error: 'userId or userIds is required' });
      }

      if (!content) {
        return respond(false, { error: 'content is required' });
      }

      // 构建目标
      const target = targetUserIds.length === 1
        ? { userId: targetUserIds[0] }
        : { userIds: targetUserIds };

      const result = await sendProactive(account.config, target, content, {
        msgType,
        title,
        log,
        useAICard: useAICard !== false,
        fallbackToNormal: fallbackToNormal !== false,
      });

      respond(result.ok, result);
    } catch (err: any) {
      log?.error?.(`[Gateway][sendToUser] 错误: ${err.message}`);
      respond(false, { error: err.message });
    }
  });

  /**
   * 主动发送群聊消息
   * 
   * @example
   * ```typescript
   * await gateway.call('dingtalk-connector.sendToGroup', {
   *   openConversationId: 'cid123',
   *   content: '构建失败，请检查日志',
   *   useAICard: true
   * });
   * ```
   */
  api.registerGatewayMethod('dingtalk-connector.sendToGroup', async ({ context, params, respond }) => {
    const { loadConfig } = await import('openclaw/plugin-sdk/config-runtime');
    const cfg = loadConfig();
    try {
      const { openConversationId, content, msgType, title, useAICard, fallbackToNormal, accountId } = params || {};
      const account = resolveDingtalkAccount({ cfg, accountId });
      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }

      if (!openConversationId) {
        return respond(false, { error: 'openConversationId is required' });
      }

      if (!content) {
        return respond(false, { error: 'content is required' });
      }

      const result = await sendProactive(account.config, { openConversationId }, content, {
        msgType,
        title,
        log,
        useAICard: useAICard !== false,
        fallbackToNormal: fallbackToNormal !== false,
      });

      respond(result.ok, result);
    } catch (err: any) {
      log?.error?.(`[Gateway][sendToGroup] 错误: ${err.message}`);
      console.error(err);
      respond(false, { error: err.message });
    }
  });

  api.registerGatewayMethod('dingtalk-connector.send', async ({ context, params, respond }) => {
    const { loadConfig } = await import('openclaw/plugin-sdk/config-runtime');
    const cfg = loadConfig();
    try {
      const { target, content, message, msgType, title, useAICard, fallbackToNormal, accountId } = params || {};
      const actualContent = content || message;
      const account = resolveDingtalkAccount({ cfg, accountId });
      log?.info?.(`[Gateway][send] 收到请求: target=${target}, contentLen=${actualContent?.length}`);

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }

      if (!target) {
        return respond(false, { error: 'target is required (format: user:<userId> or group:<openConversationId>)' });
      }

      if (!actualContent) {
        return respond(false, { error: 'content is required' });
      }

      const targetStr = String(target);
      let sendTarget: { userId?: string; openConversationId?: string };

      if (targetStr.startsWith('user:')) {
        sendTarget = { userId: targetStr.slice(5) };
      } else if (targetStr.startsWith('group:')) {
        sendTarget = { openConversationId: targetStr.slice(6) };
      } else {
        // 默认当作 userId
        sendTarget = { userId: targetStr };
      }

      const result = await sendProactive(account.config, sendTarget, actualContent, {
        msgType,
        title,
        log,
        useAICard: useAICard !== false,
        fallbackToNormal: fallbackToNormal !== false,
      });

      respond(result.ok, result);
    } catch (err: any) {
      log?.error?.(`[Gateway][send] 错误: ${err.message}`);
      respond(false, { error: err.message });
    }
  });

  // ============ 文档操作类 ============

  api.registerGatewayMethod('dingtalk-connector.docs.read', async ({ context, params, respond }) => {
    const { loadConfig } = await import('openclaw/plugin-sdk/config-runtime');
    const cfg = loadConfig();
    try {
      const { docId, operatorId: rawOperatorId, accountId } = params || {};
      const account = resolveDingtalkAccount({ cfg, accountId });

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }

      if (!docId) {
        return respond(false, { error: 'docId is required' });
      }

      if (!rawOperatorId) {
        return respond(false, { error: 'operatorId (unionId or staffId) is required' });
      }

      // 如果 operatorId 不像 unionId，尝试转换
      let operatorId = rawOperatorId;
      if (!rawOperatorId.includes('$')) {
        const resolved = await getUnionId(rawOperatorId, account.config, log);
        if (resolved) operatorId = resolved;
      }

      const client = new DingtalkDocsClient(account.config, log);
      const content = await client.readDoc(docId, operatorId);

      if (content !== null) {
        respond(true, { content });
      } else {
        respond(false, { error: 'Failed to read document node' });
      }
    } catch (err: any) {
      log?.error?.(`[Gateway][docs.read] 错误: ${err.message}`);
      respond(false, { error: err.message });
    }
  });

  /**
   * 创建钉钉文档
   * 
   * @example
   * ```typescript
   * const result = await gateway.call('dingtalk-connector.docs.create', {
   *   spaceId: 'workspace123',
   *   title: '会议纪要',
   *   content: '今天讨论了...'
   * });
   * console.log('文档ID:', result.docId);
   * ```
   */
  api.registerGatewayMethod('dingtalk-connector.docs.create', async ({ context, params, respond }) => {
    const { loadConfig } = await import('openclaw/plugin-sdk/config-runtime');
    const cfg = loadConfig();
    try {
      const { spaceId, title, content, accountId } = params || {};
      const account = resolveDingtalkAccount({ cfg, accountId });

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }

      if (!spaceId || !title) {
        return respond(false, { error: 'spaceId and title are required' });
      }

      const client = new DingtalkDocsClient(account.config, log);
      const doc = await client.createDoc(spaceId, title, content);

      if (doc) {
        respond(true, doc);
      } else {
        respond(false, { error: 'Failed to create document' });
      }
    } catch (err: any) {
      log?.error?.(`[Gateway][docs.create] 错误: ${err.message}`);
      respond(false, { error: err.message });
    }
  });

  /**
   * 向钉钉文档追加内容
   * 
   * @example
   * ```typescript
   * await gateway.call('dingtalk-connector.docs.append', {
   *   docId: 'doc123',
   *   content: '补充内容...'
   * });
   * ```
   */
  api.registerGatewayMethod('dingtalk-connector.docs.append', async ({ context, params, respond }) => {
    const { loadConfig } = await import('openclaw/plugin-sdk/config-runtime');
    const cfg = loadConfig();
    try {
      const { docId, content, accountId } = params || {};
      const account = resolveDingtalkAccount({ cfg, accountId });

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }

      if (!docId || !content) {
        return respond(false, { error: 'docId and content are required' });
      }

      const client = new DingtalkDocsClient(account.config, log);
      const ok = await client.appendToDoc(docId, content);

      respond(ok, ok ? { success: true } : { error: 'Failed to append to document' });
    } catch (err: any) {
      log?.error?.(`[Gateway][docs.append] 错误: ${err.message}`);
      respond(false, { error: err.message });
    }
  });

  /**
   * 搜索钉钉文档
   * 
   * @example
   * ```typescript
   * const result = await gateway.call('dingtalk-connector.docs.search', {
   *   keyword: '项目规范',
   *   spaceId: 'workspace123'  // 可选
   * });
   * console.log('找到文档:', result.docs);
   * ```
   */
  api.registerGatewayMethod('dingtalk-connector.docs.search', async ({ context, params, respond }) => {
    const { loadConfig } = await import('openclaw/plugin-sdk/config-runtime');
    const cfg = loadConfig();
    try {
      const { keyword, spaceId, accountId } = params || {};
      const account = resolveDingtalkAccount({ cfg, accountId });

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }

      if (!keyword) {
        return respond(false, { error: 'keyword is required' });
      }

      const client = new DingtalkDocsClient(account.config, log);
      const docs = await client.searchDocs(keyword, spaceId);

      respond(true, { docs });
    } catch (err: any) {
      log?.error?.(`[Gateway][docs.search] 错误: ${err.message}`);
      respond(false, { error: err.message });
    }
  });

  /**
   * 列出空间下的文档
   * 
   * @example
   * ```typescript
   * const result = await gateway.call('dingtalk-connector.docs.list', {
   *   spaceId: 'workspace123',
   *   parentId: 'folder456'  // 可选，不传则列出根目录
   * });
   * console.log('文档列表:', result.docs);
   * ```
   */
  api.registerGatewayMethod('dingtalk-connector.docs.list', async ({ context, params, respond }) => {
    const { loadConfig } = await import('openclaw/plugin-sdk/config-runtime');
    const cfg = loadConfig();
    try {
      const { spaceId, parentId, accountId } = params || {};
      const account = resolveDingtalkAccount({ cfg, accountId });

      if (!account.config?.clientId) {
        return respond(false, { error: 'DingTalk not configured' });
      }

      if (!spaceId) {
        return respond(false, { error: 'spaceId is required' });
      }

      const client = new DingtalkDocsClient(account.config, log);
      const docs = await client.listDocs(spaceId, parentId);

      respond(true, { docs });
    } catch (err: any) {
      log?.error?.(`[Gateway][docs.list] 错误: ${err.message}`);
      respond(false, { error: err.message });
    }
  });

  // ============ 状态检查类 ============

  api.registerGatewayMethod('dingtalk-connector.status', async ({ context, params, respond }) => {
    const { loadConfig } = await import('openclaw/plugin-sdk/config-runtime');
    const cfg = loadConfig();
    try {
      const accountId = (params as any)?.accountId as string | undefined;
      const account = resolveDingtalkAccount({ cfg, accountId });
      const hasClientId = !!account.config?.clientId;
      const hasClientSecret = !!account.config?.clientSecret;

      respond(true, {
        configured: hasClientId && hasClientSecret,
        enabled: account.enabled,
        accountId: account.accountId,
        clientId: hasClientId ? String(account.config!.clientId).substring(0, 8) + '...' : undefined,
      });
    } catch (err: any) {
      log?.error?.(`[Gateway][status] 错误: ${err.message}`);
      respond(false, { error: err.message });
    }
  });

  api.registerGatewayMethod('dingtalk-connector.probe', async ({ context, respond }) => {
    const { loadConfig } = await import('openclaw/plugin-sdk/config-runtime');
    const cfg = loadConfig();
    try {
      const account = resolveDingtalkAccount({ cfg });
      
      if (!account.config?.clientId || !account.config?.clientSecret) {
        return respond(false, { error: 'Not configured' });
      }

      // 尝试获取 access token 来验证连接
      const { getAccessToken } = await import('./utils/utils-legacy.ts');
      await getAccessToken(account.config);

      respond(true, { ok: true, details: { clientId: account.config.clientId } });
    } catch (err: any) {
      log?.error?.(`[Gateway][probe] 错误: ${err.message}`);
      respond(false, { ok: false, error: err.message });
    }
  });

}
