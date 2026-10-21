import { act, fireEvent, screen, within } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installRangeLayoutShim } from '../../editor/__tests__/jsdom-layout';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { closeDraftDatabase } from '../drafts/draft-database';
import { resetNoteSessions } from '../note-session/session-registry';
import {
  freshDraftDatabase,
  installFakeNoteServer,
  useSessionFakeTimers,
  type FakeNoteServer,
} from '../note-session/session-test-kit';
import { renderNoteScreen, settleUi } from './note-screen-test-kit';

const PATH = '1 Projects/Đồ án Giải tích.md';
const SEARCH = `path=${encodeURIComponent(PATH)}`;
const CONTENT = '---\r\ntype: project\r\n---\r\n# Đồ án\r\n\r\nMột chữ *nghiêng*.\r\n\r\n$$x$$\r\n';

function realEditor(): Editor {
  const root = screen.getByRole('textbox', { name: /Nội dung ghi chú/ }) as HTMLElement & {
    editor?: Editor;
  };
  if (!root.editor) throw new Error('no Tiptap editor on the root');
  return root.editor;
}

const toolbar = () => screen.getByRole('toolbar', { name: 'Định dạng' });
const button = (name: string | RegExp) => within(toolbar()).getByRole('button', { name });

describe('note screen with the formatting toolbar', () => {
  let server: FakeNoteServer;

  beforeAll(installRangeLayoutShim);
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

  it('sits above the title; hovering, focusing and browsing it never writes the note (P1)', async () => {
    await renderNoteScreen(SEARCH);
    const title = screen.getByRole('textbox', { name: /Tiêu đề ghi chú/ });
    expect(
      toolbar().compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    for (const control of within(toolbar()).getAllByRole('button')) {
      fireEvent.mouseOver(control);
      fireEvent.mouseMove(control);
      fireEvent.mouseDown(control);
    }
    act(() => button('Hoàn tác chỉnh sửa').focus());
    for (const key of ['ArrowRight', 'ArrowRight', 'End', 'Home', 'ArrowLeft']) {
      fireEvent.keyDown(document.activeElement!, { key });
    }
    fireEvent.click(button(/^Kiểu chữ/));
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    await settleUi(3000);
    expect(server.mock.callsTo('PUT /api/note')).toHaveLength(0);
  });

  it('underline from the toolbar is saved as <u>…</u>, everything else byte for byte', async () => {
    await renderNoteScreen(SEARCH);
    const editor = realEditor();
    act(() => {
      let from = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Một chữ ') from = pos + 4;
        return from === 0;
      });
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, from + 3)),
      );
    });
    fireEvent.mouseDown(button('Gạch chân'));
    fireEvent.click(button('Gạch chân'));
    await settleUi(600);
    expect(server.content).toBe(CONTENT.replace('Một chữ', 'Một <u>chữ</u>'));
  });

  it('switches to source mode from the toolbar, where only undo, redo and the switch work', async () => {
    await renderNoteScreen(SEARCH);
    fireEvent.click(button('Chế độ nguồn'));
    await settleUi();
    expect(screen.getByRole('textbox', { name: /chế độ nguồn/ })).toBeInTheDocument();
    expect(button('Chế độ nguồn')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Đậm')).toHaveAttribute('aria-disabled', 'true');
    expect(button('Hoàn tác chỉnh sửa')).not.toHaveAttribute('aria-disabled');
    fireEvent.click(button('Chế độ nguồn'));
    await settleUi();
    expect(screen.queryByRole('textbox', { name: /chế độ nguồn/ })).toBeNull();
    expect(server.mock.callsTo('PUT /api/note')).toHaveLength(0);
  });
});
