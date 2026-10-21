import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeadlineItem } from '../../lib/api/deadlines-types';
import type { Navigator } from '../../lib/app-navigation';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { ACTION_TOAST_MS, useToastStore } from '../../lib/toast-store';
import { openItemNote, rescheduleItem, setNoteDone, tickTask } from './deadline-actions';

const NOTE = '1 Projects/Đồ án Giải tích.md';

function taskItem(overrides: Partial<DeadlineItem> = {}): DeadlineItem {
  return {
    id: `task:${NOTE}#9`,
    kind: 'task',
    title: 'Nộp bản nháp',
    date: '2026-10-21',
    path: NOTE,
    noteTitle: 'Đồ án Giải tích',
    line: 9,
    lineText: '- [ ] Nộp bản nháp 📅 2026-10-21',
    done: false,
    urgency: 'urgent',
    daysLeft: 2,
    class: 'user',
    revision: 'r1',
    ...overrides,
  };
}

const toasts = () => useToastStore.getState().toasts;

describe('deadline actions (F9.1, F11.2)', () => {
  let mock: FetchMock;
  let navigate: ReturnType<typeof vi.fn<Navigator>>;
  beforeEach(async () => {
    navigate = (await resetAppState()) as ReturnType<typeof vi.fn<Navigator>>;
    mock = installFetchMock();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ticks one task line at the revision the view loaded', async () => {
    mock.on('PATCH /api/note/task', {
      body: { revision: 'r2', lineText: '- [x] Nộp ✅ 2026-10-20' },
    });
    const target = { path: NOTE, line: 9, lineText: '- [ ] Nộp', revision: 'r1', title: 'Nộp' };
    await expect(tickTask(target, true)).resolves.toBe('done');
    expect(mock.calls.map((c) => c.body)).toEqual([
      { path: NOTE, expectedRevision: 'r1', line: 9, expectedText: '- [ ] Nộp', done: true },
    ]);
    expect(toasts()).toEqual([]);
  });

  it('unticking a row the view has not reloaded yet sends what the tick wrote', async () => {
    let revision = 1;
    mock.on('PATCH /api/note/task', (call) => {
      const { done } = call.body as { done: boolean };
      revision += 1;
      return {
        body: {
          revision: `r${revision}`,
          lineText: done ? '- [x] Nộp ✅ 2026-10-20' : '- [ ] Nộp',
        },
      };
    });
    const target = { path: NOTE, line: 9, lineText: '- [ ] Nộp', revision: 'r1', title: 'Nộp' };
    await expect(tickTask(target, true)).resolves.toBe('done');
    await expect(tickTask(target, false)).resolves.toBe('done');
    expect(mock.calls.map((c) => c.body)).toEqual([
      { path: NOTE, expectedRevision: 'r1', line: 9, expectedText: '- [ ] Nộp', done: true },
      {
        path: NOTE,
        expectedRevision: 'r2',
        line: 9,
        expectedText: '- [x] Nộp ✅ 2026-10-20',
        done: false,
      },
    ]);
    expect(toasts()).toEqual([]);
  });

  it('two ticks in one note before the view reloads both succeed, one request each', async () => {
    // The server refuses any revision but the current one, like the real revision check.
    let current = 1;
    mock.on('PATCH /api/note/task', (call) => {
      const body = call.body as { expectedRevision: string; expectedText: string };
      if (body.expectedRevision !== `r${current}`) {
        return apiError(409, 'CONFLICT', { reason: 'revision', currentRevision: `r${current}` });
      }
      current += 1;
      return {
        body: { revision: `r${current}`, lineText: body.expectedText.replace('[ ]', '[x]') },
      };
    });
    const first = { path: NOTE, line: 9, lineText: '- [ ] Nộp', revision: 'r1', title: 'Nộp' };
    const second = { path: NOTE, line: 12, lineText: '- [ ] Đọc', revision: 'r1', title: 'Đọc' };
    const third = { path: NOTE, line: 14, lineText: '- [ ] Ôn', revision: 'r1', title: 'Ôn' };
    await expect(tickTask(first, true)).resolves.toBe('done');
    await expect(tickTask(second, true)).resolves.toBe('done');
    // The last two are clicked at once: the second waits for the first one's answer.
    const fourth = { path: NOTE, line: 16, lineText: '- [ ] Viết', revision: 'r1', title: 'Viết' };
    await expect(Promise.all([tickTask(third, true), tickTask(fourth, true)])).resolves.toEqual([
      'done',
      'done',
    ]);
    expect(
      mock.calls.map((c) => (c.body as { expectedRevision: string }).expectedRevision),
    ).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(mock.calls.map((c) => (c.body as { expectedText: string }).expectedText)).toEqual([
      '- [ ] Nộp',
      '- [ ] Đọc',
      '- [ ] Ôn',
      '- [ ] Viết',
    ]);
    expect(toasts()).toEqual([]);
  });

  it('a revision our writes did not produce is sent as is, so an outside edit still conflicts', async () => {
    mock.on('PATCH /api/note/task', { body: { revision: 'r2', lineText: '- [x] Nộp' } });
    const target = { path: NOTE, line: 9, lineText: '- [ ] Nộp', revision: 'r1', title: 'Nộp' };
    await tickTask(target, true);
    // A fresh view (the editor saved meanwhile) and another note keep their own revisions.
    await tickTask({ ...target, line: 11, lineText: '- [ ] Đọc', revision: 'r7' }, true);
    await tickTask({ ...target, path: '2 Areas/Giải tích 1.md', revision: 'r1' }, true);
    expect(
      mock.calls.map((c) => (c.body as { expectedRevision: string }).expectedRevision),
    ).toEqual(['r1', 'r7', 'r1']);
  });

  it('after a front-matter write a task line keeps the revision its view saw', async () => {
    mock.on('PATCH /api/note/frontmatter', { body: { revision: 'r2', content: '' } });
    mock.on('PATCH /api/note/task', apiError(409, 'CONFLICT', { reason: 'revision' }));
    await setNoteDone({ path: NOTE, revision: 'r1', title: 'Đồ án Giải tích' }, true);
    const target = { path: NOTE, line: 9, lineText: '- [ ] Nộp', revision: 'r1', title: 'Nộp' };
    // Adding `status:` may have moved every line, so the line number is not carried over.
    await expect(tickTask(target, true)).resolves.toBe('conflict');
    expect(mock.callsTo('PATCH /api/note/task')[0]?.body).toMatchObject({ expectedRevision: 'r1' });
  });

  it('a stale tick names the note, reloads the list and reports a conflict', async () => {
    mock.on(
      'PATCH /api/note/task',
      apiError(409, 'CONFLICT', { reason: 'line-changed', currentRevision: 'r9' }),
    );
    const refresh = vi.fn();
    const target = { path: NOTE, line: 9, lineText: '- [ ] Nộp', revision: 'r1', title: 'Nộp' };
    await expect(tickTask(target, true, { refresh })).resolves.toBe('conflict');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toasts()[0]).toMatchObject({
      message: '“Đồ án Giải tích” vừa thay đổi. Mình đã tải lại danh sách, bạn tick lại nhé.',
      tone: 'error',
    });
  });

  it('other failures show the friendly error and report failed', async () => {
    mock.on('PATCH /api/note/task', apiError(500, 'WRITE_FAILED'));
    const target = { path: NOTE, line: 9, lineText: '- [ ] Nộp', revision: 'r1', title: 'Nộp' };
    await expect(tickTask(target, true)).resolves.toBe('failed');
    expect(toasts()[0]?.message).toMatch(/Không ghi được file/);
  });

  it('marks a note done (status: done) and open again (status: doing)', async () => {
    let revision = 1;
    mock.on('PATCH /api/note/frontmatter', () => ({
      body: { revision: `r${(revision += 1)}`, content: '' },
    }));
    const target = { path: NOTE, revision: 'r1', title: 'Đồ án Giải tích' };
    await expect(setNoteDone(target, true)).resolves.toBe('done');
    // Still before the reload: the revision of the first write is sent.
    await expect(setNoteDone(target, false)).resolves.toBe('done');
    expect(mock.calls.map((c) => c.body)).toEqual([
      { path: NOTE, expectedRevision: 'r1', set: { status: 'done' } },
      { path: NOTE, expectedRevision: 'r2', set: { status: 'doing' } },
    ]);
  });

  it('reschedules with a 10 s undo toast whose undo goes through the journal', async () => {
    mock.on('POST /api/note/reschedule', { body: { revision: 'r2', journalId: 'J1' } });
    mock.on('POST /api/journal/J1/undo', { body: { ok: true } });
    await expect(rescheduleItem(taskItem(), '2026-10-25')).resolves.toBe('done');
    expect(mock.callsTo('POST /api/note/reschedule')[0]?.body).toEqual({
      path: NOTE,
      expectedRevision: 'r1',
      target: { kind: 'task', line: 9, expectedText: '- [ ] Nộp bản nháp 📅 2026-10-21' },
      date: '2026-10-25',
    });
    const toast = toasts()[0];
    expect(toast).toMatchObject({
      message: 'Đã dời “Nộp bản nháp” sang 25/10/2026.',
      durationMs: ACTION_TOAST_MS,
    });
    await toast?.action?.run();
    expect(mock.callsTo('POST /api/journal/J1/undo')).toHaveLength(1);
    expect(toasts().at(-1)?.message).toBe('Đã hoàn tác.');
  });

  it('an undo after the note was edited again names the note and changes nothing', async () => {
    mock.on('POST /api/note/reschedule', { body: { revision: 'r2', journalId: 'J2' } });
    mock.on(
      'POST /api/journal/J2/undo',
      apiError(409, 'CONFLICT', { conflicts: [{ path: NOTE }] }),
    );
    const item = taskItem({ kind: 'note', line: null, lineText: null, title: 'Đồ án Giải tích' });
    await rescheduleItem(item, '2026-11-05');
    expect(mock.callsTo('POST /api/note/reschedule')[0]?.body).toMatchObject({
      target: { kind: 'note' },
    });
    await toasts()[0]?.action?.run();
    expect(toasts().at(-1)).toMatchObject({
      message: 'Không hoàn tác được vì ghi chú “Đồ án Giải tích” đã được sửa sau đó.',
      tone: 'error',
    });
  });

  it('a reschedule then a tick in the same note: the tick carries the new revision', async () => {
    mock.on('POST /api/note/reschedule', { body: { revision: 'r2', journalId: 'J3' } });
    mock.on('PATCH /api/note/task', { body: { revision: 'r3', lineText: '- [x] Đọc' } });
    await expect(rescheduleItem(taskItem(), '2026-10-25')).resolves.toBe('done');
    const other = { path: NOTE, line: 12, lineText: '- [ ] Đọc', revision: 'r1', title: 'Đọc' };
    await expect(tickTask(other, true)).resolves.toBe('done');
    expect(mock.callsTo('PATCH /api/note/task')[0]?.body).toMatchObject({
      expectedRevision: 'r2',
      expectedText: '- [ ] Đọc',
    });
    // The moved line itself: its new text is unknown, so the view's text goes and is refused.
    mock.on('PATCH /api/note/task', apiError(409, 'CONFLICT', { reason: 'line-changed' }));
    const moved = {
      path: NOTE,
      line: 9,
      lineText: taskItem().lineText!,
      revision: 'r1',
      title: 'x',
    };
    await expect(tickTask(moved, true)).resolves.toBe('conflict');
    expect(mock.callsTo('PATCH /api/note/task')[1]?.body).toMatchObject({
      expectedRevision: 'r3',
      expectedText: '- [ ] Nộp bản nháp 📅 2026-10-21',
    });
  });

  it('no undo toast when nothing changed, and no request for the same date', async () => {
    mock.on('POST /api/note/reschedule', { body: { revision: 'r1', journalId: null } });
    await expect(rescheduleItem(taskItem(), '2026-10-22')).resolves.toBe('done');
    await expect(rescheduleItem(taskItem(), '2026-10-21')).resolves.toBe('done');
    expect(mock.callsTo('POST /api/note/reschedule')).toHaveLength(1);
    expect(toasts()).toEqual([]);
  });

  it('a stale reschedule is a conflict that names the note', async () => {
    mock.on('POST /api/note/reschedule', apiError(409, 'CONFLICT', { currentRevision: 'r5' }));
    const refresh = vi.fn();
    await expect(rescheduleItem(taskItem(), '2026-10-30', { refresh })).resolves.toBe('conflict');
    expect(refresh).toHaveBeenCalled();
    expect(toasts()[0]?.message).toBe(
      '“Đồ án Giải tích” vừa thay đổi. Mình đã tải lại danh sách, bạn thử lại nhé.',
    );
  });

  it('opens a task at its line and a note deadline at the top, in a new tab when asked', () => {
    openItemNote({ path: NOTE, line: 9 });
    expect(navigate).toHaveBeenLastCalledWith(`/note?path=${encodeURIComponent(NOTE)}&line=9`, {
      replace: true,
    });
    openItemNote({ path: '2 Areas/Giải tích 1.md', line: null }, { newTab: true });
    expect(navigate).toHaveBeenLastCalledWith(
      `/note?path=${encodeURIComponent('2 Areas/Giải tích 1.md')}`,
      undefined,
    );
  });
});
