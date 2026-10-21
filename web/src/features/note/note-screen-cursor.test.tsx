import { act, fireEvent, screen } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { typeText } from '../../editor/__tests__/editor-test-utils';
import { installRangeLayoutShim } from '../../editor/__tests__/jsdom-layout';
import { noteRoute, setRouteReader, type Navigator } from '../../lib/app-navigation';
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

const DAILY_PATH = 'Daily/2026-10-20.md';
const DAILY = [
  '---',
  'type: daily',
  'created: 2026-10-20',
  '---',
  '',
  '# thứ ba, 20 tháng 10 2026',
  '',
  '← [[2026-10-19]] · [[2026-10-21]] →',
  '',
  '## Việc hôm nay',
  '',
  '{{cursor}}',
  '',
  '## Ghi chép',
  '',
].join('\n');
const CURSOR = DAILY.indexOf('{{cursor}}');
const CONTENT = DAILY.replace('{{cursor}}', '');

function realEditor(): Editor {
  const root = screen.getByRole('textbox', { name: /Nội dung ghi chú/ }) as HTMLElement & {
    editor?: Editor;
  };
  if (!root.editor) throw new Error('no Tiptap editor on the root');
  return root.editor;
}

describe('caret at {{cursor}} when a note opens (F14.2)', () => {
  let server: FakeNoteServer;
  let navigate: ReturnType<typeof vi.fn<Navigator>>;

  beforeAll(installRangeLayoutShim);
  beforeEach(async () => {
    navigate = (await resetAppState('vault-a')) as ReturnType<typeof vi.fn<Navigator>>;
    await freshDraftDatabase();
    useSessionFakeTimers();
  });
  let unregisterRoute: () => void = () => undefined;
  afterEach(async () => {
    unregisterRoute();
    resetNoteSessions();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await closeDraftDatabase();
  });

  it('a new daily note: caret on the empty line, focus in the editor, param dropped, nothing written', async () => {
    server = installFakeNoteServer(DAILY_PATH, CONTENT);
    await renderNoteScreen(`path=${encodeURIComponent(DAILY_PATH)}&cursor=${CURSOR}`);
    const editor = realEditor();
    expect(editor.view.hasFocus()).toBe(true);
    const { $from } = editor.state.selection;
    expect($from.parent.type.name).toBe('paragraph');
    expect($from.parent.childCount).toBe(0);
    const index = $from.index(0);
    expect(editor.state.doc.child(index - 1).textContent).toBe('Việc hôm nay');
    expect(editor.state.doc.child(index + 1).textContent).toBe('Ghi chép');
    expect(navigate).toHaveBeenCalledWith(noteRoute(DAILY_PATH), { replace: true });
    await settleUi(3000);
    expect(server.mock.callsTo('PUT /api/note')).toHaveLength(0);
    expect(screen.queryByText('Bản nháp')).toBeNull();

    act(() => typeText(editor, 'Đọc chương 2'));
    await settleUi(600);
    expect(server.content).toBe(
      `${CONTENT.slice(0, CURSOR)}Đọc chương 2\n\n${CONTENT.slice(CURSOR)}`,
    );
  });

  it('the user already opened another note: the caret request does not pull the address back', async () => {
    server = installFakeNoteServer(DAILY_PATH, CONTENT);
    // The router has moved on (Alt+T, then another note at once) before this screen re-rendered.
    const other = noteRoute('0 Inbox/Ý tưởng khác.md');
    unregisterRoute = setRouteReader(() => ({
      pathname: '/note',
      search: other.slice(other.indexOf('?')),
    }));
    await renderNoteScreen(`path=${encodeURIComponent(DAILY_PATH)}&cursor=${CURSOR}`);
    expect(navigate).not.toHaveBeenCalled();
    expect(realEditor().view.hasFocus()).toBe(false);
  });

  it('while the route still shows the note, the request is consumed with a replace', async () => {
    server = installFakeNoteServer(DAILY_PATH, CONTENT);
    const route = noteRoute(DAILY_PATH, { cursor: CURSOR });
    unregisterRoute = setRouteReader(() => ({
      pathname: '/note',
      search: route.slice(route.indexOf('?')),
    }));
    await renderNoteScreen(`path=${encodeURIComponent(DAILY_PATH)}&cursor=${CURSOR}`);
    expect(navigate).toHaveBeenCalledWith(noteRoute(DAILY_PATH), { replace: true });
    expect(realEditor().view.hasFocus()).toBe(true);
  });

  it('a new note from a template: the title first, Enter there moves the caret to {{cursor}}', async () => {
    const path = '0 Inbox/Ghi chú mới.md';
    const template = '---\ntype: note\ncreated: 2026-10-20\n---\n\n# Ghi chú mới\n\n{{cursor}}\n';
    const offset = template.indexOf('{{cursor}}');
    server = installFakeNoteServer(path, template.replace('{{cursor}}', ''));
    await renderNoteScreen(`path=${encodeURIComponent(path)}&new=1&cursor=${offset}`);
    const title = screen.getByRole('textbox', { name: /Tiêu đề ghi chú/ });
    expect(document.activeElement).toBe(title);
    fireEvent.keyDown(title, { key: 'Enter' });
    const editor = realEditor();
    expect(editor.view.hasFocus()).toBe(true);
    expect(editor.state.selection.$from.index(0)).toBe(1);
    act(() => typeText(editor, 'Ý đầu tiên'));
    await settleUi(600);
    expect(server.content).toBe(
      '---\ntype: note\ncreated: 2026-10-20\n---\n\n# Ghi chú mới\n\nÝ đầu tiên\n\n\n',
    );
  });
});
