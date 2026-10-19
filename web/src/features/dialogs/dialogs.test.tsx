import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  confirmDialog,
  pickFolderDialog,
  promptDialog,
  templatePickerDialog,
} from '../../lib/dialogs/dialog-requests';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { showToast, useToastStore } from '../../lib/toast-store';
import { makeTree } from '../../lib/testing/tree-fixture';
import { useTreeStore } from '../../lib/tree-store';
import { DialogHost } from './dialog-host';

function setup() {
  const trigger = document.createElement('button');
  trigger.textContent = 'trigger';
  document.body.append(trigger);
  trigger.focus();
  render(<DialogHost />);
  return trigger;
}

describe('dialogs: focus trap, Esc, return focus', () => {
  beforeEach(async () => {
    await resetAppState();
    document.body.innerHTML = '';
  });

  it('confirm: focus moves in, Tab cycles inside, Esc cancels and focus returns', async () => {
    const user = userEvent.setup();
    const trigger = setup();
    let result: Promise<boolean> = Promise.resolve(true);
    act(() => {
      result = confirmDialog({
        title: 'Đổi tên “Bài 1”?',
        body: 'Liên kết trong 2 ghi chú sẽ được sửa.',
        items: ['2 Areas/Giải tích 1', 'Daily/2026-10-18'],
        itemsLabel: 'Ghi chú sẽ được sửa',
        confirmLabel: 'Đổi tên',
      });
    });
    const dialog = screen.getByRole('dialog', { name: 'Đổi tên “Bài 1”?' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Liên kết trong 2 ghi chú sẽ được sửa.');
    expect(screen.getByRole('list', { name: 'Ghi chú sẽ được sửa' })).toHaveTextContent(
      'Daily/2026-10-18',
    );
    const confirm = screen.getByRole('button', { name: 'Đổi tên' });
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('list', { name: 'Ghi chú sẽ được sửa' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Hủy' })).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.keyboard('{Escape}');
    await expect(result).resolves.toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('danger confirm starts on Cancel and resolves true on confirm', async () => {
    const user = userEvent.setup();
    setup();
    let result: Promise<boolean> = Promise.resolve(false);
    act(() => {
      result = confirmDialog({ title: 'Xóa?', confirmLabel: 'Chuyển vào thùng rác', danger: true });
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hủy' })).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Chuyển vào thùng rác' }));
    await expect(result).resolves.toBe(true);
  });

  it('prompt: shows the validation problem, then submits with Enter', async () => {
    const user = userEvent.setup();
    setup();
    let result: Promise<string | null> = Promise.resolve(null);
    act(() => {
      result = promptDialog({
        title: 'Thư mục mới trong 2 Areas',
        label: 'Tên thư mục',
        confirmLabel: 'Tạo thư mục',
        validate: (v) => (v.trim() === '' ? 'Tên không được để trống.' : null),
      });
    });
    const input = screen.getByRole('textbox', { name: 'Tên thư mục' });
    expect(input).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Tên không được để trống.');
    await user.type(input, 'Xác suất{Enter}');
    await expect(result).resolves.toBe('Xác suất');
  });

  it('folder picker filters without diacritics, skips disabled folders, Enter chooses', async () => {
    const user = userEvent.setup();
    useTreeStore.setState({
      tree: makeTree({ folders: ['0 Inbox', '2 Areas', '2 Areas/Giải tích'], notes: [] }),
    });
    setup();
    let result: Promise<string | null> = Promise.resolve(null);
    act(() => {
      result = pickFolderDialog({
        title: 'Chuyển “Bài 1” tới…',
        confirmLabel: 'Chuyển tới đây',
        isDisabled: (p) => p === '0 Inbox',
        includeRoot: true,
      });
    });
    const options = () => screen.getAllByRole('option').map((o) => o.textContent);
    expect(options()).toEqual(['Thư mục gốc', '0 Inbox', '2 Areas', 'Giải tích']);
    expect(screen.getByRole('option', { name: '0 Inbox' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await user.keyboard('giai tich');
    expect(options()).toEqual(['Giải tích']);
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-activedescendant');
    await user.keyboard('{Enter}');
    await expect(result).resolves.toBe('2 Areas/Giải tích');
  });

  it('template picker: arrows move, Enter picks; Esc cancels', async () => {
    const user = userEvent.setup();
    setup();
    let result: Promise<unknown> = Promise.resolve(null);
    const templates = [
      { path: 'Templates/Course.md', title: 'Course', bundled: true },
      { path: 'Templates/Lecture.md', title: 'Lecture', bundled: true },
    ];
    act(() => {
      result = templatePickerDialog({ templates });
    });
    expect(screen.getByRole('listbox')).toHaveFocus();
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Trống',
      'Course',
      'Lecture',
    ]);
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await expect(result).resolves.toEqual({ template: 'Templates/Lecture.md' });

    act(() => {
      result = templatePickerDialog({ templates });
    });
    await user.keyboard('{Enter}');
    await expect(result).resolves.toEqual({ template: null });
    act(() => {
      result = templatePickerDialog({ templates });
    });
    await user.keyboard('{Escape}');
    await expect(result).resolves.toBeNull();
  });

  it('freezes the undo toast countdown while a dialog covers it', async () => {
    vi.useFakeTimers();
    setup();
    act(() => {
      showToast({ message: 'Đã đổi tên', action: { label: 'Hoàn tác', run: () => {} } });
    });
    let result: Promise<boolean> = Promise.resolve(true);
    act(() => {
      vi.advanceTimersByTime(9_000);
      result = confirmDialog({ title: 'Xóa thư mục?', confirmLabel: 'Xóa', danger: true });
    });
    act(() => vi.advanceTimersByTime(60_000));
    expect(useToastStore.getState().toasts).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    await act(async () => {
      await expect(result).resolves.toBe(false);
    });
    act(() => vi.advanceTimersByTime(999));
    expect(useToastStore.getState().toasts).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(useToastStore.getState().toasts).toHaveLength(0);
    vi.useRealTimers();
  });
});
