import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { showToast } from '../../lib/toast-store';
import { ToastHost } from './toast-host';

let hideRow: () => void = () => {};

/** A tree row right before the toasts in the Tab order, which an undo may replace. */
function Page() {
  const [rowShown, setRowShown] = useState(true);
  hideRow = () => setRowShown(false);
  return (
    <>
      <main id="main-content" tabIndex={-1}>
        {rowShown ? <button type="button">Bài tập</button> : null}
      </main>
      <ToastHost />
    </>
  );
}

describe('toast actions keep keyboard focus (WCAG 2.4.3)', () => {
  beforeEach(async () => {
    await resetAppState();
  });

  it('"Hoàn tác" from the keyboard returns focus to where the user was', async () => {
    const user = userEvent.setup();
    render(<Page />);
    const row = screen.getByRole('button', { name: 'Bài tập' });
    row.focus();
    const undo = vi.fn();
    act(() => {
      showToast({ message: 'Đã xóa', action: { label: 'Hoàn tác', run: undo } });
    });
    await user.tab();
    expect(screen.getByRole('button', { name: 'Hoàn tác' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(undo).toHaveBeenCalledTimes(1);
    expect(row).toHaveFocus();
  });

  it('falls back to the main region when the action removes that element (also for ×)', async () => {
    const user = userEvent.setup();
    render(<Page />);
    screen.getByRole('button', { name: 'Bài tập' }).focus();
    act(() => {
      showToast({ message: 'Đã xóa', action: { label: 'Hoàn tác', run: () => act(hideRow) } });
      showToast({ message: 'Đã lưu' });
    });
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: 'Bài tập' })).toBeNull();
    expect(screen.getByRole('main')).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Đóng thông báo' }));
    expect(screen.getByRole('main')).toHaveFocus();
  });
});
