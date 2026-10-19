import { act, fireEvent, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { undo } from '@tiptap/pm/history';
import type { Transaction } from '@tiptap/pm/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { closeDraftDatabase } from '../drafts/draft-database';
import { resetNoteSessions } from '../note-session/session-registry';
import {
  freshDraftDatabase,
  installFakeNoteServer,
  useSessionFakeTimers,
  type FakeNoteServer,
} from '../note-session/session-test-kit';
import { renderNoteScreen, settleUi } from './note-screen-test-kit';

const renameNote = vi.hoisted(() => vi.fn());
vi.mock('../../lib/note-operations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/note-operations')>()),
  renameNote,
}));

const PATH = '1 Projects/Đồ án Giải tích.md';
const CONTENT = [
  '---',
  'type: project   # giữ nguyên',
  '---',
  '# Đồ án Giải tích',
  '',
  'Dùng [[Giải tích 1]] và *nghiêng* ở đây.',
  '',
  '- [ ] Nộp bản nháp 📅 2026-11-01',
  '- [x] Chọn đề tài',
  '',
  '$$x^2$$',
  '',
  '#### Mục cấp 4',
  '',
].join('\r\n');

/** Tiptap puts the editor on its root element; tests type through it like an input rule would. */
function realEditor(): Editor {
  const root = screen.getByRole('textbox', { name: /Nội dung ghi chú/ }) as HTMLElement & {
    editor?: Editor;
  };
  if (!root.editor) throw new Error('no Tiptap editor on the root');
  return root.editor;
}

describe('note screen with the real editor', () => {
  let server: FakeNoteServer;

  beforeEach(async () => {
    await resetAppState('vault-a');
    await freshDraftDatabase();
    useSessionFakeTimers();
    server = installFakeNoteServer(PATH, CONTENT);
  });
  afterEach(async () => {
    resetNoteSessions();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await closeDraftDatabase();
  });

  it('opens a note and writes nothing while nobody edits (P1)', async () => {
    await renderNoteScreen(`path=${encodeURIComponent(PATH)}`);
    expect(realEditor().getText()).toContain('Đồ án Giải tích');
    await settleUi(3000);
    expect(server.mock.callsTo('PUT /api/note')).toHaveLength(0);
  });

  it('saves one typed word as a local edit, everything else byte for byte', async () => {
    await renderNoteScreen(`path=${encodeURIComponent(PATH)}`);
    const editor = realEditor();
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText('Bài ', 1));
    });
    await settleUi(500);
    expect(server.content).toBe(CONTENT.replace('# Đồ án', '# Bài Đồ án'));
  });

  it('reloads an outside change into the editor while clean', async () => {
    await renderNoteScreen(`path=${encodeURIComponent(PATH)}`);
    server.writeElsewhere('# Đồ án Giải tích\r\n\r\nSửa trong Notepad.\r\n');
    emitServerEvent({ type: 'note:changed', path: PATH, revision: server.revision ?? '' });
    await settleUi();
    expect(realEditor().getText()).toContain('Sửa trong Notepad.');
    await settleUi(2000);
    expect(server.mock.callsTo('PUT /api/note')).toHaveLength(0);
  });

  it('Enter in the title puts the caret in the body at once, so a click right after is kept', async () => {
    await renderNoteScreen(`path=${encodeURIComponent(PATH)}`);
    const title = screen.getByRole('textbox', { name: /Tiêu đề ghi chú/ });
    title.focus();
    fireEvent.keyDown(title, { key: 'Enter' });
    const editor = realEditor();
    expect(editor.view.hasFocus()).toBe(true);
    expect(editor.state.selection.from).toBe(1);
    // The owner clicks at the end of the note right away; nothing may move the caret back.
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    });
    const placed = editor.state.selection.from;
    vi.useRealTimers();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(editor.state.selection.from).toBe(placed);
  });

  it('naming a new note renames its template heading as an edit that undo can take back', async () => {
    const created = '0 Inbox/Ghi chú mới.md';
    server.writeElsewhere('# Ghi chú mới\r\n\r\n## Câu hỏi còn thắc mắc\r\n');
    renameNote.mockResolvedValue({ ok: true, path: '0 Inbox/Bài 2 Tích phân.md' });
    await renderNoteScreen(`path=${encodeURIComponent(created)}&new=1`);
    const title = screen.getByRole('textbox', { name: /Tiêu đề ghi chú/ });
    fireEvent.change(title, { target: { value: 'Bài 2 Tích phân' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    await settleUi();
    const editor = realEditor();
    expect(editor.state.doc.firstChild?.textContent).toBe('Bài 2 Tích phân');
    await settleUi(500);
    expect(server.content).toBe('# Bài 2 Tích phân\r\n\r\n## Câu hỏi còn thắc mắc\r\n');
    // The change sits in the editor's own undo history (taken without dispatching: jsdom cannot
    // scroll the selection into view).
    let undone: Transaction | null = null;
    expect(undo(editor.state, (tr) => (undone = tr))).toBe(true);
    expect((undone as Transaction | null)?.doc.firstChild?.textContent).toBe('Ghi chú mới');
  });
});
