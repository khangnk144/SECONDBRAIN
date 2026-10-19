import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTION_TOAST_MS,
  holdToastTimers,
  MAX_TOASTS,
  resetToasts,
  showToast,
  TOAST_MS,
  useToastStore,
} from './toast-store';

const messages = () => useToastStore.getState().toasts.map((toast) => toast.message);

describe('toast store (design.md §5 timing)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetToasts();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps plain toasts 4 s and toasts with an action 10 s', () => {
    showToast({ message: 'Đã lưu' });
    showToast({ message: 'Đã xóa', action: { label: 'Hoàn tác', run: () => {} } });
    expect(useToastStore.getState().toasts.map((t) => t.durationMs)).toEqual([
      TOAST_MS,
      ACTION_TOAST_MS,
    ]);
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(messages()).toEqual(['Đã lưu', 'Đã xóa']);
    vi.advanceTimersByTime(1);
    expect(messages()).toEqual(['Đã xóa']);
    vi.advanceTimersByTime(ACTION_TOAST_MS - TOAST_MS);
    expect(messages()).toEqual([]);
  });

  it('pauses the countdown and resumes with the time left', () => {
    const id = showToast({ message: 'x' });
    vi.advanceTimersByTime(3_000);
    useToastStore.getState().pause(id);
    vi.advanceTimersByTime(60_000);
    expect(messages()).toEqual(['x']);
    useToastStore.getState().resume(id);
    vi.advanceTimersByTime(999);
    expect(messages()).toEqual(['x']);
    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });

  it('shows at most three, dropping the oldest', () => {
    for (const m of ['1', '2', '3', '4']) showToast({ message: m });
    expect(messages()).toEqual(['2', '3', '4']);
    expect(MAX_TOASTS).toBe(3);
  });

  it('freezes every countdown while a modal holds them, also for toasts shown meanwhile', () => {
    showToast({ message: 'Đã xóa', action: { label: 'Hoàn tác', run: () => {} } });
    vi.advanceTimersByTime(6_000);
    const release = holdToastTimers();
    showToast({ message: 'Mới' });
    vi.advanceTimersByTime(60_000);
    expect(messages()).toEqual(['Đã xóa', 'Mới']);
    // A toast hovered before the release stays paused afterwards.
    const hovered = useToastStore.getState().toasts[1]?.id ?? 0;
    useToastStore.getState().pause(hovered);
    release();
    release();
    vi.advanceTimersByTime(ACTION_TOAST_MS - 6_000);
    expect(messages()).toEqual(['Mới']);
    useToastStore.getState().resume(hovered);
    vi.advanceTimersByTime(TOAST_MS);
    expect(messages()).toEqual([]);
  });
});
