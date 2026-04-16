import { describe, it, expect } from 'vitest';
import { __testables } from '../test';

const { buildDeliverBody, buildMsgPayload } = __testables as any;

describe('buildDeliverBody', () => {
  it('user target: openSpaceId contains IM_ROBOT and userId', () => {
    const body = buildDeliverBody('card_1', { type: 'user', userId: 'u1' }, 'robot_1');
    expect(body.outTrackId).toBe('card_1');
    expect(body.userIdType).toBe(1);
    expect(body.openSpaceId).toContain('dtv1.card//IM_ROBOT.u1');
    expect(body.imRobotOpenDeliverModel).toMatchObject({ robotCode: 'robot_1', spaceType: 'IM_ROBOT' });
  });

  it('group target: openSpaceId contains IM_GROUP and openConversationId', () => {
    const body = buildDeliverBody('card_2', { type: 'group', openConversationId: 'cid_1' }, 'robot_2');
    expect(body.outTrackId).toBe('card_2');
    expect(body.userIdType).toBe(1);
    expect(body.openSpaceId).toContain('dtv1.card//IM_GROUP.cid_1');
    expect(body.imGroupOpenDeliverModel).toEqual({ robotCode: 'robot_2' });
  });
});

describe('buildMsgPayload', () => {
  describe('text / default', () => {
    it('msgType text returns sampleText', () => {
      const out = buildMsgPayload('text', 'hello');
      expect('error' in out).toBe(false);
      expect(out.msgKey).toBe('sampleText');
      expect(out.msgParam).toEqual({ content: 'hello' });
    });
    it('unknown msgType falls back to sampleText', () => {
      const out = buildMsgPayload('unknown' as any, 'x');
      expect(out.msgKey).toBe('sampleText');
      expect(out.msgParam).toEqual({ content: 'x' });
    });
  });

  describe('markdown', () => {
    it('uses first line as title when title not provided', () => {
      const out = buildMsgPayload('markdown', '# Hi\nbody');
      expect(out.msgKey).toBe('sampleMarkdown');
      expect(out.msgParam.title).toBeDefined();
      expect(out.msgParam.text).toBe('# Hi\nbody');
    });
    it('uses provided title', () => {
      const out = buildMsgPayload('markdown', 'body', 'My Title');
      expect(out.msgKey).toBe('sampleMarkdown');
      expect(out.msgParam.title).toBe('My Title');
      expect(out.msgParam.text).toBe('body');
    });
  });

  describe('link', () => {
    it('valid JSON returns sampleLink', () => {
      const content = '{"title":"t","messageUrl":"u","picUrl":"p"}';
      const out = buildMsgPayload('link', content);
      expect('error' in out).toBe(false);
      expect(out.msgKey).toBe('sampleLink');
      expect(out.msgParam).toEqual({ title: 't', messageUrl: 'u', picUrl: 'p' });
    });
    it('invalid JSON returns error', () => {
      const out = buildMsgPayload('link', 'not json');
      expect('error' in out).toBe(true);
      expect((out as any).error).toContain('JSON');
    });
  });

  describe('actionCard', () => {
    it('valid JSON returns sampleActionCard', () => {
      const content = '{"title":"t","text":"b"}';
      const out = buildMsgPayload('actionCard', content);
      expect('error' in out).toBe(false);
      expect(out.msgKey).toBe('sampleActionCard');
      expect(out.msgParam).toEqual({ title: 't', text: 'b' });
    });
    it('invalid JSON returns error', () => {
      const out = buildMsgPayload('actionCard', 'invalid');
      expect('error' in out).toBe(true);
      expect((out as any).error).toContain('JSON');
    });
  });

  describe('image', () => {
    it('returns sampleImageMsg with photoURL', () => {
      const out = buildMsgPayload('image', 'http://photo.url');
      expect(out.msgKey).toBe('sampleImageMsg');
      expect(out.msgParam).toEqual({ photoURL: 'http://photo.url' });
    });
  });
});
