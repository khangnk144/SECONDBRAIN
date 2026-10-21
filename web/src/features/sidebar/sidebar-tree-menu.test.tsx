import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useDialogStore } from '../../lib/dialogs/dialog-requests';
import type { FetchMock } from '../../lib/testing/fetch-mock';
import { useTreeStore } from '../../lib/tree-store';
import {
  item,
  renderApp,
  setupSidebarTest,
  teardownSidebarTest,
  toastStatus,
} from './sidebar-tree-test-kit';

const menuLabels = () =>
  within(screen.getByRole('menu'))
    .getAllByRole('menuitem')
    .map((e) => e.textContent);

describe('sidebar context menus and row names (F2)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    mock = await setupSidebarTest();
    useTreeStore.setState({ expanded: ['0 Inbox', '1 Projects'] });
  });
  afterEach(teardownSidebarTest);

  it('notes offer every SPEC F2 action, creating new items in their own folder', async () => {
    const user = userEvent.setup();
    renderApp();
    act(() => item('Ý tưởng').focus());
    await user.keyboard('{ContextMenu}');
    expect(menuLabels()).toEqual([
      'Mở trong thẻ mới',
      'Ghi chú mới',
      'Thư mục mới',
      'Đổi tênF2',
      'Di chuyển tới…',
      'Chuyển vào Archive',
      'XóaDelete',
      'Hiện trong Explorer',
      'Lịch sử phiên bản',
    ]);
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await waitFor(() => expect(useDialogStore.getState().queue).toHaveLength(1));
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Thư mục mới trong 0 Inbox');
  });

  it('a non-standard folder can be moved to the Archive (dry run, then move)', async () => {
    const user = userEvent.setup();
    mock.on('POST /api/folder/rename', (call) =>
      (call.body as { dryRun?: boolean }).dryRun
        ? { body: { dryRun: true, path: '4 Archive/Đồ án Giải tích', affected: [] } }
        : { body: { journalId: '01JOURNAL0040', path: '4 Archive/Đồ án Giải tích', affected: [] } },
    );
    renderApp();
    act(() => item('Đồ án Giải tích').focus());
    await user.keyboard('{Shift>}{F10}{/Shift}');
    const archive = within(screen.getByRole('menu')).getByRole('menuitem', {
      name: 'Chuyển vào Archive',
    });
    expect(archive).not.toHaveAttribute('aria-disabled');
    await user.click(archive);
    await waitFor(() => expect(mock.callsTo('POST /api/folder/rename')).toHaveLength(2));
    expect(mock.callsTo('POST /api/folder/rename')[1]?.body).toEqual({
      path: '1 Projects/Đồ án Giải tích',
      newPath: '4 Archive/Đồ án Giải tích',
      relink: true,
    });
    expect(toastStatus()).toHaveTextContent('Đã chuyển thư mục “Đồ án Giải tích” vào Archive.');
  });

  it('rows read their name first, then the urgent hint', () => {
    renderApp();
    expect(item('1 Projects')).toHaveAccessibleName('1 Projects có deadline gấp bên trong');
    expect(item('0 Inbox')).toHaveAccessibleName('0 Inbox 2 ghi chú');
  });
});
