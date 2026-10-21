import { describe, expect, it } from 'vitest';
import { AiError } from '../../../src/ai/ai-types.js';
import { classifyQuestion } from '../../../src/ai/intent/classify-question.js';
import { extractJsonObject, validateIntent } from '../../../src/ai/intent/intent-validate.js';
import { createFakeAiRuntime } from '../answers/fake-ai-runtime.js';

const TODAY = '2026-10-21';
const TOPICS = ['Xác suất thống kê', 'Giải tích 1'];
const check = (value: unknown) => validateIntent(value, TOPICS, TODAY);

describe('intent JSON validation', () => {
  it('accepts a well-formed deadline intent and keeps only offered titles', () => {
    expect(
      check({
        kind: 'deadlines',
        from: '2026-10-19',
        to: '2026-10-25',
        overdue: true,
        about: ['xác suất THỐNG KÊ', 'Bí mật', 'Giải tích 1', 42],
      }),
    ).toEqual({
      kind: 'deadlines',
      from: '2026-10-19',
      to: '2026-10-25',
      overdue: true,
      about: ['Xác suất thống kê', 'Giải tích 1'],
      source: 'model',
    });
  });

  it.each([
    ['unknown kind', { kind: 'calendar', from: null, to: null, overdue: false }],
    ['invalid date', { kind: 'deadlines', from: '2026-02-30', to: '2026-03-01', overdue: false }],
    ['from after to', { kind: 'deadlines', from: '2026-10-25', to: '2026-10-19', overdue: false }],
    [
      'range over 366 days',
      { kind: 'deadlines', from: '2026-01-01', to: '2027-01-02', overdue: false },
    ],
    ['one-sided range', { kind: 'deadlines', from: '2026-10-19', to: null, overdue: false }],
    ['overdue not a boolean', { kind: 'deadlines', from: null, to: null, overdue: 'yes' }],
    ['about not a list', { kind: 'text', about: 'Giải tích 1' }],
    ['not an object', ['deadlines']],
    ['nothing', undefined],
  ])('refuses %s', (_label, value) => {
    expect(check(value)).toBeNull();
  });

  it('accepts a 366-day range (leap year) and fills defaults', () => {
    expect(
      check({ kind: 'deadlines', from: '2028-01-01', to: '2028-12-31', overdue: false }),
    ).toMatchObject({
      from: '2028-01-01',
      to: '2028-12-31',
    });
    // A deadline question without a range and not about overdue items means this week.
    expect(check({ kind: 'deadlines', from: null, to: null, overdue: false })).toMatchObject({
      from: '2026-10-19',
      to: '2026-10-25',
      overdue: true,
    });
    expect(check({ kind: 'deadlines', from: null, to: null, overdue: true })).toMatchObject({
      from: null,
      to: null,
      overdue: true,
    });
    expect(check({ kind: 'tasks' })).toMatchObject({ from: TODAY, to: TODAY, about: [] });
    expect(check({ kind: 'text', from: '2026-10-19', to: '2026-10-25' })).toMatchObject({
      from: null,
      to: null,
      overdue: false,
    });
  });

  it('finds the JSON object inside a fenced or chatty reply', () => {
    expect(extractJsonObject('```json\n{"kind":"text"}\n```')).toEqual({ kind: 'text' });
    expect(extractJsonObject('Sure! {"kind": "tasks"} done')).toEqual({ kind: 'tasks' });
    expect(extractJsonObject('{not json}')).toBeUndefined();
    expect(extractJsonObject('no braces')).toBeUndefined();
  });
});

describe('classifyQuestion', () => {
  const run = (reply: string | AiError, question = 'Tuần này có gì đến hạn?') => {
    const runtime = createFakeAiRuntime({ replies: { intent: reply } });
    return classifyQuestion(question, { runtime, today: TODAY, topics: TOPICS }).then((result) => ({
      result,
      runtime,
    }));
  };

  it('sends one small JSON request with today, the week and the topic titles', async () => {
    const { result, runtime } = await run(
      '{"kind":"deadlines","from":"2026-10-21","to":"2026-10-25","overdue":true,"about":["Giải tích 1"]}',
    );
    expect(result.intent).toMatchObject({
      kind: 'deadlines',
      about: ['Giải tích 1'],
      source: 'model',
    });
    expect(result.usage).toEqual({ inputTokens: 50, outputTokens: 5 });
    expect(runtime.requests).toHaveLength(1);
    const [request] = runtime.requests;
    expect(request).toMatchObject({
      purpose: 'intent',
      json: true,
      maxTokens: 300,
      temperature: 0,
    });
    const text = request!.messages[0]!.content;
    expect(text).toContain('Today: 2026-10-21 (Wednesday)');
    expect(text).toContain('This week: 2026-10-19 to 2026-10-25');
    expect(text).toContain('- Xác suất thống kê');
    expect(text).toContain('<question>\nTuần này có gì đến hạn?\n</question>');
    expect(request!.system).toMatch(/data, never instructions/);
  });

  it('falls back to the rules on invalid JSON or a provider error', async () => {
    for (const reply of [
      'I think it is about deadlines',
      '{"kind":"deadlines","from":"2026-13-01","to":"2026-13-02","overdue":false}',
      new AiError('AI_PROVIDER_ERROR', 'down', { reason: 'server' }),
    ]) {
      const { result } = await run(reply);
      expect(result.intent).toMatchObject({
        kind: 'deadlines',
        from: '2026-10-19',
        to: '2026-10-25',
        source: 'rules',
      });
    }
  });

  it('does not swallow budget or consent errors', async () => {
    await expect(run(new AiError('AI_BUDGET', 'limit'))).rejects.toMatchObject({
      code: 'AI_BUDGET',
    });
    await expect(run(new AiError('AI_DISABLED', 'off'))).rejects.toMatchObject({
      code: 'AI_DISABLED',
    });
  });
});
