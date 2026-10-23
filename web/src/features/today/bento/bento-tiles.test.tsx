import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchMock } from '../../../lib/testing/fetch-mock';
import { isoAddDays } from '../../../lib/local-day';
import { project, taskEntry, taskItem, TODAY, todayView } from '../today-test-fixtures';
import { BentoDeadlineTile } from './bento-deadline-tile';
import { BentoProjectsTile } from './bento-projects-tile';
import { BentoTasksTile, bentoTaskRows } from './bento-tasks-tile';
import { dailyNoteDate } from './deadline-detail';
import { setUpBento } from './bento-test-kit';

const noteItem = (title: string, date: string, path: string) => ({
  ...taskItem(title, date, path),
  id: `note:${path}`,
  kind: 'note' as const,
  noteTitle: title,
  line: null,
  lineText: null,
});

describe('Bento "Deadline gần nhất" (F35.4)', () => {
  beforeEach(async () => {
    await setUpBento();
  });

  const tile = () => screen.getByRole('region', { name: 'Deadline gần nhất' });

  it('(F35.4) in 2 days: pill "gấp", the countdown and the note it lives in', () => {
    const item = taskItem('Thi giữa kỳ Giải tích', isoAddDays(TODAY, 2));
    const soon = taskItem('Bản nháp', isoAddDays(TODAY, 5));
    render(
      <BentoDeadlineTile
        view={todayView({ days: { [item.date]: [item], [soon.date]: [soon] } })}
      />,
    );
    expect(within(tile()).getByText('gấp')).toHaveClass('today-pill--urgent');
    expect(tile().querySelector('.today-deadline__count')).toHaveTextContent('2ngày nữa');
    expect(
      within(tile()).getByRole('button', { name: 'Mở ghi chú Thi giữa kỳ Giải tích' }),
    ).toBeInTheDocument();
    expect(tile()).toHaveTextContent('Thứ năm 22/10, Đồ án Giải tích');
  });

  it('(D4) a task in the Daily note of its own day shows the date once', () => {
    const item = {
      ...taskItem('Nộp BT Xác suất', TODAY, `Daily/${TODAY}.md`),
      noteTitle: TODAY,
    };
    render(<BentoDeadlineTile view={todayView({ days: { [TODAY]: [item] } })} />);
    expect(tile().querySelector('.today-deadline__detail')).toHaveTextContent(/^Thứ ba 20\/10$/);
  });

  it.each([
    // [path, note title, detail]
    ['Daily/2026-10-18.md', '2026-10-18', 'Thứ năm 22/10, Daily 18/10'],
    ['1 Projects/Họp.md', 'Họp nhóm 2026-10-22', 'Thứ năm 22/10'],
    ['1 Projects/Họp.md', 'Họp 22/10', 'Thứ năm 22/10'],
    ['1 Projects/Họp.md', 'Họp 2/10', 'Thứ năm 22/10, Họp 2/10'],
    ['1 Projects/Đồ án.md', 'Đồ án Giải tích', 'Thứ năm 22/10, Đồ án Giải tích'],
  ])('(D4) %s titled "%s" reads "%s"', (path, noteTitle, detail) => {
    const item = { ...taskItem('Nộp bài', isoAddDays(TODAY, 2), path), noteTitle };
    render(<BentoDeadlineTile view={todayView({ days: { [item.date]: [item] } })} />);
    expect(tile().querySelector('.today-deadline__detail')).toHaveTextContent(
      new RegExp(`^${detail}$`),
    );
  });

  it('(D4) dailyNoteDate reads the day of a Daily note only', () => {
    expect(dailyNoteDate({ path: 'Daily/2026-10-20.md', noteTitle: 'Thứ ba' })).toBe('2026-10-20');
    expect(dailyNoteDate({ path: 'Inbox/x.md', noteTitle: '2026-10-21' })).toBe('2026-10-21');
    expect(dailyNoteDate({ path: 'Daily/Tuần 1/2026-10-20.md', noteTitle: 'Tuần' })).toBeNull();
    expect(dailyNoteDate({ path: 'Daily/ghi chú.md', noteTitle: 'ghi chú' })).toBeNull();
  });

  it('(F35.4) due today says "Hôm nay" instead of a number', () => {
    const item = taskItem('Nộp BT Xác suất', TODAY);
    render(<BentoDeadlineTile view={todayView({ days: { [TODAY]: [item] } })} />);
    expect(tile().querySelector('.today-deadline__count')).toHaveTextContent(/^Hôm nay$/);
  });

  it('(F35.4) a project deadline counts its open tasks; "sắp" and "ổn" are pastel chips', () => {
    const path = '1 Projects/Đồ án Giải tích.md';
    const item = noteItem('Đồ án Giải tích', isoAddDays(TODAY, 5), path);
    const view = todayView({
      days: { [item.date]: [item] },
      projects: [project({ path, progress: { done: 3, total: 5 } })],
    });
    const { unmount } = render(<BentoDeadlineTile view={view} />);
    expect(within(tile()).getByText('sắp')).toHaveClass('today-pill--soon');
    expect(tile()).toHaveTextContent('Chủ nhật 25/10, 2 việc còn mở');
    unmount();
    const far = taskItem('Báo cáo cuối kỳ', isoAddDays(TODAY, 12));
    render(<BentoDeadlineTile view={todayView({ days: { [far.date]: [far] } })} />);
    expect(within(tile()).getByText('ổn')).toHaveClass('today-pill--ok');
  });

  it('(F35.4) nothing within 14 days, or only overdue items: the sentence and no number', () => {
    const late = taskItem('Bài tuần trước', isoAddDays(TODAY, -3));
    const beyond = taskItem('Rất xa', isoAddDays(TODAY, 14));
    render(
      <BentoDeadlineTile
        view={todayView({ overdue: [late], days: { [beyond.date]: [beyond] } })}
      />,
    );
    expect(tile()).toHaveTextContent('Không có deadline nào trong 14 ngày tới.');
    expect(tile().querySelector('.today-deadline__number')).toBeNull();
    expect(tile().querySelector('.today-pill')).toBeNull();
  });
});

describe('Bento "Hôm nay" tasks (F35.4)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    ({ mock } = await setUpBento());
  });

  const late = taskItem('Đọc chương 3 Giải tích', isoAddDays(TODAY, -1));
  const today = taskItem('Nộp bài tập Xác suất thống kê', TODAY);
  const daily = {
    ...taskEntry(taskItem('Ôn lại công thức Bayes', TODAY, `Daily/${TODAY}.md`)),
    date: null,
    daysLeft: null,
    urgency: null,
  };
  const done = { ...taskEntry(taskItem('Gửi email hỏi thầy', TODAY)), done: true };
  const tasks = [taskEntry(late), taskEntry(today), done, daily];

  it('(F35.4) rows carry their sub-line and the tile counts what is done', () => {
    render(
      <BentoTasksTile tasks={tasks} doneYesterday={0} onItemDone={vi.fn()} refresh={vi.fn()} />,
    );
    const tile = screen.getByRole('region', { name: 'Hôm nay' });
    const rows = within(tile).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.today-task__sub')?.textContent)).toEqual([
      'Quá hạn 1 ngày',
      'Hôm nay, gấp',
      'Đồ án Giải tích',
      'Daily hôm nay',
    ]);
    expect(rows[0]?.querySelector('.today-task__sub')).toHaveClass('today-task__sub--urgent');
    expect(within(tile).getByText('1/4 xong')).toBeInTheDocument();
    expect(within(tile).getByRole('checkbox', { name: 'Gửi email hỏi thầy' })).toBeChecked();
    for (const row of rows) expect(row).toHaveClass('today-task');
    // No real number yesterday: no encouragement line.
    expect(tile.querySelector('.today-tasks__cheer')).toBeNull();
  });

  it('(F35.4) "Hôm qua bạn xong n việc." only when the server counted n > 0', () => {
    const { rerender } = render(
      <BentoTasksTile tasks={tasks} doneYesterday={4} onItemDone={vi.fn()} refresh={vi.fn()} />,
    );
    expect(screen.getByText('Hôm qua bạn xong 4 việc. Giữ nhịp nhé.')).toBeInTheDocument();
    rerender(
      <BentoTasksTile tasks={tasks} doneYesterday={null} onItemDone={vi.fn()} refresh={vi.fn()} />,
    );
    expect(screen.queryByText(/Hôm qua bạn xong/)).toBeNull();
  });

  it('(F10.4) ticking patches that line and reports it once confirmed', async () => {
    const user = userEvent.setup();
    mock.on('PATCH /api/note/task', { body: { revision: 'r2', lineText: '- [x] Nộp bài' } });
    const onItemDone = vi.fn();
    render(
      <BentoTasksTile tasks={tasks} doneYesterday={0} onItemDone={onItemDone} refresh={vi.fn()} />,
    );
    await user.click(screen.getByRole('checkbox', { name: today.title }));
    await waitFor(() => expect(onItemDone).toHaveBeenCalledWith(today.id, true));
    expect(mock.callsTo('PATCH /api/note/task')[0]?.body).toMatchObject({
      path: today.path,
      line: today.line,
      expectedText: today.lineText,
      done: true,
    });
  });

  it('(B11) a busy day shows five rows, overdue first with room for today, then "Xem tất cả n việc"', () => {
    const lateOnes = Array.from({ length: 4 }, (_, i) =>
      taskEntry(taskItem(`Trễ ${i}`, isoAddDays(TODAY, -1 - i))),
    );
    const todays = Array.from({ length: 6 }, (_, i) => taskEntry(taskItem(`Hôm nay ${i}`, TODAY)));
    render(
      <BentoTasksTile
        tasks={[...lateOnes, ...todays]}
        doneYesterday={0}
        onItemDone={vi.fn()}
        refresh={vi.fn()}
      />,
    );
    const tile = screen.getByRole('region', { name: 'Hôm nay' });
    const titles = within(tile)
      .getAllByRole('listitem')
      .map((row) => row.querySelector('.today-task__title')?.textContent);
    expect(titles).toEqual(['Trễ 0', 'Trễ 1', 'Trễ 2', 'Hôm nay 0', 'Hôm nay 1']);
    expect(within(tile).getByRole('link', { name: 'Xem tất cả 4 việc quá hạn' })).toHaveAttribute(
      'href',
      '#/tasks',
    );
    expect(within(tile).getByRole('link', { name: 'Xem tất cả 10 việc' })).toHaveAttribute(
      'href',
      '#/tasks',
    );
    expect(within(tile).getByText('0/10 xong')).toBeInTheDocument();
  });

  it('(B11) row budget: overdue never takes the last two rows from today', () => {
    expect(bentoTaskRows(0, 3)).toEqual({ overdue: 0, rest: 3 });
    expect(bentoTaskRows(0, 9)).toEqual({ overdue: 0, rest: 5 });
    expect(bentoTaskRows(9, 0)).toEqual({ overdue: 5, rest: 0 });
    expect(bentoTaskRows(9, 1)).toEqual({ overdue: 4, rest: 1 });
    expect(bentoTaskRows(2, 9)).toEqual({ overdue: 2, rest: 3 });
    expect(bentoTaskRows(6, 6)).toEqual({ overdue: 3, rest: 2 });
  });

  it('an empty day invites', () => {
    render(<BentoTasksTile tasks={[]} doneYesterday={2} onItemDone={vi.fn()} refresh={vi.fn()} />);
    expect(
      screen.getByText('Hôm nay chưa có việc nào. Nhớ ra việc gì thì gõ vào Ghi nhanh nhé.'),
    ).toBeInTheDocument();
  });
});

describe('Bento "Đồ án đang làm" (F35.4, F10.5)', () => {
  beforeEach(async () => {
    await setUpBento();
  });

  const projects = [
    project({
      path: '1 Projects/A.md',
      title: 'Đồ án Giải tích',
      progress: { done: 3, total: 5 },
      daysLeft: 12,
    }),
    project({
      path: '1 Projects/B.md',
      title: 'Research gap',
      progress: null,
      daysLeft: null,
      deadline: null,
    }),
    project({ path: '1 Projects/C.md', title: 'Web bán hàng', progress: { done: 1, total: 4 } }),
    project({ path: '1 Projects/D.md', title: 'Đồ án Xác suất', progress: { done: 2, total: 2 } }),
  ];

  it('(F35.4) two rings with %, "chưa có việc" without tasks, then "Xem thêm n đồ án"', async () => {
    const user = userEvent.setup();
    render(<BentoProjectsTile projects={projects} onMarkedDone={vi.fn()} refresh={vi.fn()} />);
    const tile = screen.getByRole('region', { name: 'Đồ án đang làm' });
    const ring = within(tile).getByRole('img', {
      name: 'Tiến độ Đồ án Giải tích: 60 phần trăm, 3/5 việc',
    });
    expect(ring).toHaveTextContent('60%');
    expect(within(tile).getByText('còn 12 ngày')).toBeInTheDocument();
    expect(within(tile).getByText('chưa có việc')).toBeInTheDocument();
    expect(within(tile).getByText('chưa đặt hạn')).toBeInTheDocument();
    expect(within(tile).getAllByRole('listitem')).toHaveLength(2);

    await user.click(within(tile).getByRole('button', { name: 'Xem thêm 2 đồ án' }));
    expect(within(tile).getAllByRole('listitem')).toHaveLength(4);
    expect(within(tile).getByRole('button', { name: 'Web bán hàng' })).toHaveFocus();
    // All tasks of a project done: the one-time offer, as on calm Today.
    expect(tile).toHaveTextContent('“Đồ án Xác suất” xong hết việc rồi. Đánh dấu dự án xong?');
    await user.click(within(tile).getByRole('button', { name: 'Để sau' }));
    expect(tile).not.toHaveTextContent('Đánh dấu dự án xong?');
  });

  it('empty: the invitation from the calm screen', () => {
    render(<BentoProjectsTile projects={[]} onMarkedDone={vi.fn()} refresh={vi.fn()} />);
    expect(screen.getByText('Chưa có đồ án nào. Tạo một cái từ mẫu Đồ án?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tạo' })).toBeInTheDocument();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
