import { describe, expect, it } from 'vitest';
import { buildQuestionForm, validateAnswers } from '../../src/questions/form.ts';

describe('原生表单字段契约', () => {
  it('构建确认、单选、多选和文本问题', () => {
    const form = buildQuestionForm({ questions: [
      { question: '确认发布？', options: [{ label: '确认', value: 'yes' }, { label: '取消', value: 'no' }] },
      { question: '选组件', multiSelect: true, options: [{ label: 'API' }, { label: 'UI' }] },
      { question: '备注' },
    ] });
    expect(form.fields.map((field) => field.type)).toEqual(['CHECKBOX_GROUP', 'MULTI_CHECKBOX_GROUP', 'TEXT']);
    expect(validateAnswers(form, { answer_0: 'yes', answer_1: ['API', 'UI'], answer_2: '测试环境' }))
      .toEqual({ answer_0: 'yes', answer_1: ['API', 'UI'], answer_2: '测试环境' });
  });

  it('验证原生选择包装、数字、布尔、数组以及可选字段', () => {
    const form = buildQuestionForm({ fields: [
      { name: 'one', type: 'SELECT', options: [{ value: 'a', text: 'A' }], required: true },
      { name: 'many', type: 'MULTI_SELECT', options: [{ value: 'a', text: 'A' }] },
      { name: 'count', type: 'NUMBER' }, { name: 'enabled', type: 'SWITCH' },
      { name: 'notes', type: 'TEXT_ARRAY' }, { name: 'other', type: 'TEXT' },
    ] });
    expect(validateAnswers(form, { one: { index: 0, value: 'a' }, many: { index: [0], value: ['a'] }, count: '12.5', enabled: 'false', notes: ['甲', '乙'] }))
      .toEqual({ one: 'a', many: ['a'], count: 12.5, enabled: false, notes: ['甲', '乙'] });
  });

  it.each([
    {}, { questions: [] }, { fields: [{ name: '__proto__', type: 'TEXT' }] },
    { fields: [{ name: 'x', type: 'SCRIPT' }] },
    { fields: [{ name: 'x', type: 'SELECT', options: [{ value: 'a' }, { value: 'a' }] }] },
    { fields: [{ name: 'x' }, { name: 'x' }] },
    { questions: [{ question: 'test' }], fields: [{ name: 'x' }] },
    { fields: [{ name: 'x', required: 'false' }] },
  ])('拒绝无效 schema：%j', (input) => {
    expect(() => buildQuestionForm(input)).toThrow();
  });

  it.each([
    { answer_0: 'unknown' }, { answer_0: ['a'] }, { answer_0: 1 }, {},
    { answer_0: 'a', injectedTarget: 'another-user' },
  ])('拒绝未知选项、字段、类型或缺失必填：%j', (input) => {
    const form = buildQuestionForm({ questions: [{ question: '选一个', options: [{ label: 'A', value: 'a' }] }] });
    expect(() => validateAnswers(form, input)).toThrow();
  });

  it.each([
    ['MULTI_SELECT', ['a', 'a']], ['MULTI_SELECT', 'a'], ['NUMBER', 'Infinity'],
    ['NUMBER', {}], ['SWITCH', 'yes'], ['TEXT', {}], ['TEXT_ARRAY', [1]],
    ['DATE', 'yesterday'], ['DATE', '2026-02-31'], ['TIME', '25:01'], ['DATETIME', 'tomorrow'],
  ])('拒绝字段 %s 的错误类型', (type, answer) => {
    const form = buildQuestionForm({ fields: [{ name: 'value', type, options: [{ value: 'a', text: 'A' }] }] });
    expect(() => validateAnswers(form, { value: answer })).toThrow();
  });
});
