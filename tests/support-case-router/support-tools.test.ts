import { describe, expect, it } from 'vitest';
import { resolveDingtalkGroupToolPolicy } from '../../src/policy.ts';

type ToolPolicy = {
  allow?: string[];
  deny?: string[];
};

function isToolAvailable(policy: ToolPolicy | undefined, toolName: string): boolean {
  if (!policy) {
    return true;
  }

  if (policy.deny?.includes('*') || policy.deny?.includes(toolName)) {
    return false;
  }

  if (!policy.allow) {
    return true;
  }

  return policy.allow.includes('*') || policy.allow.includes(toolName);
}

function cfgWithDingtalk(dingtalkConfig: Record<string, unknown>) {
  return {
    channels: {
      'dingtalk-connector': dingtalkConfig,
    },
  };
}

describe('support case router tool policy', () => {
  it('keeps default-off group policy behavior unchanged', () => {
    const cfg = cfgWithDingtalk({
      groups: {
        'legacy-group': {
          tools: {
            allow: ['legacy.lookup'],
            deny: ['legacy.delete'],
          },
        },
      },
    });

    expect(resolveDingtalkGroupToolPolicy({
      cfg,
      groupId: 'legacy-group',
    })).toEqual({
      allow: ['legacy.lookup'],
      deny: ['legacy.delete'],
    });
    expect(resolveDingtalkGroupToolPolicy({
      cfg,
      groupId: 'unconfigured-group',
    })).toEqual({ allow: ['*'] });
  });

  it('does not enable support safe tools or loosen existing policy for non-allowlisted groups', () => {
    const cfg = cfgWithDingtalk({
      supportCaseRouter: {
        enabled: true,
        allowedGroups: ['support-group'],
        safeAgentId: 'customer-support-safe',
        toolPolicy: {
          mode: 'allowlist',
          allow: ['dingtalk.message.send'],
        },
      },
      groups: {
        'legacy-restricted-group': {
          tools: {
            allow: ['legacy.lookup'],
          },
        },
      },
    });

    const policy = resolveDingtalkGroupToolPolicy({
      cfg,
      groupId: 'legacy-restricted-group',
    });

    expect(policy).toEqual({ allow: ['legacy.lookup'] });
    expect(isToolAvailable(policy, 'legacy.lookup')).toBe(true);
    expect(isToolAvailable(policy, 'dingtalk.message.send')).toBe(false);
    expect(isToolAvailable(policy, 'shell.exec')).toBe(false);
  });

  it('enforces the support safe allowlist for allowlisted groups', () => {
    const cfg = cfgWithDingtalk({
      supportCaseRouter: {
        enabled: true,
        allowedGroups: ['support-group'],
        safeAgentId: 'customer-support-safe',
        toolPolicy: {
          mode: 'allowlist',
          allow: ['dingtalk.message.send', 'dingtalk.card.send'],
        },
      },
    });

    const policy = resolveDingtalkGroupToolPolicy({
      cfg,
      groupId: 'support-group',
    });

    expect(policy).toEqual({
      allow: ['dingtalk.message.send', 'dingtalk.card.send'],
    });
    expect(policy?.allow).not.toContain('*');
    expect(isToolAvailable(policy, 'dingtalk.message.send')).toBe(true);
    expect(isToolAvailable(policy, 'shell.exec')).toBe(false);
    expect(isToolAvailable(policy, 'fs.read')).toBe(false);
    expect(isToolAvailable(policy, 'fs.write')).toBe(false);
    expect(isToolAvailable(policy, 'browser.open')).toBe(false);
    expect(isToolAvailable(policy, 'gateway.call')).toBe(false);
    expect(isToolAvailable(policy, 'cron.schedule')).toBe(false);
    expect(isToolAvailable(policy, 'nodes.create')).toBe(false);
    expect(isToolAvailable(policy, 'internal_write')).toBe(false);
    expect(isToolAvailable(policy, 'dingtalk.media.upload')).toBe(false);
  });

  it('fails closed instead of falling back to allow all when support tools are missing', () => {
    const cfg = cfgWithDingtalk({
      supportCaseRouter: {
        enabled: true,
        allowedGroups: ['support-group'],
        safeAgentId: 'customer-support-safe',
      },
    });

    const policy = resolveDingtalkGroupToolPolicy({
      cfg,
      groupId: 'support-group',
    });

    expect(policy).toEqual({ allow: [] });
    expect(isToolAvailable(policy, 'dingtalk.message.send')).toBe(false);
    expect(isToolAvailable(policy, 'shell.exec')).toBe(false);
  });
});
