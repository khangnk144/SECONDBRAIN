import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskEntry, TaskGroups } from '../../lib/api/deadlines-types';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { useVaultStore } from '../../lib/vault-store';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { taskEntry, taskItem } from '../today/today-test-fixtures';
import { TasksScreen } from './tasks-screen';

const undated = (title: string, line: number): TaskEntry => ({
  ...taskEntry(taskItem(title, '2026-10-20')),
  id: `task:2 Areas/Xác suất thống kê.md#${line}`,
  path: '2 Areas/Xác suất thống kê.md',
  noteTitle: 'Xác suất thống kê',
  line,
  date: null,
  urgency: null,
  daysLeft: null,
});

const late = taskEntry(taskItem('Bài tập tuần trước', '2026-10-18'));
const today = taskEntry(taskItem('Làm BT1 Giải tích', '2026-10-20'));
const soon = taskEntry(taskItem('Nộp bản nháp', '2026-10-24'));
const someday = undated('Đọc thêm chương 4', 12);
const archived = {
  ...taskEntry(taskItem('Việc cũ trong Archive', '2026-11-30')),
  class: 'archived' as const,
};

const GROUPS: TaskGroups = {
  overdue: [late],
  today: [today],
  next7: [soon],
  later: [],
  noDate: [someday],
};

describe('"Việc cần làm" view (F9)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
    mock.on('GET /api/tasks', (call) => ({
      body: call.query.get('includeArchive') === 'true' ? { ...GROUPS, later: [archived] } : GROUPS,
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('groups in order with their counts; empty groups stay hidden', async () => {
    render(<TasksScreen />);
    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      'Quá hạn 1 việc',
      'Hôm nay 1 việc',
      '7 ngày tới 1 việc',
      'Không có hạn 1 việc',
    ]);
    const overdue = screen.getByRole('region', { name: 'Quá hạn 1 việc' });
    expect(within(overdue).getByRole('checkbox', { name: late.title })).toBeInTheDocument();
    expect(within(overdue).getByText(late.noteTitle)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Sau/ })).toBeNull();
  });

  it('"Bao gồm Archive" asks for archived tasks and is remembered per vault', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TasksScreen />);
    await screen.findByRole('heading', { name: /^Quá hạn/ });
    await user.click(screen.getByRole('checkbox', { name: 'Bao gồm Archive' }));
    expect(await screen.findByText(archived.title)).toBeInTheDocument();
    expect(mock.calls.at(-1)?.query.get('includeArchive')).toBe('true');
    unmount();

    render(<TasksScreen />);
    expect(screen.getByRole('checkbox', { name: 'Bao gồm Archive' })).toBeChecked();
    expect(await screen.findByText(archived.title)).toBeInTheDocument();
    act(() => useVaultStore.setState({ vaultId: 'vault-b' }));
    expect(screen.getByRole('checkbox', { name: 'Bao gồm Archive' })).not.toBeChecked();
  });

  it('Tab goes through the rows and Space ticks; the ticked row stays, dimmed, for the visit and can be unticked', async () => {
    const user = userEvent.setup();
    mock.on('PATCH /api/note/task', (call) => {
      const done = (call.body as { done: boolean }).done;
      return { body: { revision: done ? 'r2' : 'r3', lineText: done ? '- [x] x' : '- [ ] x' } };
    });
    const { unmount } = render(<TasksScreen />);
    await screen.findByRole('heading', { name: /^Quá hạn/ });
    await user.tab(); // the archive toggle
    await user.tab();
    const box = () => screen.getByRole('checkbox', { name: late.title });
    expect(box()).toHaveFocus();
    await user.keyboard(' ');
    await waitFor(() => expect(mock.callsTo('PATCH /api/note/task')).toHaveLength(1));
    expect(mock.callsTo('PATCH /api/note/task')[0]?.body).toMatchObject({
      line: late.line,
      done: true,
    });

    // The fresh list leaves the done task out; the row stays where it was, checked and dimmed.
    mock.on('GET /api/tasks', { body: { ...GROUPS, overdue: [] } });
    act(() => emitServerEvent({ type: 'note:changed', path: late.path, revision: 'r2' }));
    await waitFor(() => expect(mock.callsTo('GET /api/tasks')).toHaveLength(2));
    expect(box()).toBeChecked();
    expect(box()).toHaveFocus();
    expect(box().closest('li')).toHaveClass('is-done');
    expect(screen.getByRole('heading', { name: 'Quá hạn 0 việc' })).toBeInTheDocument();

    // A mis-tick is undone right there, with the revision the tick left.
    mock.on('GET /api/tasks', () => new Promise(() => undefined));
    await user.keyboard(' ');
    await waitFor(() => expect(mock.callsTo('PATCH /api/note/task')).toHaveLength(2));
    expect(mock.callsTo('PATCH /api/note/task')[1]?.body).toMatchObject({
      expectedRevision: 'r2',
      done: false,
    });
    expect(box()).not.toBeChecked();
    expect(screen.getByRole('heading', { name: 'Quá hạn 1 việc' })).toBeInTheDocument();

    // The next visit shows the server's list only.
    unmount();
    mock.on('GET /api/tasks', { body: { ...GROUPS, overdue: [] } });
    render(<TasksScreen />);
    await screen.findByRole('heading', { name: /^Hôm nay/ });
    expect(screen.queryByRole('checkbox', { name: late.title })).toBeNull();
  });

  it('a row that leaves (ticked elsewhere) hands focus to the next row', async () => {
    render(<TasksScreen />);
    const box = await screen.findByRole('checkbox', { name: late.title });
    act(() => box.focus());
    mock.on('GET /api/tasks', { body: { ...GROUPS, overdue: [] } });
    act(() => emitServerEvent({ type: 'note:changed', path: late.path, revision: 'r2' }));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: late.title })).toBeNull());
    expect(screen.getByRole('checkbox', { name: today.title })).toHaveFocus();
  });

  it('with nothing left it says so kindly', async () => {
    mock.on('GET /api/tasks', {
      body: { overdue: [], today: [], next7: [], later: [], noDate: [] },
    });
    render(<TasksScreen />);
    expect(await screen.findByText('Không còn việc nào. Nhẹ cả người!')).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 2 })).toEqual([]);
  });
});
