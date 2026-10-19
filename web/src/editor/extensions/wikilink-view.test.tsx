import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkTargetNote } from '../../lib/api/link-targets-types';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { useTabsStore } from '../../lib/tabs-store';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useToastStore } from '../../lib/toast-store';
import { MarkdownEditor } from '../markdown-editor';
import { loadMarkdown, saveMarkdown } from '../markdown/markdown-document';
import { pressKey } from '../__tests__/editor-test-utils';

const NOTE = '1 Projects/Đồ án.md';

function note(path: string, unique = true): LinkTargetNote {
  const name = path.slice(path.lastIndexOf('/') + 1, -3);
  return { path, title: name, folder: path.split('/')[0] ?? '', class: 'user', unique };
}

function mount(source: string) {
  const loaded = loadMarkdown(source);
  const view = render(
    <MarkdownEditor
      initialDoc={loaded.doc}
      notePath={NOTE}
      editable
      ariaLabel="Nội dung"
      onDocChange={() => undefined}
    />,
  );
  const editor = (screen.getByRole('textbox') as HTMLElement & { editor: Editor }).editor;
  return { loaded, editor, ...view };
}

function links(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('.wikilink')];
}

describe('wikilink rendering and clicks (F4.2, F4.5)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
    useLinkTargetsStore
      .getState()
      .setTargets(
        [
          note('2 Areas/Giải tích 1.md'),
          note('1 Projects/Toán/Bài 1.md', false),
          note('2 Areas/Lý/Bài 1.md', false),
        ],
        [{ path: 'Attachments/2026-10/sơ đồ.png', name: 'sơ đồ.png' }],
      );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows resolved, ghost, ambiguous and embed links differently', () => {
    const { container } = mount('[[Giải tích 1|GT1]] [[Newton]] [[Bài 1]] ![[sơ đồ.png]]\n');
    const [resolved, ghost, ambiguous, embed] = links(container);
    expect(resolved).toHaveAttribute('data-status', 'resolved');
    expect(resolved).toHaveTextContent('GT1');
    expect(ghost).toHaveAttribute('data-status', 'ghost');
    expect(ambiguous).toHaveAttribute('data-status', 'ambiguous');
    expect(ambiguous!.querySelector('button')).toHaveAccessibleName('Chọn đích…');
    expect(embed).toHaveAttribute('data-embed');
    expect(embed!.querySelector('svg')).toBeTruthy();
  });

  it('re-renders when the link targets change', () => {
    const { container } = mount('[[Newton]]\n');
    expect(links(container)[0]).toHaveAttribute('data-status', 'ghost');
    act(() => {
      useLinkTargetsStore.getState().setTargets([note('2 Areas/Newton.md')], []);
    });
    expect(links(container)[0]).toHaveAttribute('data-status', 'resolved');
  });

  it('click opens the note, Ctrl+click opens it in a new tab', () => {
    const { container } = mount('[[Giải tích 1]]\n');
    fireEvent.click(links(container)[0]!);
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(['2 Areas/Giải tích 1.md']);
    useTabsStore.setState({
      tabs: [{ id: 'x', path: 'Daily/a.md', lastActive: 1 }],
      activeId: 'x',
    });
    fireEvent.click(links(container)[0]!, { ctrlKey: true });
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual([
      'Daily/a.md',
      '2 Areas/Giải tích 1.md',
    ]);
  });

  it('Enter on a selected link opens it', () => {
    const { editor } = mount('Xem [[Giải tích 1]]\n');
    act(() => {
      editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 5)));
    });
    expect(pressKey(editor, 'Enter')).toBe(true);
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(['2 Areas/Giải tích 1.md']);
  });

  it('a ghost click creates 0 Inbox/<Target>.md and opens it (F4.5)', async () => {
    mock.on('POST /api/note', (call) => ({
      body: { path: (call.body as { path: string }).path, revision: 'r1' },
    }));
    const { container } = mount('[[Phương pháp Newton]]\n');
    fireEvent.click(links(container)[0]!);
    await waitFor(() => expect(mock.callsTo('POST /api/note')).toHaveLength(1));
    expect(mock.callsTo('POST /api/note')[0]!.body).toMatchObject({
      path: '0 Inbox/Phương pháp Newton.md',
    });
    await waitFor(() =>
      expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual([
        '0 Inbox/Phương pháp Newton.md',
      ]),
    );
  });

  it('a ghost whose name cannot be a file name shows a friendly error and creates nothing', async () => {
    const { container } = mount('[[Hỏi: tại sao?]]\n');
    fireEvent.click(links(container)[0]!);
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    expect(useToastStore.getState().toasts[0]!.tone).toBe('error');
    expect(mock.callsTo('POST /api/note')).toHaveLength(0);
  });

  it('"Chọn đích…" lists the candidates and rewrites the link to the chosen path form', async () => {
    const { container, editor, loaded } = mount('Xem [[Bài 1]] nhé\n');
    fireEvent.click(links(container)[0]!.querySelector('button')!);
    const menu = await screen.findByRole('menu', { name: 'Chọn ghi chú đích cho Bài 1' });
    const items = [...menu.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent);
    expect(items).toEqual(['1 Projects/Toán/Bài 1', '2 Areas/Lý/Bài 1']);
    fireEvent.click(screen.getByRole('menuitem', { name: '2 Areas/Lý/Bài 1' }));
    expect(screen.queryByRole('menu')).toBeNull();
    expect(saveMarkdown(editor.state.doc, loaded.snapshot)).toBe('Xem [[2 Areas/Lý/Bài 1]] nhé\n');
    expect(links(container)[0]).toHaveAttribute('data-status', 'resolved');
  });
});
