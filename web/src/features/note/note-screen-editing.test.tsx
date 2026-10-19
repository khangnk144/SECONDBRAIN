import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noteRoute, type Navigator } from '../../lib/app-navigation';
import { installShortcutListener } from '../../lib/shortcuts/shortcut-registry';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { closeDraftDatabase } from '../drafts/draft-database';
import { resetNoteSessions } from '../note-session/session-registry';
import {
  freshDraftDatabase,
  installFakeNoteServer,
  useSessionFakeTimers,
  type FakeNoteServer,
} from '../note-session/session-test-kit';
import {
  editorStub,
  renderNoteScreen,
  resetEditorStub,
  settleUi,
  typeInEditor,
} from './note-screen-test-kit';

const renameNote = vi.hoisted(() => vi.fn());
vi.mock('../../lib/note-operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/note-operations')>()),
  renameNote,
}));
vi.mock('../../editor/markdown-editor', async () => ({
  MarkdownEditor: (await import('./markdown-editor-stub')).StubMarkdownEditor,
}));

const PATH = '1 Projects/Đồ án Giải tích.md';
const SEARCH = `path=${encodeURIComponent(PATH)}`;
const titleField = () => screen.getByRole('textbox', { name: /Tiêu đề ghi chú/ });

describe('note screen title, source mode and line links (F3.7, F3.8)', () => {
  let server: FakeNoteServer;
  let navigate: ReturnType<typeof vi.fn<Navigator>>;

  beforeEach(async () => {
    navigate = (await resetAppState('vault-a')) as ReturnType<typeof vi.fn<Navigator>>;
    await freshDraftDatabase();
    useSessionFakeTimers();
    resetEditorStub();
    renameNote.mockReset();
    server = installFakeNoteServer(PATH, '# Đồ án\n\nThân bài.\n');
  });
  afterEach(async () => {
    resetNoteSessions();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await closeDraftDatabase();
  });

  it('commits the title: saves first, renames with relink at that revision, follows the note', async () => {
    const newPath = '1 Projects/Đồ án cuối kỳ.md';
    renameNote.mockImplementation(async () => {
      expect(server.mock.callsTo('PUT /api/note')).toHaveLength(1);
      return { ok: true, path: newPath };
    });
    await renderNoteScreen(SEARCH);
    typeInEditor('X');
    fireEvent.change(titleField(), { target: { value: '  Đồ án cuối kỳ ' } });
    fireEvent.blur(titleField());
    await settleUi();
    expect(renameNote).toHaveBeenCalledWith(PATH, 'Đồ án cuối kỳ', {
      expectedRevision: server.revision,
    });
    expect(navigate).toHaveBeenCalledWith(noteRoute(newPath), { replace: true });
    expect(titleField()).toHaveValue('Đồ án cuối kỳ');
    expect(editorStub.mounts).toBe(1);
    // Not a freshly created note: its heading is left alone.
    expect(editorStub.handle.replaceDoc).not.toHaveBeenCalled();
  });

  it('naming a note created from a template also renames its "# Ghi chú mới" heading, once', async () => {
    const created = '0 Inbox/Ghi chú mới 2.md';
    server.writeElsewhere('# Ghi chú mới\n\n## Câu hỏi còn thắc mắc\n');
    renameNote.mockImplementation(async (_path: string, title: string) => ({
      ok: true,
      path: `0 Inbox/${title}.md`,
    }));
    await renderNoteScreen(`path=${encodeURIComponent(created)}&new=1`);
    expect(document.activeElement).toBe(titleField());
    fireEvent.change(titleField(), { target: { value: 'Bài 2 Tích phân' } });
    fireEvent.keyDown(titleField(), { key: 'Enter' });
    await settleUi();
    // An ordinary edit through the editor handle (undoable), not a document swap.
    expect(editorStub.doc?.firstChild?.textContent).toBe('Bài 2 Tích phân');
    expect(editorStub.handle.replaceDoc).not.toHaveBeenCalled();
    await settleUi(500);
    expect(server.content).toBe('# Bài 2 Tích phân\n\n## Câu hỏi còn thắc mắc\n');
    // A later rename is a plain rename.
    fireEvent.change(titleField(), { target: { value: 'Bài 2' } });
    fireEvent.blur(titleField());
    await settleUi(500);
    expect(editorStub.doc?.firstChild?.textContent).toBe('Bài 2 Tích phân');
    expect(server.content).toBe('# Bài 2 Tích phân\n\n## Câu hỏi còn thắc mắc\n');
  });

  it('Esc reverts the title; a cancelled rename shows the old name again', async () => {
    renameNote.mockResolvedValue({ ok: false, reason: 'cancelled' });
    await renderNoteScreen(SEARCH);
    fireEvent.change(titleField(), { target: { value: 'Tên khác' } });
    fireEvent.keyDown(titleField(), { key: 'Escape' });
    expect(titleField()).toHaveValue('Đồ án Giải tích');
    fireEvent.blur(titleField());
    expect(renameNote).not.toHaveBeenCalled();
    fireEvent.change(titleField(), { target: { value: 'Tên khác' } });
    titleField().focus();
    fireEvent.keyDown(titleField(), { key: 'Enter' });
    expect(editorStub.handle.focus).toHaveBeenCalledWith({ block: 0 });
    await settleUi();
    expect(renameNote).toHaveBeenCalledTimes(1);
    expect(titleField()).toHaveValue('Đồ án Giải tích');
  });

  it('&new=1 focuses and selects the title once, then drops the flag', async () => {
    await renderNoteScreen(`${SEARCH}&new=1`);
    const field = titleField() as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'Đồ án Giải tích'.length]);
    expect(navigate).toHaveBeenCalledWith(noteRoute(PATH), { replace: true });
  });

  it('Alt+S shows the exact text; edits there save with the file line endings and BOM', async () => {
    const file = '﻿---\r\ntype: note\r\n---\r\n# Nguồn\r\n';
    server.writeElsewhere(file);
    const original = server.revision;
    const removeListener = installShortcutListener();
    await renderNoteScreen(SEARCH);
    act(() => {
      fireEvent.keyDown(window, { key: 's', code: 'KeyS', altKey: true });
    });
    await settleUi();
    const source = screen.getByRole('textbox', { name: /chế độ nguồn/ });
    expect(source).toHaveValue('---\ntype: note\n---\n# Nguồn\n');
    expect(document.activeElement).toBe(source);
    expect(screen.queryByRole('group', { name: 'Thuộc tính' })).toBeNull();
    fireEvent.change(source, { target: { value: '---\ntype: note\n---\n# Nguồn\n\n$$x$$\n' } });
    await settleUi(500);
    expect(server.mock.callsTo('PUT /api/note')[0]?.body).toEqual({
      path: PATH,
      content: `${file}\r\n$$x$$\r\n`,
      expectedRevision: original,
    });
    act(() => {
      fireEvent.keyDown(source, { key: 's', code: 'KeyS', altKey: true });
    });
    await settleUi();
    expect(screen.queryByRole('textbox', { name: /chế độ nguồn/ })).toBeNull();
    expect(editorStub.handle.replaceDoc).toHaveBeenCalledTimes(1);
    expect(editorStub.handle.focus).toHaveBeenCalled();
    removeListener();
  });

  it('&line=N puts the caret in the block holding that file line, every time it is asked', async () => {
    server.writeElsewhere('---\ntype: note\n---\n# A\n\nĐoạn một\n\n## B\n\nĐoạn hai\n');
    const router = await renderNoteScreen(`${SEARCH}&line=8`);
    expect(editorStub.handle.focus).toHaveBeenLastCalledWith({ block: 2 });
    editorStub.handle.focus.mockClear();
    await act(async () => {
      await router.navigate(`/note?${SEARCH}&line=8`, { replace: true });
    });
    expect(editorStub.handle.focus).toHaveBeenCalledWith({ block: 2 });
    await act(async () => {
      await router.navigate(`/note?${SEARCH}&line=2`, { replace: true });
    });
    expect(editorStub.handle.focus).toHaveBeenLastCalledWith({ block: 0 });
  });
});
