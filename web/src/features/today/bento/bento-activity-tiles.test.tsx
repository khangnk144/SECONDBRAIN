import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Navigator } from '../../../lib/app-navigation';
import type { FetchMock } from '../../../lib/testing/fetch-mock';
import { BentoBrainTile } from './bento-brain-tile';
import { BentoCaptureTile } from './bento-capture-tile';
import { activity, brain } from './bento-test-kit';
import { setUpBento } from './bento-test-kit';
import { BentoWritingTile } from './bento-writing-tile';

const NODES = [
  { path: '1 Projects/Đồ án Giải tích.md', title: 'Đồ án Giải tích', group: 'projects' as const },
  { path: '2 Areas/Giải tích 1.md', title: 'Giải tích 1', group: 'areas' as const },
  { path: 'wiki/Ma trận.md', title: 'Ma trận', group: 'wiki' as const },
  { path: 'Daily/2026-10-20.md', title: '2026-10-20', group: 'daily' as const },
  { path: '3 Resources/Bài báo.md', title: 'Bài báo', group: 'resources' as const },
  { path: '0 Inbox/Ý tưởng.md', title: 'Ý tưởng', group: 'other' as const },
];
const EDGES = [
  { from: '2 Areas/Giải tích 1.md', to: '1 Projects/Đồ án Giải tích.md' },
  { from: 'wiki/Ma trận.md', to: '2 Areas/Giải tích 1.md' },
];

let mock: FetchMock;
let navigate: Navigator;
beforeEach(async () => {
  ({ mock, navigate } = await setUpBento());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Bento "Não hôm nay" (F24.4)', () => {
  // The region is named by the title alone; the link says it opens the map (E2E D5).
  const tile = () => screen.getByRole('region', { name: 'Não hôm nay' });

  it("(F24.4) shows the server's counts as chips, the map with a text equivalent, and links to today's map", async () => {
    const user = userEvent.setup();
    const today = activity([0, 0, 0, 0, 0, 0, 3], {
      brain: brain({
        notesNew: 1,
        notesTouched: 3,
        linksAdded: 7,
        aiTouched: 2,
        nodes: NODES,
        edges: EDGES,
      }),
    });
    render(<BentoBrainTile activity={today} loading={false} />);
    const chips = within(tile())
      .getAllByRole('listitem')
      .map((chip) => chip.textContent);
    expect(chips).toEqual(['+3 ghi chú', '+7 liên kết', 'AI cập nhật 2 trang']);
    const map = within(tile()).getByRole('img', { name: 'Chòm sao 6 ghi chú chạm hôm nay' });
    expect(map.querySelectorAll('circle')).toHaveLength(6);
    expect(map.querySelectorAll('line')).toHaveLength(2);
    expect(map.querySelector('.brain-map__node--projects')).not.toBeNull();
    expect(tile()).toHaveTextContent(
      'Ghi chú hôm nay: Đồ án Giải tích, Giải tích 1, Ma trận, 2026-10-20, Bài báo và 1 ghi chú khác.',
    );
    const link = within(tile()).getByRole('link', { name: 'Não hôm nay, mở Bản đồ não' });
    expect(link).toHaveAttribute('href', '#/graph?when=today');
    expect(link.getAttribute('aria-label')).not.toMatch(/\s,/);
    expect(tile().querySelector('.visually-hidden:not(p)')).toBeNull();
    await user.click(link);
    expect(navigate).toHaveBeenCalledWith('/graph?when=today', undefined);
  });

  it('(F24.4) no AI chip at 0; a quiet day invites; unreadable activity says so', () => {
    const quiet = activity();
    const { rerender } = render(
      <BentoBrainTile
        activity={activity([0, 0, 0, 0, 0, 0, 1], {
          brain: brain({ notesTouched: 1, nodes: NODES.slice(0, 1) }),
        })}
        loading={false}
      />,
    );
    expect(
      within(tile())
        .getAllByRole('listitem')
        .map((c) => c.textContent),
    ).toEqual(['+1 ghi chú', '+0 liên kết']);
    rerender(<BentoBrainTile activity={quiet} loading={false} />);
    expect(tile()).toHaveTextContent('Hôm nay chưa chạm ghi chú nào. Viết gì đó nhé?');
    expect(within(tile()).queryByRole('img')).toBeNull();
    rerender(<BentoBrainTile activity={null} loading={false} />);
    expect(tile()).toHaveTextContent('Chưa đọc được hoạt động gần đây. Bạn thử tải lại trang nhé.');
  });

  it('the map is the same picture for the same notes (seeded layout)', () => {
    const today = activity(undefined, {
      brain: brain({ notesTouched: 6, nodes: NODES, edges: EDGES }),
    });
    const first = render(<BentoBrainTile activity={today} loading={false} />);
    const picture = first.container.querySelector('svg')?.innerHTML;
    first.unmount();
    const again = render(<BentoBrainTile activity={structuredClone(today)} loading={false} />);
    expect(again.container.querySelector('svg')?.innerHTML).toBe(picture);
  });
});

describe('Bento "7 ngày ghi chép" (F35.4)', () => {
  it('(F35.4) seven bars, today in the accent, and a name that reads all seven numbers', () => {
    render(<BentoWritingTile activity={activity([2, 4, 1, 5, 3, 6, 3])} loading={false} />);
    const chart = screen.getByRole('img', {
      name:
        'Số ghi chú tạo hoặc sửa mỗi ngày trong 7 ngày qua: thứ tư: 2 ghi chú, thứ năm: 4 ghi chú, ' +
        'thứ sáu: 1 ghi chú, thứ bảy: 5 ghi chú, chủ nhật: 3 ghi chú, thứ hai: 6 ghi chú, ' +
        'hôm nay: 3 ghi chú.',
    });
    const bars = chart.querySelectorAll<HTMLElement>('.today-bars__bar');
    expect(bars).toHaveLength(7);
    expect(bars[6]).toHaveClass('is-today');
    expect(bars[5]?.style.getPropertyValue('--bar-h')).toBe('56px');
    expect(bars[2]?.style.getPropertyValue('--bar-h')).toBe(`${6 + 50 / 6}px`);
    expect(chart).toHaveTextContent('T4T5T6T7CNT2T3');
  });

  it('(F35.4) a week without writing is a sentence, not seven stubs', () => {
    render(<BentoWritingTile activity={activity()} loading={false} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(
      screen.getByText('7 ngày qua chưa có ghi chép nào. Bắt đầu một ghi chú nhé?'),
    ).toBeInTheDocument();
  });
});

describe('Bento "Ghi nhanh" (F35.4, F12)', () => {
  const field = () => screen.getByRole('textbox', { name: 'Ghi nhanh' });

  it('(F35.4) Enter saves to Inbox; the square "+" saves too; the hint names Alt+Q', async () => {
    const user = userEvent.setup();
    mock.on('POST /api/capture', {
      status: 201,
      body: { path: '0 Inbox/Ý tưởng.md', revision: 'r1' },
    });
    render(<BentoCaptureTile />);
    expect(field()).toHaveAttribute('placeholder', 'Gõ gì đó rồi Enter…');
    expect(screen.getByText(/ở bất cứ đâu\./)).toHaveTextContent(
      'Lưu vào Inbox. Alt+Q ở bất cứ đâu.',
    );
    await user.click(field());
    await user.keyboard('Ý tưởng đồ án{Enter}');
    await waitFor(() => expect(field()).toHaveValue(''));
    expect(mock.callsTo('POST /api/capture')[0]?.body).toEqual({ text: 'Ý tưởng đồ án' });
    expect(field()).toHaveFocus();

    const save = screen.getByRole('button', { name: 'Lưu vào Inbox' });
    expect(save).toHaveAttribute('aria-disabled', 'true');
    await user.type(field(), 'Gọi cho nhóm');
    await user.click(save);
    await waitFor(() => expect(mock.callsTo('POST /api/capture')).toHaveLength(2));
    expect(mock.callsTo('POST /api/capture')[1]?.body).toEqual({ text: 'Gọi cho nhóm' });
  });
});
