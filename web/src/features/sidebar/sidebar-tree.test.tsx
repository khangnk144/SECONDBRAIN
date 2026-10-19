import { act, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchMock } from '../../lib/testing/fetch-mock';
import { makeTree } from '../../lib/testing/tree-fixture';
import { startTreeSync, useTreeStore } from '../../lib/tree-store';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import {
  FIXTURE,
  item,
  labels,
  renderApp,
  REV,
  setupSidebarTest,
  teardownSidebarTest,
} from './sidebar-tree-test-kit';

describe('sidebar tree rendering and refresh (F2.1, F2.3)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    mock = await setupSidebarTest();
  });
  afterEach(teardownSidebarTest);

  it('renders folders in vault order, notes by title (Daily newest first), Inbox badge and urgent dot', () => {
    renderApp();
    const tree = screen.getByRole('tree', { name: 'Thư mục' });
    expect(tree).toBeInTheDocument();
    expect(labels()).toEqual([
      '0 Inbox',
      'Ý tưởng',
      'Bài tập',
      '1 Projects',
      '2 Areas',
      'Daily',
      '2026-10-19',
      '2026-10-18',
      'Ghi chú gốc',
    ]);
    expect(item('0 Inbox')).toHaveAttribute('aria-expanded', 'true');
    expect(item('0 Inbox')).toHaveAttribute('aria-level', '1');
    expect(item('Ý tưởng')).toHaveAttribute('aria-level', '2');
    expect(item('1 Projects')).toHaveAttribute('aria-expanded', 'false');
    expect(within(item('0 Inbox')).getByText('2 ghi chú')).toHaveClass('visually-hidden');
    expect(within(item('1 Projects')).getByText('có deadline gấp bên trong')).toBeInTheDocument();
    expect(item('2 Areas').querySelector('.tree-item__urgent')).toBeNull();
    // Roving tabindex: exactly one item is in the Tab order.
    expect(screen.getAllByRole('treeitem').filter((el) => el.tabIndex === 0)).toHaveLength(1);
  });

  it('restores expanded folders saved for the vault (F2.1)', () => {
    localStorage.setItem('sb:vault-a:tree.expanded', JSON.stringify(['2 Areas']));
    useTreeStore.getState().hydrate();
    renderApp();
    expect(item('2 Areas')).toHaveAttribute('aria-expanded', 'true');
    expect(item('0 Inbox')).toHaveAttribute('aria-expanded', 'false');
    expect(labels()).toContain('Giải tích 1');
  });

  it('updates the Inbox badge within the debounce after a file event (F2.3)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    const stop = startTreeSync();
    renderApp();
    mock.on('GET /api/tree', {
      body: makeTree({ ...FIXTURE, notes: [...FIXTURE.notes, '0 Inbox/Mới.md'] }),
    });
    emitServerEvent({ type: 'note:created', path: '0 Inbox/Mới.md', revision: REV });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(within(item('0 Inbox')).getByText('3 ghi chú')).toBeInTheDocument();
    stop();
  });
});
