import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeClock } from '../index/helpers/index-test-vault.js';
import { createVaultTestApp, q, type VaultTestApp } from './vault-test-app.js';

const PORT = 4840;
const P = '1 Projects/Đồ án Giải tích.md';
const BODY = [
  '---',
  'type: project',
  'status: doing',
  '---',
  '- [ ] Nộp bài 📅 2026-10-19',
  '- [ ] Viết báo cáo 📅 2026-10-20',
  '- [ ] Ôn tập',
  '- [ ] Ôn tập',
  'Đoạn *cuối* _giữ nguyên_  ',
  '',
].join('\r\n');

interface TaskItem {
  title: string;
  path: string;
  line: number;
  lineText: string;
  revision: string;
}

describe('ticking and dating tasks from a view (F9.1, F9.2, F10.4)', () => {
  let t: VaultTestApp;
  const clock = makeClock(new Date(2026, 9, 20, 9, 0));
  const disk = () => readFileSync(path.join(t.vaultRoot, ...P.split('/')), 'utf8');
  const today = async () => (await t.call('GET', '/api/today')).json();
  const patch = (body: object) => t.call('PATCH', '/api/note/task', body);
  const task = (item: TaskItem) => ({
    path: item.path,
    expectedRevision: item.revision,
    line: item.line,
    expectedText: item.lineText,
  });

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      now: clock.now,
      seed: (root) => {
        mkdirSync(path.join(root, '1 Projects'));
        writeFileSync(path.join(root, ...P.split('/')), BODY);
      },
    });
  });
  afterAll(async () => t?.close());

  it('ticks the task Today showed, changes only that line, and Today reflects it at once', async () => {
    const view = await today();
    // "Nộp bài" is overdue: it counts as overdue, not as one of today's tasks.
    expect(view.summary).toMatchObject({ overdue: 1, openToday: 1 });
    const item = view.todayTasks.find((i: TaskItem) => i.title === 'Viết báo cáo') as TaskItem;
    const res = await patch({ ...task(item), done: true });
    expect(res.statusCode, res.body).toBe(200);
    const lineText = '- [x] Viết báo cáo 📅 2026-10-20 ✅ 2026-10-20';
    expect(res.json()).toEqual({ revision: expect.stringMatching(/^[0-9a-f]{64}$/), lineText });
    expect(disk()).toBe(BODY.replace('- [ ] Viết báo cáo 📅 2026-10-20', lineText));
    const after = await today();
    expect(after.summary).toMatchObject({ overdue: 1, openToday: 0 });
    expect(after.todayTasks.map((i: TaskItem) => i.title)).toEqual(['Nộp bài']);
    expect(after.projects[0]).toMatchObject({ progress: { done: 1, total: 4 } });
    expect(after.projects[0].revision).toBe(res.json().revision);
  });

  it('a stale revision is 409 "revision" and a changed line is 409 "line-changed"; nothing is written', async () => {
    const view = await today();
    const item = view.todayTasks[0] as TaskItem;
    const before = disk();
    const stale = await patch({ ...task(item), expectedRevision: 'a'.repeat(64), done: true });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'revision', path: P, currentRevision: item.revision },
    });
    const moved = await patch({ ...task(item), line: item.line + 1, done: true });
    expect(moved.statusCode).toBe(409);
    expect(moved.json().error.details).toEqual({
      path: P,
      reason: 'line-changed',
      line: item.line + 1,
      currentText: '- [x] Viết báo cáo 📅 2026-10-20 ✅ 2026-10-20',
      currentRevision: item.revision,
    });
    expect(disk()).toBe(before);
  });

  it('two tasks with identical text tick independently', async () => {
    const { noDate } = (await t.call('GET', '/api/tasks')).json();
    const twins = noDate.filter((i: TaskItem) => i.title === 'Ôn tập') as TaskItem[];
    expect(twins.map((i) => i.line)).toEqual([7, 8]);
    const res = await patch({ ...task(twins[1]!), done: true });
    expect(res.statusCode).toBe(200);
    const lines = disk().split('\r\n');
    expect(lines.slice(6, 8)).toEqual(['- [ ] Ôn tập', '- [x] Ôn tập ✅ 2026-10-20']);
    const left = (await t.call('GET', '/api/tasks')).json().noDate as TaskItem[];
    expect(left.filter((i) => i.title === 'Ôn tập').map((i) => i.line)).toEqual([7]);
  });

  it('sets, moves and removes a due date; the calendar follows', async () => {
    const note = (await t.call('GET', `/api/note?${q(P)}`)).json();
    const base = {
      path: P,
      expectedRevision: note.revision,
      line: 7,
      expectedText: '- [ ] Ôn tập',
    };
    const set = await patch({ ...base, due: '2026-10-28' });
    expect(set.json().lineText).toBe('- [ ] Ôn tập 📅 2026-10-28');
    const day = async (date: string) =>
      (await t.call('GET', '/api/calendar?month=2026-10'))
        .json()
        .days.find((d: { date: string }) => d.date === date).items as TaskItem[];
    expect((await day('2026-10-28')).map((i) => i.title)).toEqual(['Ôn tập']);
    const cleared = await patch({
      ...base,
      expectedRevision: set.json().revision,
      expectedText: set.json().lineText,
      due: null,
    });
    expect(cleared.json().lineText).toBe('- [ ] Ôn tập');
    expect(await day('2026-10-28')).toEqual([]);
    expect(disk().split('\r\n')[6]).toBe('- [ ] Ôn tập');
  });

  it('keeps a hard line break the editor wrote, and refuses a tick that would change the rendering', async () => {
    const create = (name: string, content: string) =>
      t.call('POST', '/api/note', { path: `1 Projects/${name}.md`, content });
    const broken = '- [ ] Nộp bài\\\n  <u>quan trọng</u> nhé\n';
    const made = await create('Ngắt dòng', broken);
    expect(made.statusCode, made.body).toBe(201);
    const res = await patch({
      path: '1 Projects/Ngắt dòng.md',
      expectedRevision: made.json().revision,
      line: 1,
      expectedText: '- [ ] Nộp bài\\',
      done: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().lineText).toBe('- [x] Nộp bài ✅ 2026-10-20\\');
    const file = path.join(t.vaultRoot, '1 Projects', 'Ngắt dòng.md');
    expect(readFileSync(file, 'utf8')).toBe(
      broken.replace('[ ] Nộp bài', '[x] Nộp bài ✅ 2026-10-20'),
    );

    const label = '- [ ] xem [đề\n  cương] nhé\n\n[đề cương]: https://example.com\n';
    const other = await create('Nhãn', label);
    const refused = await patch({
      path: '1 Projects/Nhãn.md',
      expectedRevision: other.json().revision,
      line: 1,
      expectedText: '- [ ] xem [đề',
      done: true,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.details).toMatchObject({ reason: 'patch-verify' });
    expect(readFileSync(path.join(t.vaultRoot, '1 Projects', 'Nhãn.md'), 'utf8')).toBe(label);
  });

  it('refuses requests that are not a single task edit', async () => {
    const note = (await t.call('GET', `/api/note?${q(P)}`)).json();
    const base = { path: P, expectedRevision: note.revision };
    const cases: [object, string][] = [
      [{ line: 9, expectedText: 'Đoạn *cuối* _giữ nguyên_  ', done: true }, 'not-a-task'],
      [{ line: 7, expectedText: '- [ ] Ôn tập', due: '2026-02-30' }, 'invalid-date'],
      [{ line: 7, expectedText: '- [ ] Ôn tập', done: true, due: null }, 'done-or-due'],
      [{ line: 7, expectedText: '- [ ] Ôn tập' }, 'done-or-due'],
    ];
    for (const [body, reason] of cases) {
      const res = await patch({ ...base, ...body });
      expect(res.statusCode, reason).toBe(400);
      expect(res.json().error).toMatchObject({ code: 'VALIDATION', details: { reason } });
    }
    const bad = await patch({
      ...base,
      path: '0 Inbox/a.txt',
      line: 1,
      expectedText: 'x',
      done: true,
    });
    expect(bad.statusCode).toBe(400);
    expect((await t.call('GET', `/api/note?${q(P)}`)).json().revision).toBe(note.revision);
  });
});
