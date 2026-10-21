import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { apiError, type FetchMock } from '../../lib/testing/fetch-mock';
import { useToastStore } from '../../lib/toast-store';
import {
  cellTitles,
  dayCell,
  doneTask,
  fakeDataTransfer,
  makeView,
  mockCalendar,
  octoberView,
  PROJECT,
  projectDeadline,
  quiz,
  renderCalendar,
  setupCalendarTest,
  submitDraft,
  teardownCalendarTest,
} from './__tests__/calendar-fixtures';

function itemIn(date: string, id: string): HTMLElement {
  const item = dayCell(date).querySelector<HTMLElement>(`[data-item-id="${id}"]`);
  if (!item) throw new Error(`no ${id} on ${date}`);
  return item;
}

/** Drags the item from `from` and drops it on the day `to`. */
function dragItem(from: string, id: string, to: string) {
  const dataTransfer = fakeDataTransfer();
  const source = itemIn(from, id);
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragEnter(dayCell(to), { dataTransfer });
  fireEvent.dragOver(dayCell(to), { dataTransfer });
  return { dataTransfer, drop: () => fireEvent.drop(dayCell(to), { dataTransfer }) };
}

describe('rescheduling from the calendar (F11.2)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    mock = await setupCalendarTest();
    mockCalendar(mock, { '2026-10': octoberView });
    mock.on('POST /api/note/reschedule', { body: { revision: 'rev-2', journalId: 'j-1' } });
  });
  afterEach(teardownCalendarTest);

  it('dropping a task on another day posts only that date once, moves it and offers undo', async () => {
    renderCalendar('/calendar');
    await waitFor(() => expect(cellTitles('2026-10-23')).toEqual([quiz.title]));
    const { dataTransfer, drop } = dragItem('2026-10-20', submitDraft.id, '2026-10-27');
    expect(dataTransfer.data.get('text/plain')).toBe(submitDraft.title);
    expect(dayCell('2026-10-27')).toHaveClass('is-drop-target');
    expect(itemIn('2026-10-20', submitDraft.id)).toHaveClass('is-dragging');
    drop();

    // Moved on screen at once, before the server answered.
    expect(cellTitles('2026-10-27')).toEqual([submitDraft.title]);
    expect(dayCell('2026-10-27')).not.toHaveClass('is-drop-target');
    await waitFor(() => expect(mock.callsTo('POST /api/note/reschedule')).toHaveLength(1));
    expect(mock.callsTo('POST /api/note/reschedule')[0]?.body).toEqual({
      path: PROJECT,
      expectedRevision: 'rev-1',
      target: { kind: 'task', line: 12, expectedText: submitDraft.lineText },
      date: '2026-10-27',
    });
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const toast = useToastStore.getState().toasts[0];
    expect(toast?.message).toBe('Đã dời “Nộp bản nháp chương 2” sang 27/10/2026.');
    expect(toast?.action?.label).toBe('Hoàn tác');
    expect(toast?.durationMs).toBe(10_000);
    // The month reloads for the new revision.
    await waitFor(() => expect(mock.callsTo('GET /api/calendar')).toHaveLength(2));
  });

  it('a note deadline moves through its `deadline:` value (note target)', async () => {
    renderCalendar('/calendar');
    await waitFor(() => expect(cellTitles('2026-10-20')).toHaveLength(3));
    dragItem('2026-10-20', projectDeadline.id, '2026-10-30').drop();
    await waitFor(() => expect(mock.callsTo('POST /api/note/reschedule')).toHaveLength(1));
    expect(mock.callsTo('POST /api/note/reschedule')[0]?.body).toEqual({
      path: PROJECT,
      expectedRevision: 'rev-1',
      target: { kind: 'note' },
      date: '2026-10-30',
    });
  });

  it('the same day refuses the drop; done items cannot be dragged', async () => {
    renderCalendar('/calendar');
    await waitFor(() => expect(cellTitles('2026-10-20')).toHaveLength(3));
    const same = dragItem('2026-10-20', submitDraft.id, '2026-10-20');
    expect(dayCell('2026-10-20')).not.toHaveClass('is-drop-target');
    same.drop();
    fireEvent.dragEnd(itemIn('2026-10-20', submitDraft.id));
    expect(itemIn('2026-10-20', doneTask.id)).toHaveAttribute('draggable', 'false');
    fireEvent.dragStart(itemIn('2026-10-20', doneTask.id), { dataTransfer: fakeDataTransfer() });
    fireEvent.dragOver(dayCell('2026-10-27'));
    fireEvent.drop(dayCell('2026-10-27'));
    expect(cellTitles('2026-10-27')).toEqual([]);
    expect(mock.callsTo('POST /api/note/reschedule')).toHaveLength(0);
  });

  it('a conflict says which note changed, puts the item back from the server and offers no undo', async () => {
    mock.on(
      'POST /api/note/reschedule',
      apiError(409, 'CONFLICT', { path: PROJECT, reason: 'revision', currentRevision: 'rev-9' }),
    );
    renderCalendar('/calendar');
    await waitFor(() => expect(cellTitles('2026-10-23')).toEqual([quiz.title]));
    dragItem('2026-10-23', quiz.id, '2026-10-26').drop();
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const toast = useToastStore.getState().toasts[0];
    expect(toast?.message).toBe(
      '“Đồ án Giải tích” vừa thay đổi. Mình đã tải lại danh sách, bạn thử lại nhé.',
    );
    expect(toast?.tone).toBe('error');
    expect(toast?.action).toBeUndefined();
    await waitFor(() => expect(cellTitles('2026-10-23')).toEqual([quiz.title]));
    expect(cellTitles('2026-10-26')).toEqual([]);
    expect(mock.callsTo('GET /api/calendar').length).toBeGreaterThanOrEqual(2);
  });

  it('"Dời ngày…" in the day pane goes through the date picker and the same request', async () => {
    const user = userEvent.setup();
    let moved = false;
    mockCalendar(mock, {
      '2026-10': () =>
        moved
          ? makeView('2026-10', { '2026-11-02': [{ ...quiz, date: '2026-11-02' }] })
          : octoberView(false),
    });
    mock.on('POST /api/note/reschedule', () => {
      moved = true;
      return { body: { revision: 'rev-2', journalId: 'j-2' } };
    });
    renderCalendar('/calendar?month=2026-10&day=2026-10-23');
    const pane = screen.getByRole('complementary', { name: 'Ngăn phải' });
    await user.click(
      await within(pane).findByRole('button', { name: `Thao tác với “${quiz.title}”` }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Dời ngày…' }));
    const dialog = screen.getByRole('dialog', { name: `Dời “${quiz.title}” sang ngày` });
    const field = within(dialog).getByRole('textbox');
    await user.clear(field);
    await user.type(field, '02/11/2026');
    await user.click(within(dialog).getByRole('button', { name: 'Dời ngày' }));
    await waitFor(() => expect(mock.callsTo('POST /api/note/reschedule')).toHaveLength(1));
    expect(mock.callsTo('POST /api/note/reschedule')[0]?.body).toEqual({
      path: PROJECT,
      expectedRevision: 'rev-1',
      target: { kind: 'task', line: 20, expectedText: quiz.lineText },
      date: '2026-11-02',
    });
    expect(useToastStore.getState().toasts[0]?.action?.label).toBe('Hoàn tác');
    // The item left the day, and focus stayed in the pane.
    await waitFor(() =>
      expect(within(pane).getByText('Ngày này chưa có việc nào.')).toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(
      within(pane).getByRole('heading', { level: 2, name: 'Thứ sáu, 23 tháng 10, 2026' }),
    );
  });
});
