import { existsSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiError } from '../../../src/ai/ai-types.js';
import { createAiTestApp, MONDAY, type AiTestApp } from './ai-test-app.js';
import { createFakeAiRuntime } from './fake-ai-runtime.js';

const FILES = {
  '2 Areas/Xác suất.md': '- [ ] Nộp bài tập 📅 2026-10-19\n- [ ] Ôn chương 2 📅 2026-10-21\n',
  '0 Inbox/Trễ.md': '- [ ] Trả sách thư viện 📅 2026-10-16\n',
  'Riêng tư/Nhật ký.md': '- [ ] Việc riêng tư hôm nay 📅 2026-10-19\n',
  '2 Areas/Có thật.md': 'Ghi chú có thật.\n',
};
const SCOPE = ['', '0 Inbox', '1 Projects', '2 Areas', 'Daily', 'wiki'];

describe('Today "Trợ lý" line (cached once per day and language)', () => {
  let a: AiTestApp;
  const cacheFile = () => path.join(a.t.vaultRoot, '.secondbrain', 'cache', 'ai-today.json');
  const today = () => a.runtime.requests.filter((r) => r.purpose === 'today');

  beforeAll(async () => {
    a = await createAiTestApp(47745, {
      files: FILES,
      runtime: createFakeAiRuntime({
        folders: SCOPE,
        replies: { today: '  "Hôm nay bạn có 2 việc, 1 việc đã quá hạn."\nDòng thừa' },
      }),
    });
  });
  afterAll(async () => a?.t.close());

  it('GET reads the cache only: no call, no file', async () => {
    const res = await a.t.call('GET', '/api/ai/today-summary');
    expect(res.json()).toEqual({ date: '2026-10-19', text: null });
    expect(res.headers['cache-control']).toBe('no-store');
    expect(a.runtime.requests).toEqual([]);
    expect(existsSync(cacheFile())).toBe(false);
  });

  it('POST generates one line from counts and in-scope titles, then serves the cache', async () => {
    const [first, second] = await Promise.all([
      a.t.call('POST', '/api/ai/today-summary'),
      a.t.call('POST', '/api/ai/today-summary', {}),
    ]);
    const line = 'Hôm nay bạn có 2 việc, 1 việc đã quá hạn.';
    expect(first.json()).toEqual({ date: '2026-10-19', text: line });
    expect(second.json()).toEqual({ date: '2026-10-19', text: line });
    expect(today()).toHaveLength(1);
    const sent = today()[0]!.messages[0]!.content;
    expect(sent).toContain('Quá hạn: 1');
    // Counts cover in-scope notes only (the private note's task due today is left out).
    expect(sent).toContain('Deadline tuần này (từ hôm nay): 2');
    expect(sent).toContain('Việc hôm nay còn mở: 1');
    expect(sent).toContain('- Nộp bài tập');
    expect(sent).toContain('- Trả sách thư viện (quá hạn)');
    expect(sent).not.toContain('riêng tư');
    expect((await a.t.call('GET', '/api/ai/today-summary')).json().text).toBe(line);
    await a.t.call('POST', '/api/ai/today-summary');
    expect(today()).toHaveLength(1);
    expect(JSON.parse(readFileSync(cacheFile(), 'utf8'))).toEqual({
      version: 1,
      date: '2026-10-19',
      texts: { vi: line },
    });
  });

  it('another language or another day generates again; not ready answers null without a call', async () => {
    a.t.settings.ui.language = 'en';
    a.runtime.options.replies!.today = `You have ${'many things '.repeat(20)}today.`;
    expect((await a.t.call('GET', '/api/ai/today-summary')).json().text).toBeNull();
    const en = (await a.t.call('POST', '/api/ai/today-summary')).json();
    expect([...en.text].length).toBeLessThanOrEqual(160);
    expect(en.text.endsWith('…')).toBe(true);
    expect(today()).toHaveLength(2);
    a.t.settings.ui.language = 'vi';

    a.clock.set(new Date(MONDAY.getTime() + 86_400_000));
    expect((await a.t.call('GET', '/api/ai/today-summary')).json()).toEqual({
      date: '2026-10-20',
      text: null,
    });
    a.runtime.options.notReady = new AiError('AI_BUDGET', 'limit');
    expect((await a.t.call('POST', '/api/ai/today-summary')).json()).toEqual({
      date: '2026-10-20',
      text: null,
    });
    expect(today()).toHaveLength(2);
    a.runtime.options.notReady = null;
    expect((await a.t.call('POST', '/api/ai/today-summary', { force: true })).statusCode).toBe(400);
  });
});

describe('save an answer as a note', () => {
  let a: AiTestApp;
  const save = (body: unknown) => a.t.call('POST', '/api/ai/save-answer', body);
  const read = (p: string) => readFileSync(path.join(a.t.vaultRoot, ...p.split('/')), 'utf8');

  beforeAll(async () => {
    a = await createAiTestApp(47746, { files: FILES });
  });
  afterAll(async () => a?.t.close());

  it('writes front matter, title, quoted question, re-checked links and the AI signature', async () => {
    const body = {
      question: 'Tại sao: phân phối/chuẩn quan trọng?\nDòng hai',
      answer:
        'Vì [[2 Areas/Có thật|Có thật]] nói vậy, xem cả [[Không tồn tại|ghi chú cũ]].\r\nHết.',
      folder: '2 Areas/',
    };
    const res = await save(body);
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json()).toEqual({ path: '2 Areas/Tại sao phân phối chuẩn quan trọng.md' });
    expect(read(res.json().path)).toBe(
      '---\ntype: note\ncreated: 2026-10-19\nsource: ai-chat\n---\n\n# Tại sao phân phối chuẩn quan trọng\n\n' +
        '> Tại sao: phân phối/chuẩn quan trọng?\n> Dòng hai\n\n' +
        'Vì [[2 Areas/Có thật|Có thật]] nói vậy, xem cả ghi chú cũ.\nHết.\n\n*Câu trả lời của AI, 19/10/2026.*\n',
    );
    const again = await save(body);
    expect(again.json()).toEqual({ path: '2 Areas/Tại sao phân phối chuẩn quan trọng 2.md' });
  });

  it('wiki pages get type wiki; names are cut at 60 characters; English signs in English', async () => {
    a.t.settings.ui.language = 'en';
    const long = 'Câu hỏi rất dài '.repeat(10);
    const res = await save({ question: long, answer: 'Trả lời.', folder: 'wiki/hỏi đáp' });
    const name = res.json().path.slice('wiki/hỏi đáp/'.length, -3);
    expect([...name].length).toBeLessThanOrEqual(60);
    const content = read(res.json().path);
    expect(content).toContain('type: wiki');
    expect(content).toContain('*AI answer, 19/10/2026.*');
    a.t.settings.ui.language = 'vi';
    const control = await save({ question: 'index', answer: 'x', folder: 'wiki' });
    expect(control.json().path).toBe('wiki/index 2.md');
    const root = await save({ question: 'Ở gốc', answer: 'x', folder: '' });
    expect(root.json().path).toBe('Ở gốc.md');
  });

  it.each([
    ['Templates', 'VALIDATION'],
    ['3 Resources/papers', 'VALIDATION'],
    ['4 Archive', 'VALIDATION'],
    ['Attachments/2026-10', 'VALIDATION'],
    ['.secondbrain', 'INVALID_PATH'],
    ['.secondbrain/state', 'INVALID_PATH'],
    ['../ngoài', 'INVALID_PATH'],
    ['2 Areas/../../ngoài', 'INVALID_PATH'],
    ['/tmp', 'INVALID_PATH'],
    ['C:\\Users', 'INVALID_PATH'],
  ])('refuses the folder %s (%s)', async (folder, code) => {
    const res = await save({ question: 'Câu hỏi', answer: 'Trả lời', folder });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(code);
  });

  it('refuses a folder whose real place is elsewhere (a folder link to Templates)', async () => {
    const root = a.t.vaultRoot;
    symlinkSync(path.join(root, 'Templates'), path.join(root, 'wiki', 'mẫu'), 'dir');
    const before = readdirSync(path.join(root, 'Templates')).sort();
    for (const folder of ['wiki/mẫu', 'wiki/mẫu/phụ']) {
      const res = await save({ question: 'Câu hỏi qua liên kết', answer: 'Trả lời', folder });
      expect(res.statusCode, res.body).toBe(403);
      expect(res.json().error).toMatchObject({
        code: 'FORBIDDEN',
        details: { reason: 'linked-path' },
      });
    }
    expect(readdirSync(path.join(root, 'Templates')).sort()).toEqual(before);
    const real = await save({
      question: 'Câu hỏi qua liên kết',
      answer: 'Trả lời',
      folder: 'wiki',
    });
    expect(real.json()).toEqual({ path: 'wiki/Câu hỏi qua liên kết.md' });
  });

  it('refuses an answer over 100 kB and unknown fields', async () => {
    const big = await save({ question: 'q', answer: 'ă'.repeat(60_000), folder: '2 Areas' });
    expect(big.json().error).toMatchObject({ code: 'VALIDATION', details: { reason: 'too-long' } });
    const extra = await save({ question: 'q', answer: 'a', folder: '2 Areas', path: 'x.md' });
    expect(extra.json().error).toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'unknown-field' },
    });
  });
});
