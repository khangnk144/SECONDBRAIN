import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import vi_ops from '../i18n/locales/operations.vi.json';
import { useDialogStore, type DialogRequest } from './dialogs/dialog-requests';
import { createFolder, renameFolder } from './folder-operations';
import { promptMoveNote, promptNewFolder } from './operation-prompts';
import { installFetchMock, type FetchMock } from './testing/fetch-mock';
import { resetAppState } from './testing/reset-app-state';
import { makeTree } from './testing/tree-fixture';
import { useToastStore } from './toast-store';
import { useTreeStore } from './tree-store';

const lastToast = () => useToastStore.getState().toasts.at(-1);

async function nextDialog(): Promise<DialogRequest> {
  await vi.waitFor(() => expect(useDialogStore.getState().queue.length).toBeGreaterThan(0));
  return useDialogStore.getState().queue[0] as DialogRequest;
}

describe('folder operations (F2.2)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState('vault-a');
    mock = installFetchMock();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a folder, expands its parent and offers undo while it is still empty', async () => {
    mock.on('POST /api/folder', { status: 201, body: { path: '2 Areas/Xác suất' } });
    mock.on('GET /api/tree', {
      body: makeTree({ folders: ['2 Areas', '2 Areas/Xác suất'], notes: [] }),
    });
    mock.on('POST /api/folder/trash', { body: { journalId: '01JOURNAL0020', trashId: 't' } });
    await expect(createFolder('2 Areas', '  Xác suất ')).resolves.toEqual({
      ok: true,
      path: '2 Areas/Xác suất',
    });
    expect(mock.callsTo('POST /api/folder')[0]?.body).toEqual({ path: '2 Areas/Xác suất' });
    expect(useTreeStore.getState().expanded).toContain('2 Areas');
    expect(lastToast()?.action?.label).toBe(vi_ops.undo);
    await lastToast()?.action?.run();
    expect(mock.callsTo('POST /api/folder/trash')[0]?.body).toEqual({ path: '2 Areas/Xác suất' });
    expect(lastToast()?.message).toBe(vi_ops.undone);
  });

  it('refuses to undo the creation once something was put in the folder', async () => {
    mock.on('POST /api/folder', { status: 201, body: { path: 'Môn' } });
    await createFolder('', 'Môn');
    mock.on('GET /api/tree', { body: makeTree({ folders: ['Môn'], notes: ['Môn/Bài 1.md'] }) });
    await lastToast()?.action?.run();
    expect(mock.callsTo('POST /api/folder/trash')).toHaveLength(0);
    expect(lastToast()?.message).toBe(vi_ops.undoFolderNotEmpty);
  });

  it('renames a folder after the dry run and keeps its expanded state', async () => {
    useTreeStore.setState({ expanded: ['2 Areas/Cũ'] });
    mock.on('POST /api/folder/rename', (call) =>
      (call.body as { dryRun?: boolean }).dryRun
        ? { body: { dryRun: true, path: '2 Areas/Mới', affected: [] } }
        : { body: { journalId: '01JOURNAL0021', path: '2 Areas/Mới', affected: [] } },
    );
    await expect(renameFolder('2 Areas/Cũ', 'Mới')).resolves.toMatchObject({ ok: true });
    expect(useTreeStore.getState().expanded).toEqual(['2 Areas/Mới']);
    expect(lastToast()?.message).toBe('Đã đổi tên thư mục thành “Mới”.');
  });

  it('"Thư mục mới" validates the name in the dialog; "Di chuyển tới…" moves to the chosen folder', async () => {
    mock.on('POST /api/folder', { status: 201, body: { path: '2 Areas/Đại số' } });
    const created = promptNewFolder('2 Areas');
    const prompt = await nextDialog();
    if (prompt.kind !== 'prompt') throw new Error('expected a prompt');
    expect(prompt.options.validate?.('CON')).toBe(vi_ops.invalid.reserved);
    expect(prompt.options.validate?.('Đại số')).toBeNull();
    useDialogStore.getState().close(prompt.id);
    prompt.resolve('Đại số');
    await expect(created).resolves.toMatchObject({ ok: true });

    mock.on('GET /api/note', { body: { revision: 'r'.repeat(64) } });
    mock.on('POST /api/note/move', (call) =>
      (call.body as { dryRun?: boolean }).dryRun
        ? { body: { dryRun: true, path: '2 Areas/Đại số/a.md', affected: [] } }
        : { body: { journalId: '01JOURNAL0022', path: '2 Areas/Đại số/a.md', affected: [] } },
    );
    const moved = promptMoveNote('0 Inbox/a.md');
    const picker = await nextDialog();
    if (picker.kind !== 'pick-folder') throw new Error('expected a folder picker');
    expect(picker.options.isDisabled?.('0 Inbox')).toBe(true);
    useDialogStore.getState().close(picker.id);
    picker.resolve('2 Areas/Đại số');
    await expect(moved).resolves.toEqual({ ok: true, path: '2 Areas/Đại số/a.md' });
  });
});
