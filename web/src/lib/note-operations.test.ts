import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import vi_ops from '../i18n/locales/operations.vi.json';
import vi_semester from '../i18n/locales/semester.vi.json';
import { useDialogStore, type DialogRequest } from './dialogs/dialog-requests';
import { setAppNavigator } from './app-navigation';
import {
  archiveNote,
  createNote,
  moveFolder,
  moveNote,
  renameNote,
  trashFolder,
  trashNotes,
} from './note-operations';
import { useTabsStore } from './tabs-store';
import { apiError, installFetchMock, type FetchMock } from './testing/fetch-mock';
import { resetAppState } from './testing/reset-app-state';
import { ACTION_TOAST_MS, useToastStore } from './toast-store';

const REV = 'a'.repeat(64);
const lastToast = () => useToastStore.getState().toasts.at(-1);

async function nextDialog(): Promise<DialogRequest> {
  await vi.waitFor(() => expect(useDialogStore.getState().queue.length).toBeGreaterThan(0));
  return useDialogStore.getState().queue[0] as DialogRequest;
}

function answer(request: DialogRequest, value: boolean) {
  useDialogStore.getState().close(request.id);
  if (request.kind === 'confirm') request.resolve(value);
}

describe('note operations: dry run, confirm, undo (F2.2, F4, F20.2)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState('vault-a');
    mock = installFetchMock();
    mock.on('GET /api/note', (call) => ({
      body: { path: call.query.get('path'), revision: REV, content: '' },
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rename: lists affected notes, executes after confirm, offers a 10 s undo through the journal', async () => {
    mock.on('POST /api/note/rename', (call) =>
      (call.body as { dryRun?: boolean }).dryRun
        ? {
            body: {
              dryRun: true,
              path: '1 Projects/Toán/Bài 1 mới.md',
              affected: ['2 Areas/Giải tích 1.md', 'Daily/2026-10-18.md'],
            },
          }
        : {
            body: {
              journalId: '01JOURNAL0000',
              path: '1 Projects/Toán/Bài 1 mới.md',
              revision: REV,
              affected: ['2 Areas/Giải tích 1.md', 'Daily/2026-10-18.md'],
            },
          },
    );
    mock.on('POST /api/journal/01JOURNAL0000/undo', { body: { ok: true } });
    useTabsStore.getState().openNote('1 Projects/Toán/Bài 1.md');

    const pending = renameNote('1 Projects/Toán/Bài 1.md', 'Bài 1 mới');
    const dialog = await nextDialog();
    expect(dialog.kind).toBe('confirm');
    if (dialog.kind !== 'confirm') return;
    expect(dialog.options.items).toEqual(['2 Areas/Giải tích 1', 'Daily/2026-10-18']);
    expect(dialog.options.body).toContain('2');
    expect(mock.callsTo('POST /api/note/rename')).toHaveLength(1);
    answer(dialog, true);
    await expect(pending).resolves.toEqual({ ok: true, path: '1 Projects/Toán/Bài 1 mới.md' });

    const [dry, real] = mock.callsTo('POST /api/note/rename');
    expect(dry?.body).toEqual({
      path: '1 Projects/Toán/Bài 1.md',
      newPath: '1 Projects/Toán/Bài 1 mới.md',
      expectedRevision: REV,
      relink: true,
      dryRun: true,
    });
    expect(real?.body).not.toHaveProperty('dryRun');
    expect(useTabsStore.getState().tabs[0]?.path).toBe('1 Projects/Toán/Bài 1 mới.md');

    const toast = lastToast();
    expect(toast?.durationMs).toBe(ACTION_TOAST_MS);
    expect(toast?.action?.label).toBe(vi_ops.undo);
    await toast?.action?.run();
    expect(mock.callsTo('POST /api/journal/01JOURNAL0000/undo')).toHaveLength(1);
    expect(lastToast()?.message).toBe(vi_ops.undone);
  });

  it('undo refused because files changed since: conflict message, nothing else happens', async () => {
    mock.on('POST /api/note/move', (call) =>
      (call.body as { dryRun?: boolean }).dryRun
        ? { body: { dryRun: true, path: '4 Archive/a.md', affected: [] } }
        : { body: { journalId: '01JOURNAL0001', path: '4 Archive/a.md', affected: [] } },
    );
    mock.on(
      'POST /api/journal/01JOURNAL0001/undo',
      apiError(409, 'CONFLICT', { journalId: '01JOURNAL0001', conflicts: [{}, {}] }),
    );
    // No affected notes: no dialog, the move runs right away.
    await expect(archiveNote('0 Inbox/a.md')).resolves.toMatchObject({ ok: true });
    expect(useDialogStore.getState().queue).toHaveLength(0);
    const callsBefore = mock.calls.length;
    await lastToast()?.action?.run();
    expect(mock.calls.length).toBe(callsBefore + 1);
    expect(lastToast()?.message).toBe('Không hoàn tác được vì 2 ghi chú đã được sửa sau đó.');
  });

  it('cancelling the confirm dialog changes nothing', async () => {
    mock.on('POST /api/note/rename', {
      body: {
        dryRun: true,
        path: 'b.md',
        affected: [],
        unresolvable: [{ path: 'c.md', raw: '[[a]]', line: 3 }],
      },
    });
    const pending = renameNote('a.md', 'b');
    const dialog = await nextDialog();
    if (dialog.kind === 'confirm') expect(dialog.options.items).toEqual(['c, dòng 3: [[a]]']);
    answer(dialog, false);
    await expect(pending).resolves.toEqual({ ok: false, reason: 'cancelled' });
    expect(mock.callsTo('POST /api/note/rename')).toHaveLength(1);
  });

  it('validates names before any request and maps server errors to friendly text', async () => {
    await expect(renameNote('a.md', 'a/b')).resolves.toEqual({ ok: false, reason: 'invalid' });
    expect(lastToast()?.message).toBe(vi_ops.invalid.characters);
    expect(mock.calls).toHaveLength(0);

    mock.on('POST /api/note/rename', apiError(409, 'EXISTS', { path: 'b.md' }));
    await expect(renameNote('a.md', 'b')).resolves.toEqual({ ok: false, reason: 'failed' });
    expect(lastToast()).toMatchObject({ message: vi_ops.errors.exists, tone: 'error' });
  });

  it('(F25.2) renaming or moving the generated "Học kỳ này" page says why it is refused', async () => {
    const refused = apiError(409, 'GENERATED_PAGE', {
      path: 'Học kỳ này.md',
      reason: 'generated-page',
    });
    mock.on('POST /api/note/rename', refused);
    mock.on('POST /api/note/move', refused);
    await expect(renameNote('Học kỳ này.md', 'Kỳ 1')).resolves.toEqual({
      ok: false,
      reason: 'failed',
    });
    expect(lastToast()).toMatchObject({ message: vi_semester.errors.generatedPage, tone: 'error' });
    expect(lastToast()?.message).not.toBe(vi_ops.errors.generic);

    useToastStore.setState({ toasts: [] });
    await expect(moveNote('Học kỳ này.md', '4 Archive')).resolves.toMatchObject({ ok: false });
    expect(lastToast()).toMatchObject({ message: vi_semester.errors.generatedPage, tone: 'error' });
    expect(mock.callsTo('POST /api/note/move').length).toBeGreaterThan(0);
  });

  it('creates "Ghi chú mới" in Inbox with unique: true, opens it with &new=1, undo trashes it', async () => {
    mock.on('POST /api/note', {
      status: 201,
      body: { path: '0 Inbox/Ghi chú mới 2.md', revision: REV },
    });
    mock.on('POST /api/note/trash', apiError(409, 'CONFLICT', { currentRevision: 'b'.repeat(64) }));
    const navigate = vi.fn();
    setAppNavigator(navigate);

    await expect(createNote()).resolves.toEqual({ ok: true, path: '0 Inbox/Ghi chú mới 2.md' });
    expect(mock.callsTo('POST /api/note')[0]?.body).toEqual({
      path: '0 Inbox/Ghi chú mới.md',
      unique: true,
    });
    expect(navigate).toHaveBeenLastCalledWith(
      `/note?path=${encodeURIComponent('0 Inbox/Ghi chú mới 2.md')}&new=1`,
      undefined,
    );
    expect(lastToast()?.message).toBe('Đã tạo ghi chú “Ghi chú mới 2”.');
    // The user already typed in it: the revision changed, so undo is refused.
    await lastToast()?.action?.run();
    expect(mock.callsTo('POST /api/note/trash')[0]?.body).toEqual({
      paths: ['0 Inbox/Ghi chú mới 2.md'],
      expectedRevisions: [REV],
    });
    expect(lastToast()?.message).toBe(
      'Không hoàn tác được vì ghi chú “Ghi chú mới 2” đã được sửa sau đó.',
    );
  });

  it('trashes notes at their current revision and closes their tabs without a second toast', async () => {
    mock.on('POST /api/note/trash', { body: { journalId: '01JOURNAL0002', trashId: 't' } });
    useTabsStore.getState().openNote('0 Inbox/a.md');
    await expect(trashNotes(['0 Inbox/a.md'])).resolves.toMatchObject({ ok: true });
    expect(mock.callsTo('POST /api/note/trash')[0]?.body).toEqual({
      paths: ['0 Inbox/a.md'],
      expectedRevisions: [REV],
    });
    expect(useTabsStore.getState().tabs).toEqual([]);
    expect(useToastStore.getState().toasts.map((t) => t.message)).toEqual([
      'Đã chuyển “a” vào thùng rác.',
    ]);
  });

  it('refuses to move a folder into itself and asks before trashing a folder with notes', async () => {
    await expect(moveFolder('2 Areas/Môn', '2 Areas/Môn/Con')).resolves.toMatchObject({
      ok: false,
    });
    expect(lastToast()?.message).toBe(vi_ops.errors.moveIntoItself);

    mock.on('POST /api/folder/trash', { body: { journalId: '01JOURNAL0003', trashId: 't' } });
    const pending = trashFolder('2 Areas/Môn', { noteCount: 4 });
    const dialog = await nextDialog();
    expect(dialog.kind === 'confirm' && dialog.options.danger).toBe(true);
    answer(dialog, true);
    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(mock.callsTo('POST /api/folder/trash')[0]?.body).toEqual({ path: '2 Areas/Môn' });

    await expect(trashFolder('0 Inbox')).resolves.toMatchObject({ ok: false });
    expect(lastToast()?.message).toBe(vi_ops.errors.forbidden);
  });
});
