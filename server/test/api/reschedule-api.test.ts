import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { makeClock } from '../index/helpers/index-test-vault.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';
import { createVaultTestApp, q, type VaultTestApp } from './vault-test-app.js';

const PORT = 4841;
const P = '1 Projects/Đồ án Giải tích.md';
const BODY = [
  '---',
  'type: project',
  'deadline: 2026-11-02 # hạn nộp',
  'course: "[[Giải tích 1]]"',
  '---',
  '- [ ] Viết báo cáo 📅 2026-10-22',
  '- [x] Đọc đề ✅ 2026-10-19',
  '',
].join('\n');
const seed = (root: string) => {
  mkdirSync(path.join(root, '1 Projects'));
  writeFileSync(path.join(root, ...P.split('/')), BODY);
  writeFileSync(path.join(root, 'Không hạn.md'), '# Không có hạn\n');
};

const changedLines = (a: string, b: string) =>
  a.split('\n').flatMap((line, i) => (line === b.split('\n')[i] ? [] : [i + 1]));

describe('rescheduling with undo (F11.2, F20.2)', () => {
  let t: VaultTestApp;
  const disk = () => readFileSync(path.join(t.vaultRoot, ...P.split('/')), 'utf8');
  const revision = async () => (await t.call('GET', `/api/note?${q(P)}`)).json().revision;
  const reschedule = (body: object) => t.call('POST', '/api/note/reschedule', body);
  const itemsOn = async (date: string) =>
    (await t.call('GET', `/api/calendar?month=${date.slice(0, 7)}`))
      .json()
      .days.find((d: { date: string }) => d.date === date)
      .items.map((i: { id: string }) => i.id);

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, { now: makeClock(new Date(2026, 9, 20, 9)).now, seed });
  });
  afterAll(async () => t?.close());

  it('moves a note deadline (only the value changes) and undo restores the bytes', async () => {
    const res = await reschedule({
      path: P,
      expectedRevision: await revision(),
      target: { kind: 'note' },
      date: '2026-11-09',
    });
    expect(res.statusCode, res.body).toBe(200);
    const { journalId, revision: after } = res.json();
    expect(journalId).toMatch(/^[0-9A-Z]{26}$/);
    expect(res.json()).not.toHaveProperty('lineText');
    expect(disk()).toBe(BODY.replace('2026-11-02 # hạn nộp', '2026-11-09 # hạn nộp'));
    expect(after).toBe(await revision());
    expect(await itemsOn('2026-11-09')).toEqual([`note:${P}`]);
    const undo = await t.call('POST', `/api/journal/${journalId}/undo`);
    expect(undo.statusCode, undo.body).toBe(200);
    expect(disk()).toBe(BODY);
    expect(await itemsOn('2026-11-02')).toEqual([`note:${P}`]);
  });

  it('moves a task date (diff: one token) and undo restores it', async () => {
    const res = await reschedule({
      path: P,
      expectedRevision: await revision(),
      target: { kind: 'task', line: 6, expectedText: '- [ ] Viết báo cáo 📅 2026-10-22' },
      date: '2026-10-24',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(changedLines(BODY, disk())).toEqual([6]);
    expect(disk().split('\n')[5]).toBe('- [ ] Viết báo cáo 📅 2026-10-24');
    expect(await itemsOn('2026-10-24')).toEqual([`task:${P}#6`]);
    await t.call('POST', `/api/journal/${res.json().journalId}/undo`);
    expect(disk()).toBe(BODY);
  });

  it('answers the new line of a task, so a second action on it right away is no conflict', async () => {
    const first = await reschedule({
      path: P,
      expectedRevision: await revision(),
      target: { kind: 'task', line: 6, expectedText: '- [ ] Viết báo cáo 📅 2026-10-22' },
      date: '2026-10-25',
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({
      revision: await revision(),
      journalId: expect.any(String),
      lineText: '- [ ] Viết báo cáo 📅 2026-10-25',
    });
    // The calendar drags the same item again with what the answer said, before any reload.
    const again = await reschedule({
      path: P,
      expectedRevision: first.json().revision,
      target: { kind: 'task', line: 6, expectedText: first.json().lineText },
      date: '2026-10-27',
    });
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().lineText).toBe('- [ ] Viết báo cáo 📅 2026-10-27');
    const tick = await t.call('PATCH', '/api/note/task', {
      path: P,
      expectedRevision: again.json().revision,
      line: 6,
      expectedText: again.json().lineText,
      done: true,
    });
    expect(tick.statusCode, tick.body).toBe(200);
    const same = await reschedule({
      path: P,
      expectedRevision: tick.json().revision,
      target: { kind: 'task', line: 6, expectedText: tick.json().lineText },
      date: '2026-10-27',
    });
    expect(same.json()).toEqual({
      revision: tick.json().revision,
      journalId: null,
      lineText: tick.json().lineText,
    });
    // Put the fixture back for the next tests.
    await t.call('PUT', '/api/note', {
      path: P,
      content: BODY,
      expectedRevision: await revision(),
    });
  });

  it('undo after the note was edited again refuses with the conflict and changes nothing', async () => {
    const res = await reschedule({
      path: P,
      expectedRevision: await revision(),
      target: { kind: 'note' },
      date: '2026-11-15',
    });
    const edited = disk().replace('Đọc đề', 'Đọc kỹ đề');
    const saved = await t.call('PUT', '/api/note', {
      path: P,
      content: edited,
      expectedRevision: res.json().revision,
    });
    expect(saved.statusCode).toBe(200);
    const undo = await t.call('POST', `/api/journal/${res.json().journalId}/undo`);
    expect(undo.statusCode).toBe(409);
    expect(undo.json().error.details).toEqual({
      journalId: res.json().journalId,
      conflicts: [
        { path: P, expectedRevision: res.json().revision, currentRevision: saved.json().revision },
      ],
    });
    expect(disk()).toBe(edited);
    // Put the fixture back for the next tests.
    await t.call('PUT', '/api/note', {
      path: P,
      content: BODY,
      expectedRevision: await revision(),
    });
  });

  it('a stale revision or a changed line is 409, and nothing is written or journaled', async () => {
    const pending = async () => (await t.call('GET', '/api/journal/pending')).json().entries;
    const mtime = statSync(path.join(t.vaultRoot, ...P.split('/'))).mtimeMs;
    const stale = await reschedule({
      path: P,
      expectedRevision: 'b'.repeat(64),
      target: { kind: 'note' },
      date: '2026-11-20',
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.details.reason).toBe('revision');
    const changed = await reschedule({
      path: P,
      expectedRevision: await revision(),
      target: { kind: 'task', line: 6, expectedText: '- [ ] Viết báo cáo 📅 2026-10-21' },
      date: '2026-11-20',
    });
    expect(changed.statusCode).toBe(409);
    expect(changed.json().error.details).toMatchObject({
      reason: 'line-changed',
      currentText: '- [ ] Viết báo cáo 📅 2026-10-22',
    });
    expect(disk()).toBe(BODY);
    expect(statSync(path.join(t.vaultRoot, ...P.split('/'))).mtimeMs).toBe(mtime);
    expect(await pending()).toEqual([]);
  });

  it('the same date writes nothing and returns no journal entry', async () => {
    const res = await reschedule({
      path: P,
      expectedRevision: await revision(),
      target: { kind: 'note' },
      date: '2026-11-02',
    });
    expect(res.json()).toEqual({ revision: await revision(), journalId: null });
  });

  it('refuses a note without a deadline key, an invalid date and an incomplete task target', async () => {
    const plain = (await t.call('GET', `/api/note?${q('Không hạn.md')}`)).json();
    const cases: [object, string][] = [
      [
        { path: 'Không hạn.md', expectedRevision: plain.revision, target: { kind: 'note' } },
        'no-deadline',
      ],
      [{ path: P, expectedRevision: await revision(), target: { kind: 'note' } }, 'invalid-date'],
      [{ path: P, expectedRevision: await revision(), target: { kind: 'task' } }, 'task-target'],
    ];
    for (const [body, reason] of cases) {
      const date = reason === 'invalid-date' ? '2026-13-01' : '2026-12-01';
      const res = await reschedule({ ...body, date });
      expect(res.statusCode, reason).toBe(400);
      expect(res.json().error.details.reason).toBe(reason);
    }
  });
});

describe('a reschedule interrupted by a crash is reported and can be undone (F11.2)', () => {
  const homes: string[] = [];
  afterEach(() => homes.splice(0).forEach(removeDir));

  it('is listed by GET /journal/pending after a restart; undo restores the file', async () => {
    const home = makeTempDir('sb reschedule crash Đồ án');
    homes.push(home);
    const first = await createVaultTestApp(PORT + 1, {
      home,
      seed,
      watcher: false,
      faults: { crashAfterJournalStep: () => true },
    });
    const note = (await first.call('GET', `/api/note?${q(P)}`)).json();
    const res = await first.call('POST', '/api/note/reschedule', {
      path: P,
      expectedRevision: note.revision,
      target: { kind: 'note' },
      date: '2026-11-09',
    });
    expect(res.statusCode).toBe(500);
    await first.close();
    const second = await createVaultTestApp(PORT + 1, { home, watcher: false });
    try {
      const { entries } = (await second.call('GET', '/api/journal/pending')).json();
      expect(entries).toEqual([
        expect.objectContaining({ op: 'reschedule', appliedSteps: 1, totalSteps: 1, paths: [P] }),
      ]);
      const undo = await second.call('POST', `/api/journal/${entries[0].id}/undo`);
      expect(undo.statusCode, undo.body).toBe(200);
      expect(readFileSync(path.join(second.vaultRoot, ...P.split('/')), 'utf8')).toBe(BODY);
      expect((await second.call('GET', '/api/journal/pending')).json().entries).toEqual([]);
    } finally {
      await second.close();
    }
  });
});
