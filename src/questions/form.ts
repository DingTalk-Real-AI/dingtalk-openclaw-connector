/** 钉钉原生 Form 协议；与社区表单模板的变量/回调契约兼容。 */
export const FORM_TYPES = [
  'TEXT', 'TEXT_ARRAY', 'TEXT_AREA', 'NUMBER', 'SELECT', 'MULTI_SELECT',
  'DATE', 'TIME', 'DATETIME', 'CHECKBOX', 'SWITCH', 'CHECKBOX_GROUP', 'MULTI_CHECKBOX_GROUP',
] as const;
export type FormField = {
  name: string;
  label: string;
  type: typeof FORM_TYPES[number];
  required: boolean;
  placeholder?: string;
  options?: Array<{ value: string; text: string }>;
};
export type QuestionForm = { title: string; description: string; fields: FormField[] };
const choices = new Set(['SELECT', 'MULTI_SELECT', 'CHECKBOX_GROUP', 'MULTI_CHECKBOX_GROUP']);
const multiple = new Set(['MULTI_SELECT', 'MULTI_CHECKBOX_GROUP']);

export function asRecord(value: unknown): Record<string, any> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any> : undefined;
}

function text(value: unknown, fallback: string, limit = 500): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > limit) {
    throw new Error(`文本必须为 1-${limit} 字符`);
  }
  return value.trim();
}

function normalizeOptions(options: unknown, question: boolean): FormField['options'] {
  if (!Array.isArray(options) || options.length < 1 || options.length > 30) {
    throw new Error('选择字段必须有 1-30 个选项');
  }
  const result = options.map((option) => {
    const item = asRecord(option);
    if (!item) throw new Error('选项必须为对象');
    const label = text(question ? item.label ?? item.description : item.text, '', 200);
    const value = text(item.value, label, 200);
    if (!value) throw new Error('选项必须提供 value 或 label');
    return { value, text: label || value };
  });
  if (new Set(result.map((item) => item.value)).size !== result.length) {
    throw new Error('选项 value 不能重复');
  }
  return result;
}

export function buildQuestionForm(raw: unknown): QuestionForm {
  const input = asRecord(raw);
  if (!input) throw new Error('问题参数必须为对象');
  if (input.fields && input.questions) throw new Error('fields 与 questions 只能选择一种');
  const isFields = input.fields !== undefined;
  const entries = isFields ? input.fields : input.questions;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 12) {
    throw new Error('必须提供 1-12 个 fields 或 questions');
  }
  const fields: FormField[] = entries.map((entry, index) => {
    const item = asRecord(entry);
    if (!item) throw new Error('字段必须为对象');
    const name = isFields ? text(item.name, '', 64) : `answer_${index}`;
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)
      || ['constructor', 'prototype', '__proto__'].includes(name)) throw new Error('无效或保留的字段名');
    const type = isFields ? item.type ?? 'TEXT'
      : Array.isArray(item.options) && item.options.length
        ? item.multiSelect ? 'MULTI_CHECKBOX_GROUP' : 'CHECKBOX_GROUP' : 'TEXT';
    if (!FORM_TYPES.includes(type)) throw new Error(`不支持的字段类型：${String(type)}`);
    if (isFields && item.required !== undefined && typeof item.required !== 'boolean') {
      throw new Error('required 必须为布尔值');
    }
    if (!isFields && item.multiSelect !== undefined && typeof item.multiSelect !== 'boolean') {
      throw new Error('multiSelect 必须为布尔值');
    }
    const field: FormField = {
      name, type,
      label: text(isFields ? item.label : item.question ?? item.header, name),
      required: isFields ? item.required === true : true,
    };
    if (item.placeholder !== undefined) field.placeholder = text(item.placeholder, '', 200);
    if (choices.has(type)) field.options = normalizeOptions(item.options, !isFields);
    return field;
  });
  if (new Set(fields.map((item) => item.name)).size !== fields.length) throw new Error('字段名不能重复');
  return {
    title: text(input.title, isFields ? '需要你的确认' : text(entries[0].header, '需要你的确认', 100), 100),
    description: text(input.description, '请填写后提交；仅发起本次会话的用户可回答。', 2000),
    fields,
  };
}

export type FormAnswerValue = string | number | boolean | string[];

/** 所有字段按保存的 schema 验证，禁止回调额外注入字段或未知选项。 */
export function validateAnswers(form: QuestionForm, raw: unknown): Record<string, FormAnswerValue> {
  const input = asRecord(raw);
  if (!input || JSON.stringify(input).length > 32_000) throw new Error('表单回答无效或过长');
  const names = new Set(form.fields.map((item) => item.name));
  if (Object.keys(input).some((name) => !names.has(name))) throw new Error('包含未知字段');
  const result: Record<string, FormAnswerValue> = Object.create(null);
  for (const field of form.fields) {
    let value = input[field.name];
    const wrapped = asRecord(value);
    if (wrapped && choices.has(field.type)) value = wrapped.value;
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0)) {
      if (field.required) throw new Error(`请填写：${field.label}`);
      continue;
    }
    if (choices.has(field.type)) {
      const values = multiple.has(field.type) ? value : [value];
      if (!Array.isArray(values) || values.length > 30
        || new Set(values).size !== values.length
        || values.some((item) => typeof item !== 'string' || !field.options?.some((option) => option.value === item))) {
        throw new Error(`选项无效：${field.label}`);
      }
      result[field.name] = multiple.has(field.type) ? values : values[0];
    } else if (field.type === 'NUMBER') {
      if (typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) value = Number(value);
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`数字无效：${field.label}`);
      result[field.name] = value;
    } else if (field.type === 'CHECKBOX' || field.type === 'SWITCH') {
      if (value === 'true') value = true;
      if (value === 'false') value = false;
      if (typeof value !== 'boolean') throw new Error(`布尔值无效：${field.label}`);
      result[field.name] = value;
    } else if (field.type === 'TEXT_ARRAY') {
      if (!Array.isArray(value) || value.length > 30 || value.some((item) => typeof item !== 'string' || item.length > 4000)) {
        throw new Error(`文本数组无效：${field.label}`);
      }
      result[field.name] = value;
    } else {
      if (typeof value !== 'string' || value.length > 4000) throw new Error(`文本无效：${field.label}`);
      if (field.type === 'DATE') {
        const timestamp = Date.parse(`${value}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(timestamp)
          || new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error('日期必须是有效的 YYYY-MM-DD');
      }
      if (field.type === 'TIME' && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) throw new Error('时间格式必须为 HH:mm');
      if (field.type === 'DATETIME' && (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value) || !Number.isFinite(Date.parse(value)))) throw new Error('日期时间无效');
      result[field.name] = value;
    }
  }
  return result;
}

export const QUESTION_TOOL_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 100 },
    description: { type: 'string', maxLength: 2000 },
    questions: {
      type: 'array', minItems: 1, maxItems: 12,
      items: {
        type: 'object', required: ['question'], additionalProperties: false,
        properties: {
          question: { type: 'string' }, header: { type: 'string' }, multiSelect: { type: 'boolean' },
          options: { type: 'array', maxItems: 30, items: {
            type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' }, description: { type: 'string' } },
          } },
        },
      },
    },
    fields: {
      type: 'array', minItems: 1, maxItems: 12,
      items: {
        type: 'object', required: ['name', 'type'], additionalProperties: false,
        properties: {
          name: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_]{0,63}$' },
          label: { type: 'string' }, type: { type: 'string', enum: FORM_TYPES },
          required: { type: 'boolean' }, placeholder: { type: 'string' },
          options: { type: 'array', maxItems: 30, items: {
            type: 'object', required: ['value', 'text'], properties: { value: { type: 'string' }, text: { type: 'string' } },
          } },
        },
      },
    },
  },
  oneOf: [{ required: ['questions'] }, { required: ['fields'] }],
  additionalProperties: false,
};
