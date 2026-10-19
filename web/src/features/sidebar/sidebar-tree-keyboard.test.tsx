import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTabsStore } from '../../lib/tabs-store';
import type { FetchMock } from '../../lib/testing/fetch-mock';
import { makeTree } from '../../lib/testing/tree-fixture';
import { useToastStore } from '../../lib/toast-store';
import {
  FIXTURE,
  item,
  labels,
  renderApp,
  REV,
  setupSidebarTest,
  teardownSidebarTest,
} from './sidebar-tree-test-kit';
import { canDropInto } from './tree-drag-drop';

describe('sidebar tree keyboard, menu, rename, trash, drag (F2.2, F2.4)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    mock = await setupSidebarTest();
  });
  afterEach(teardownSidebarTest);

  it('is fully operable with the keyboard: move, expand, collapse, open (F2.4)', async () => {
    const user = userEvent.setup();
    const router = renderApp();
    act(() => item('0 Inbox').focus());
    await user.keyboard('{ArrowDown}');
    expect(item('Ý tưởng')).toHaveFocus();
    await user.keyboard('{End}');
    expect(item('Ghi chú gốc')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(item('0 Inbox')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(item('0 Inbox')).toHaveAttribute('aria-expanded', 'false');
    expect(labels()).not.toContain('Ý tưởng');
    await user.keyboard('{ArrowRight}');
    expect(item('0 Inbox')).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowRight}');
    expect(item('Ý tưởng')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(item('0 Inbox')).toHaveFocus();
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowRight}');
    expect(item('1 Projects')).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(localStorage.getItem('sb:vault-a:tree.expanded') ?? '[]')).toContain(
      '1 Projects',
    );
    await user.keyboard('{ArrowUp}{Enter}');
    expect(router.state.location.pathname).toBe('/note');
    expect(new URLSearchParams(router.state.location.search).get('path')).toBe(
      '0 Inbox/Bài tập.md',
    );
    expect(item('Bài tập')).toHaveAttribute('aria-current', 'page');
    await user.keyboard('{ArrowUp}{Control>}{Enter}{/Control}');
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual([
      '0 Inbox/Bài tập.md',
      '0 Inbox/Ý tưởng.md',
    ]);
  });

  it('renames with F2 (Enter commits, Esc cancels) and keeps focus on the renamed note', async () => {
    const user = userEvent.setup();
    mock.on('POST /api/note/rename', (call) =>
      (call.body as { dryRun?: boolean }).dryRun
        ? { body: { dryRun: true, path: '0 Inbox/Bài tập mới.md', affected: [] } }
        : { body: { journalId: '01JOURNAL0009', path: '0 Inbox/Bài tập mới.md', affected: [] } },
    );
    renderApp();
    act(() => item('Bài tập').focus());
    await user.keyboard('{F2}');
    const input = screen.getByRole('textbox', { name: 'Tên mới' });
    expect(input).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox', { name: 'Tên mới' })).toBeNull();
    expect(item('Bài tập')).toHaveFocus();

    await user.keyboard('{F2}');
    await user.keyboard('a/b{Enter}');
    expect(screen.getByText(/Tên không được chứa/)).toHaveAttribute('role', 'alert');
    await user.clear(screen.getByRole('textbox', { name: 'Tên mới' }));
    mock.on('GET /api/tree', {
      body: makeTree({
        ...FIXTURE,
        notes: FIXTURE.notes.map((p) =>
          p === '0 Inbox/Bài tập.md' ? '0 Inbox/Bài tập mới.md' : p,
        ),
      }),
    });
    await user.keyboard('Bài tập mới{Enter}');
    await waitFor(() => expect(labels()).toContain('Bài tập mới'));
    await waitFor(() => expect(item('Bài tập mới')).toHaveFocus());
    expect(mock.callsTo('POST /api/note/rename')).toHaveLength(2);
    expect(screen.getByRole('status')).toHaveTextContent('Đã đổi tên thành “Bài tập mới”.');
  });

  it('opens the context menu with Shift+F10 or the menu key and works without a mouse', async () => {
    const user = userEvent.setup();
    renderApp();
    act(() => item('1 Projects').focus());
    await user.keyboard('{Shift>}{F10}{/Shift}');
    const menu = screen.getByRole('menu');
    const entries = within(menu).getAllByRole('menuitem');
    expect(entries.map((e) => e.textContent)).toEqual([
      'Ghi chú mới',
      'Thư mục mới',
      'Đổi tênF2',
      'Di chuyển tới…',
      'Chuyển vào Archive',
      'XóaDelete',
      'Hiện trong Explorer',
    ]);
    expect(entries[0]).toHaveFocus();
    // Standard folders cannot be renamed, moved, archived or deleted; the reason is exposed.
    for (const index of [2, 3, 4, 5]) {
      expect(entries[index]).toHaveAttribute('aria-disabled', 'true');
      expect(entries[index]).toHaveAccessibleDescription(/thư mục chuẩn/);
    }
    await user.keyboard('{ArrowUp}');
    expect(entries[6]).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(item('1 Projects')).toHaveFocus();

    act(() => item('Ý tưởng').focus());
    await user.keyboard('{ContextMenu}');
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem')[0]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(useTabsStore.getState().tabs.map((t) => t.path)).toEqual(['0 Inbox/Ý tưởng.md']);
  });

  it('trashes the focused note with Delete and moves focus to the next row', async () => {
    const user = userEvent.setup();
    mock.on('POST /api/note/trash', { body: { journalId: '01JOURNAL0010', trashId: 't' } });
    renderApp();
    act(() => item('Ý tưởng').focus());
    mock.on('GET /api/tree', {
      body: makeTree({
        ...FIXTURE,
        notes: FIXTURE.notes.filter((p) => p !== '0 Inbox/Ý tưởng.md'),
      }),
    });
    await user.keyboard('{Delete}');
    await waitFor(() => expect(labels()).not.toContain('Ý tưởng'));
    expect(mock.callsTo('POST /api/note/trash')[0]?.body).toEqual({
      paths: ['0 Inbox/Ý tưởng.md'],
      expectedRevisions: [REV],
    });
    expect(useToastStore.getState().toasts.at(-1)?.action?.label).toBe('Hoàn tác');
    await waitFor(() => expect(item('Bài tập')).toHaveFocus());
  });

  it('drag a note onto a folder moves it with relink; invalid targets refuse the drop', async () => {
    mock.on('POST /api/note/move', (call) =>
      (call.body as { dryRun?: boolean }).dryRun
        ? { body: { dryRun: true, path: '2 Areas/Ý tưởng.md', affected: [] } }
        : { body: { journalId: '01JOURNAL0011', path: '2 Areas/Ý tưởng.md', affected: [] } },
    );
    renderApp();
    const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(item('Ý tưởng'), { dataTransfer });
    // Its own folder is not a target (no preventDefault → no drop).
    expect(fireEvent.dragOver(item('0 Inbox'), { dataTransfer })).toBe(true);
    expect(fireEvent.dragOver(item('2 Areas'), { dataTransfer })).toBe(false);
    expect(item('2 Areas')).toHaveClass('is-drop-target');
    fireEvent.drop(item('2 Areas'), { dataTransfer });
    await waitFor(() => expect(mock.callsTo('POST /api/note/move')).toHaveLength(2));
    expect(mock.callsTo('POST /api/note/move')[1]?.body).toEqual({
      path: '0 Inbox/Ý tưởng.md',
      folder: '2 Areas',
      expectedRevision: REV,
      relink: true,
    });
    // Standard folders cannot be dragged at all.
    expect(item('1 Projects')).toHaveAttribute('draggable', 'false');
    expect(canDropInto({ kind: 'folder', path: '2 Areas/A' }, '2 Areas/A/B')).toBe(false);
    expect(canDropInto({ kind: 'folder', path: '2 Areas/A' }, '1 Projects')).toBe(true);
  });
});
