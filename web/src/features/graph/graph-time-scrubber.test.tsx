import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { GraphTimeScrubber, type GraphTimeScrubberProps } from './graph-time-scrubber';

const WEEKS = ['2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
/** Notes on the map at the end of each week. */
const NOTES = [1, 3, 3, 5];

function Harness(props: Partial<GraphTimeScrubberProps> & { onWeek?: (w: number) => void }) {
  const [position, setPosition] = useState(props.position ?? WEEKS.length - 1);
  return (
    <GraphTimeScrubber
      weeks={props.weeks ?? WEEKS}
      position={position}
      onChange={(w) => {
        props.onWeek?.(w);
        setPosition(w);
      }}
      counts={{ notes: NOTES[position] ?? 0, links: position }}
      playing={props.playing ?? false}
      onPlay={props.onPlay ?? (() => undefined)}
      onStop={props.onStop ?? (() => undefined)}
      reducedMotion={props.reducedMotion ?? false}
      approximate={props.approximate ?? false}
    />
  );
}

const slider = () => screen.getByRole('slider', { name: 'Tuần đang xem' });

describe('time scrubber (F24.1)', () => {
  beforeEach(async () => {
    await resetAppState();
  });

  it('(F24.1) labels the week with its Monday and "n ghi chú, m liên kết"; the last week is now', () => {
    render(<Harness />);
    const region = screen.getByRole('region', { name: 'Tua thời gian' });
    expect(region).toHaveTextContent('Tuần 19/10/2026, bây giờ');
    expect(region).toHaveTextContent('5 ghi chú, 3 liên kết');
    expect(slider()).toHaveAttribute(
      'aria-valuetext',
      'Tuần 19/10/2026, bây giờ: 5 ghi chú, 3 liên kết',
    );
    expect(slider()).toHaveAttribute('max', '3');
  });

  it('(F24.1) ← / → move one week, Home / End go to the first week and back to now', () => {
    const onWeek = vi.fn();
    render(<Harness onWeek={onWeek} />);
    fireEvent.keyDown(slider(), { key: 'ArrowLeft' });
    expect(slider()).toHaveValue('2');
    expect(screen.getByText('Tuần 12/10/2026')).toBeInTheDocument();
    fireEvent.keyDown(slider(), { key: 'Home' });
    expect(slider()).toHaveValue('0');
    expect(slider()).toHaveAttribute('aria-valuetext', 'Tuần 28/09/2026: 1 ghi chú, 0 liên kết');
    fireEvent.keyDown(slider(), { key: 'ArrowLeft' });
    expect(slider()).toHaveValue('0');
    fireEvent.keyDown(slider(), { key: 'ArrowRight' });
    expect(slider()).toHaveValue('1');
    fireEvent.keyDown(slider(), { key: 'End' });
    expect(slider()).toHaveValue('3');
    fireEvent.keyDown(slider(), { key: 'PageDown' });
    expect(slider()).toHaveValue('0');
    expect(onWeek.mock.calls.map(([w]) => w)).toEqual([2, 0, 0, 1, 3, 0]);
  });

  it('(F24.1) "Phát" plays, "Dừng" stops', async () => {
    const user = userEvent.setup();
    const onPlay = vi.fn();
    const onStop = vi.fn();
    const { rerender } = render(<Harness onPlay={onPlay} onStop={onStop} />);
    await user.click(screen.getByRole('button', { name: 'Phát' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    rerender(<Harness onPlay={onPlay} onStop={onStop} playing />);
    await user.click(screen.getByRole('button', { name: 'Dừng' }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('(F24.1) reduced motion: "Phát" is off and a sentence says why; the keys still work', () => {
    render(<Harness reducedMotion />);
    const play = screen.getByRole('button', { name: 'Phát' });
    expect(play).toBeDisabled();
    expect(play).toHaveAccessibleDescription(/giảm chuyển động/);
    fireEvent.keyDown(slider(), { key: 'ArrowLeft' });
    expect(slider()).toHaveValue('2');
  });

  it('(F24.1) weeks before the app watched the vault say their history is estimated', () => {
    render(<Harness approximate position={0} />);
    expect(screen.getByText(/lịch sử chỉ ước tính/)).toBeInTheDocument();
  });

  it('(F24.1) a history of one week invites to come back instead of showing a slider', () => {
    render(<Harness weeks={['2026-10-19']} position={0} />);
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.getByText(/Lịch sử bản đồ bắt đầu từ tuần này/)).toBeInTheDocument();
  });

  it('(F24.1) English: "Week of 5 Oct 2026", singular and plural counts', async () => {
    await i18n.changeLanguage('en');
    render(<Harness position={1} />);
    expect(screen.getByRole('slider', { name: 'Week shown' })).toHaveAttribute(
      'aria-valuetext',
      'Week of 5 Oct 2026: 3 notes, 1 link',
    );
  });
});
