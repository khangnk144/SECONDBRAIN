import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { showToast, useToastStore } from '../../lib/toast-store';
import { ToastHost } from './toast-host';

describe('toast host', () => {
  beforeEach(async () => {
    await resetAppState();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('announces toasts politely, errors assertively, and runs the action once', async () => {
    render(<ToastHost />);
    const undo = vi.fn();
    act(() => {
      showToast({
        message: 'Đã chuyển “a” vào thùng rác.',
        action: { label: 'Hoàn tác', run: undo },
      });
      showToast({ message: 'Không ghi được file.', tone: 'error' });
    });
    expect(screen.getByRole('status')).toHaveTextContent('Đã chuyển “a” vào thùng rác.');
    expect(screen.getByRole('alert')).toHaveTextContent('Không ghi được file.');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hoàn tác' }));
    });
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).not.toHaveTextContent('thùng rác');
  });

  it('pauses while hovered or focused and closes with the close button', () => {
    render(<ToastHost />);
    act(() => {
      showToast({ message: 'Đã lưu' });
    });
    const toast = screen.getByText('Đã lưu').closest('li') as HTMLElement;
    fireEvent.mouseEnter(toast);
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText('Đã lưu')).toBeInTheDocument();
    fireEvent.mouseLeave(toast);
    act(() => vi.advanceTimersByTime(4_000));
    expect(screen.queryByText('Đã lưu')).toBeNull();

    act(() => {
      showToast({ message: 'Lần hai' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Đóng thông báo' }));
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
