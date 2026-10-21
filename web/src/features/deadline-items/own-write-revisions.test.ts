import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DeadlineItem,
  PatchTaskRequest,
  RescheduleRequest,
} from '../../lib/api/deadlines-types';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { rescheduleItem, tickTask } from './deadline-actions';

const NOTE = '1 Projects/Đồ án Giải tích.md';
const LINES = ['- [ ] Nộp bản nháp 📅 2026-10-21', '- [ ] Đọc chương 3', '- [ ] Ôn tập'];

/**
 * One note on a server like the real one: the revision is a hash of the content (the same text
 * always has the same revision), writes need the current revision and the line as the view saw
 * it, every change is announced (`note:changed`) before the HTTP answer, unless `silent`.
 */
function contentServer(mock: FetchMock) {
  let lines = [...LINES];
  let silent = false;
  const journal = new Map<string, string[]>();
  const revision = () => `h:${lines.join('\n')}`;
  const changed = () => {
    if (!silent) emitServerEvent({ type: 'note:changed', path: NOTE, revision: revision() });
  };
  const refuse = () => apiError(409, 'CONFLICT', { reason: 'revision' });
  mock.on('PATCH /api/note/task', (call) => {
    const body = call.body as PatchTaskRequest;
    if (body.expectedRevision !== revision() || lines[body.line - 1] !== body.expectedText) {
      return refuse();
    }
    lines[body.line - 1] = body.done
      ? body.expectedText.replace('[ ]', '[x]')
      : body.expectedText.replace('[x]', '[ ]');
    changed();
    return { body: { revision: revision(), lineText: lines[body.line - 1] } };
  });
  mock.on('POST /api/note/reschedule', (call) => {
    const body = call.body as RescheduleRequest;
    if (body.target.kind !== 'task') throw new Error('task targets only');
    const { line, expectedText } = body.target;
    if (body.expectedRevision !== revision() || lines[line - 1] !== expectedText) return refuse();
    journal.set(`J${journal.size + 1}`, [...lines]);
    lines[line - 1] = expectedText.replace(/📅 \S+/, `📅 ${body.date}`);
    changed();
    return {
      body: { revision: revision(), journalId: `J${journal.size}`, lineText: lines[line - 1] },
    };
  });
  mock.on('POST /api/journal/J1/undo', () => {
    lines = journal.get('J1') ?? lines;
    changed();
    return { body: { ok: true } };
  });
  return {
    revision,
    /** The view as a reload would show line `n` (1-based). */
    task: (n: number) => ({
      path: NOTE,
      line: n,
      lineText: lines[n - 1]!,
      revision: revision(),
      title: `line ${n}`,
    }),
    /** An edit made elsewhere (the editor, another program). */
    edit: (n: number, text: string) => {
      lines[n - 1] = text;
      act(() => changed());
    },
    setSilent: (value: boolean) => (silent = value),
  };
}

function itemFor(task: ReturnType<ReturnType<typeof contentServer>['task']>): DeadlineItem {
  return {
    id: `task:${NOTE}#${task.line}`,
    kind: 'task',
    title: task.title,
    date: '2026-10-21',
    path: NOTE,
    noteTitle: 'Đồ án Giải tích',
    line: task.line,
    lineText: task.lineText,
    done: false,
    urgency: 'urgent',
    daysLeft: 1,
    class: 'user',
    revision: task.revision,
  };
}

const errors = () => useToastStore.getState().toasts.filter((toast) => toast.tone === 'error');
const sentRevisions = (mock: FetchMock) =>
  mock.calls
    .filter((call) => call.method !== 'GET' && !call.path.includes('/journal/'))
    .map((call) => (call.body as { expectedRevision: string }).expectedRevision);

describe('own write revisions on a content-hash server (F9.1)', () => {
  let mock: FetchMock;
  let server: ReturnType<typeof contentServer>;
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
    server = contentServer(mock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('our own change event, even before the answer, keeps the carry-over', async () => {
    const r0 = server.revision();
    const first = server.task(1);
    const second = server.task(2);
    await expect(tickTask(first, true)).resolves.toBe('done');
    const r1 = server.revision();
    await expect(tickTask(second, true)).resolves.toBe('done');
    expect(sentRevisions(mock)).toEqual([r0, r1]);
    expect(errors()).toEqual([]);
  });

  it('after "Hoàn tác" the note is back at its old revision: the reloaded view writes again', async () => {
    const r0 = server.revision();
    const view = [1, 2, 3].map((n) => server.task(n));
    await expect(rescheduleItem(itemFor(view[0]!), '2026-10-25')).resolves.toBe('done');
    await act(() => useToastStore.getState().toasts[0]!.action!.run());
    expect(server.revision()).toBe(r0);

    // The reloaded view holds r0 again; its writes go through one after the other.
    const reloaded = [1, 2, 3].map((n) => server.task(n));
    await expect(tickTask(reloaded[1]!, true)).resolves.toBe('done');
    const r1 = server.revision();
    await expect(tickTask(reloaded[2]!, true)).resolves.toBe('done');
    await expect(tickTask(reloaded[0]!, true)).resolves.toBe('done');
    expect(sentRevisions(mock)).toEqual([r0, r0, r1, expect.any(String)]);
    expect(errors()).toEqual([]);
  });

  it('an edit elsewhere back to an old revision ends the carry-over', async () => {
    const r0 = server.revision();
    await tickTask(server.task(1), true);
    // Unticked in the editor: the content, so the revision, is r0 again.
    server.edit(1, LINES[0]!);
    expect(server.revision()).toBe(r0);
    await expect(tickTask(server.task(2), true)).resolves.toBe('done');
    expect(sentRevisions(mock)).toEqual([r0, r0]);
    expect(errors()).toEqual([]);
  });

  it('an edit elsewhere to new content: the fresh revision goes as is, the stale view is refused', async () => {
    const stale = server.task(2);
    await tickTask(server.task(1), true);
    server.edit(3, '- [ ] Ôn tập kỹ');
    const fresh = server.revision();
    await expect(tickTask(stale, true)).resolves.toBe('conflict');
    await expect(tickTask(server.task(2), true)).resolves.toBe('done');
    expect(sentRevisions(mock).slice(1)).toEqual([stale.revision, fresh]);
  });

  it('a refused write ends the carry-over, even when no event told us why', async () => {
    server.setSilent(true); // the socket is down
    const r0 = server.revision();
    const view = [1, 2, 3].map((n) => server.task(n));
    await tickTask(view[0]!, true);
    server.edit(3, '- [ ] Ôn tập kỹ');
    await expect(tickTask(view[1]!, true)).resolves.toBe('conflict');
    // Changed back elsewhere: the reloaded view is at r0 again and goes through.
    server.edit(1, LINES[0]!);
    server.edit(3, LINES[2]!);
    await expect(tickTask(server.task(2), true)).resolves.toBe('done');
    expect(sentRevisions(mock).at(-1)).toBe(r0);
  });

  it('a moved task keeps the line text the server wrote for the next tick', async () => {
    const view = server.task(1);
    await expect(rescheduleItem(itemFor(view), '2026-10-25')).resolves.toBe('done');
    await expect(tickTask(view, true)).resolves.toBe('done');
    expect(mock.callsTo('PATCH /api/note/task')[0]?.body).toMatchObject({
      expectedText: '- [ ] Nộp bản nháp 📅 2026-10-25',
    });
    expect(errors()).toEqual([]);
  });
});
