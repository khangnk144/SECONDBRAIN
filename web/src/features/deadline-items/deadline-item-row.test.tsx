import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import type { DeadlineItem, TaskEntry } from '../../lib/api/deadlines-types';
import { useTabsStore } from '../../lib/tabs-store';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { DeadlineItemRow } from './deadline-item-row';
import { dueLabel } from './urgency-label';

const NOTE = '1 Projects/Đồ án Giải tích.md';

const task: TaskEntry = {
  id: `task:${NOTE}#9`,
  title: 'Nộp bản nháp cho thầy hướng dẫn trước buổi họp nhóm',
  path: NOTE,
  noteTitle: 'Đồ án Giải tích',
  line: 9,
  lineText: '- [ ] Nộp bản nháp cho thầy hướng dẫn trước buổi họp nhóm 📅 2026-10-21',
  done: false,
  date: '2026-10-21',
  urgency: 'urgent',
  daysLeft: 2,
  class: 'user',
  revision: 'r1',
};

const noteItem: DeadlineItem = {
  id: `note:${NOTE}`,
  kind: 'note',
  title: 'Đồ án Giải tích',
  date: '2026-10-31',
  path: NOTE,
  noteTitle: 'Đồ án Giải tích',
  line: null,
  lineText: null,
  done: false,
  urgency: 'ok',
  daysLeft: 12,
  class: 'user',
  revision: 'r1',
};

function renderRow(props: Parameters<typeof DeadlineItemRow>[0]) {
  return render(
    <ul>
      <DeadlineItemRow {...props} />
    </ul>,
  );
}

describe('deadline item row (F9.1, F10.3)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('relative due text in both languages, never colour alone', async () => {
    expect([0, 1, 5, -2].map((d) => dueLabel(d, i18n.t))).toEqual([
      'hôm nay',
      'ngày mai',
      'còn 5 ngày',
      'quá hạn 2 ngày',
    ]);
    await i18n.changeLanguage('en');
    expect([1, 2, -1].map((d) => dueLabel(d, i18n.t))).toEqual([
      'tomorrow',
      '2 days left',
      '1 day overdue',
    ]);
    await i18n.changeLanguage('vi');
  });

  it('a real checkbox named by the title; Space ticks optimistically and calls onDone', async () => {
    const user = userEvent.setup();
    mock.on('PATCH /api/note/task', { body: { revision: 'r2', lineText: 'x' } });
    const onDone = vi.fn();
    renderRow({ item: task, showNoteTitle: true, onDone });
    const box = screen.getByRole('checkbox', { name: task.title });
    expect(screen.getByText('còn 2 ngày')).toHaveClass('deadline-row__due--urgent');
    expect(screen.getByText('Đồ án Giải tích')).toBeInTheDocument();
    box.focus();
    await user.keyboard(' ');
    expect(box).toBeChecked();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(mock.callsTo('PATCH /api/note/task')[0]?.body).toMatchObject({ line: 9, done: true });
  });

  it('flips back when the tick meets a conflict, and the parent list is asked to reload', async () => {
    const user = userEvent.setup();
    mock.on('PATCH /api/note/task', apiError(409, 'CONFLICT', { reason: 'revision' }));
    const refresh = vi.fn();
    const onDone = vi.fn();
    renderRow({ item: task, refresh, onDone });
    const box = screen.getByRole('checkbox', { name: task.title });
    await user.click(box);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(box).not.toBeChecked();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('a note-deadline item ticks through the note status', async () => {
    const user = userEvent.setup();
    mock.on('PATCH /api/note/frontmatter', { body: { revision: 'r2', content: '' } });
    renderRow({ item: noteItem });
    await user.click(screen.getByRole('checkbox', { name: 'Đồ án Giải tích' }));
    await waitFor(() =>
      expect(mock.callsTo('PATCH /api/note/frontmatter')[0]?.body).toEqual({
        path: NOTE,
        expectedRevision: 'r1',
        set: { status: 'done' },
      }),
    );
  });

  it('the title is the "open note" control: plain opens the line; Ctrl+click and middle click open a new tab', async () => {
    const user = userEvent.setup();
    renderRow({ item: task, showNoteTitle: true });
    const open = screen.getByRole('button', { name: `Mở ghi chú ${task.title}` });
    expect(open).toHaveTextContent(task.title);
    expect(open).toHaveAccessibleDescription('Đồ án Giải tích');
    expect(screen.getAllByRole('button')).toEqual([open]); // no separate "Mở ghi chú" button
    const otherTab = () =>
      useTabsStore.setState({
        tabs: [{ id: 't1', path: '0 Inbox/Khác.md', lastActive: 1 }],
        activeId: 't1',
      });
    const paths = () => useTabsStore.getState().tabs.map((tab) => tab.path);

    otherTab();
    open.focus();
    await user.keyboard('{Enter}');
    expect(paths()).toEqual([NOTE]); // plain open replaces the current tab
    otherTab();
    fireEvent.click(open, { ctrlKey: true });
    expect(paths()).toEqual(['0 Inbox/Khác.md', NOTE]);
    otherTab();
    fireEvent(open, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(paths()).toEqual(['0 Inbox/Khác.md', NOTE]);
  });

  it('shows the full title in a tooltip on hover or focus only when it is cut', () => {
    renderRow({ item: task });
    const row = screen.getByRole('listitem');
    fireEvent.mouseEnter(row);
    expect(row.querySelector('.deadline-row__tooltip')).toBeNull();
    const title = row.querySelector('.deadline-row__title') as HTMLElement;
    Object.defineProperty(title, 'scrollWidth', { configurable: true, value: 600 });
    Object.defineProperty(title, 'clientWidth', { configurable: true, value: 200 });
    act(() => screen.getByRole('checkbox').focus());
    expect(row.querySelector('.deadline-row__tooltip')).toHaveTextContent(task.title);
    fireEvent.keyDown(row, { key: 'Escape' });
    expect(row.querySelector('.deadline-row__tooltip')).toBeNull();
  });

  it('a tooltip that would be cut off at the bottom of a scrolling list opens upward', () => {
    const rect = (top: number, height: number) =>
      ({ top, bottom: top + height, left: 0, right: 300, width: 300, height }) as DOMRect;
    let rowTop = 150;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('scroll-box')) return rect(0, 200);
      if (this.classList.contains('deadline-row')) return rect(rowTop, 32);
      if (this.classList.contains('deadline-row__tooltip')) return rect(0, 60);
      return rect(0, 0);
    });
    const show = (row: HTMLElement) => {
      const title = row.querySelector('.deadline-row__title') as HTMLElement;
      Object.defineProperty(title, 'scrollWidth', { configurable: true, value: 600 });
      Object.defineProperty(title, 'clientWidth', { configurable: true, value: 200 });
      fireEvent.mouseEnter(row);
      return row.querySelector('.deadline-row__tooltip');
    };
    const { unmount } = render(
      <div className="scroll-box" style={{ overflowY: 'auto' }}>
        <ul>
          <DeadlineItemRow item={task} />
        </ul>
      </div>,
    );
    // Near the bottom of the box: 60 px do not fit below, they do above.
    expect(show(screen.getByRole('listitem'))).toHaveClass('deadline-row__tooltip--above');
    unmount();
    rowTop = 10;
    render(
      <div className="scroll-box" style={{ overflowY: 'auto' }}>
        <ul>
          <DeadlineItemRow item={task} />
        </ul>
      </div>,
    );
    expect(show(screen.getByRole('listitem'))).not.toHaveClass('deadline-row__tooltip--above');
  });

  it("a ticked row's tooltip sits at row level, outside the dimmed text, and closes once the title fits", async () => {
    const user = userEvent.setup();
    mock.on('PATCH /api/note/task', { body: { revision: 'r2', lineText: 'x' } });
    renderRow({ item: task });
    const row = screen.getByRole('listitem');
    const title = row.querySelector('.deadline-row__title') as HTMLElement;
    Object.defineProperty(title, 'scrollWidth', { configurable: true, value: 600 });
    Object.defineProperty(title, 'clientWidth', { configurable: true, value: 200 });
    const box = screen.getByRole('checkbox', { name: task.title });
    act(() => box.focus());
    const tooltip = row.querySelector('.deadline-row__tooltip');
    expect(tooltip?.parentElement).toBe(row);
    expect(row).toHaveClass('has-tooltip');
    // Ticked by keyboard: the row dims, the tooltip stays a direct child of the row.
    await user.keyboard(' ');
    expect(row).toHaveClass('is-done');
    expect(row.querySelector('.deadline-row__tooltip')?.parentElement).toBe(row);
    // The due text went away and the title fits now: nothing more to show.
    Object.defineProperty(title, 'scrollWidth', { configurable: true, value: 200 });
    await user.click(box);
    await waitFor(() => expect(row.querySelector('.deadline-row__tooltip')).toBeNull());
  });

  it('a done item is checked, dimmed and shows no urgency', () => {
    renderRow({ item: { ...task, done: true, urgency: 'done' } });
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('listitem')).toHaveClass('is-done');
    expect(screen.queryByText('còn 2 ngày')).toBeNull();
  });
});
