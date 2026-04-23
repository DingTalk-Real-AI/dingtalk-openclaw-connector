import { describe, expect, it } from 'vitest';
import { DingtalkConfigSchema } from '../../src/config/schema.ts';

describe('supportCaseRouter config schema', () => {
  it('defaults supportCaseRouter.enabled to false when omitted', () => {
    const parsed = DingtalkConfigSchema.parse({});

    expect(parsed.supportCaseRouter?.enabled ?? false).toBe(false);
  });

  it('rejects enabled supportCaseRouter without allowedGroups, safeAgentId, and tool policy', () => {
    expect(() =>
      DingtalkConfigSchema.parse({
        supportCaseRouter: {
          enabled: true,
        },
      }),
    ).toThrow(/allowedGroups|safeAgentId|tool policy/i);
  });
});
