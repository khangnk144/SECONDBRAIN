import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { pickDateDialog } from '../../lib/dialogs/dialog-requests';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { DialogHost } from './dialog-host';
import { formatTypedDate, parseTypedDate } from './typed-date';

function setup() {
  const trigger = document.createElement('button');
  trigger.textContent = 'Dời ngày…';
  document.body.append(trigger);
  trigger.focus();
  render(<DialogHost />);
  return trigger;
}

function open(initial = '2026-10-21'): Promise<string | null> {
  let result: Promise<string | null> = Promise.resolve(null);
  act(() => {
    result = pickDateDialog({ title: 'Dời “Nộp bản nháp” sang ngày', initial });
  });
  return result;
}

/** The focused day: its number and whether its cell is the selected one. */
function focusedDay() {
  const active = document.activeElement as HTMLElement;
  return {
    day: active.textContent,
    selected: active.closest('td')?.getAttribute('aria-selected'),
  };
}

describe('date picker dialog (F11.3)', () => {
  beforeEach(async () => {
    await resetAppState();
    document.body.innerHTML = '';
  });

  it('typed dates: dd/mm/yyyy, d/m/yyyy and ISO; impossible dates refused', () => {
    expect(parseTypedDate('05/11/2026')).toBe('2026-11-05');
    expect(parseTypedDate(' 5/1/2027 ')).toBe('2027-01-05');
    expect(parseTypedDate('05.11.2026')).toBe('2026-11-05');
    expect(parseTypedDate('2026-11-05')).toBe('2026-11-05');
    expect(parseTypedDate('31/02/2026')).toBeNull();
    expect(parseTypedDate('29/02/2028')).toBe('2028-02-29');
    expect(parseTypedDate('tomorrow')).toBeNull();
    expect(formatTypedDate({ year: 2026, month: 3, day: 7 })).toBe('07/03/2026');
  });

  it('keyboard only: starts on the date, arrows/PageDown/Home/End move, Enter picks', async () => {
    const user = userEvent.setup();
    setup();
    const result = open();
    expect(
      screen.getByRole('dialog', { name: 'Dời “Nộp bản nháp” sang ngày' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(focusedDay()).toEqual({ day: '21', selected: 'true' });
    await user.keyboard('{ArrowRight}');
    expect(focusedDay()).toEqual({ day: '22', selected: 'true' });
    await user.keyboard('{ArrowDown}');
    expect(focusedDay().day).toBe('29');
    await user.keyboard('{PageDown}');
    // Focus follows into November (29 Nov 2026 is a Sunday).
    expect(focusedDay()).toEqual({ day: '29', selected: 'true' });
    expect(screen.getByRole('textbox')).toHaveValue('29/11/2026');
    await user.keyboard('{Home}');
    expect(focusedDay().day).toBe('23');
    await user.keyboard('{End}');
    expect(focusedDay().day).toBe('29');
    await user.keyboard('{ArrowLeft}{PageUp}{PageDown}');
    expect(focusedDay().day).toBe('28');
    await user.keyboard('{Enter}');
    await expect(result).resolves.toBe('2026-11-28');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('days and the month read in sentence case, like the daily note row ("Thứ tư", not "Thứ Tư")', async () => {
    const user = userEvent.setup();
    setup();
    void open();
    expect(document.activeElement).toHaveAccessibleName('Thứ tư, 21/10/2026');
    expect(screen.getByText('Tháng 10, 2026')).toBeInTheDocument();
    expect(screen.getByRole('grid')).toHaveAccessibleName('Tháng 10, 2026');
    await user.keyboard('{PageDown}');
    expect(document.activeElement).toHaveAccessibleName('Thứ bảy, 21/11/2026');
    expect(screen.getByText('Tháng 11, 2026')).toBeInTheDocument();
  });

  it('Esc cancels and focus returns to where it was', async () => {
    const user = userEvent.setup();
    const trigger = setup();
    const result = open();
    await user.keyboard('{ArrowRight}{Escape}');
    await expect(result).resolves.toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('the typed field moves the grid and submits; an impossible date shows the problem', async () => {
    const user = userEvent.setup();
    setup();
    const result = open();
    const field = screen.getByRole('textbox', { name: 'Hoặc gõ ngày (dd/mm/yyyy)' });
    await user.clear(field);
    await user.type(field, '31/02/2026{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('Ngày này không có thật');
    expect(field).toHaveFocus();
    await user.clear(field);
    await user.type(field, '05/12/2026');
    expect(screen.getByRole('gridcell', { selected: true })).toHaveTextContent('5');
    await user.keyboard('{Enter}');
    await expect(result).resolves.toBe('2026-12-05');
  });

  it('month buttons and "Hôm nay" move the grid; the primary button picks the active day', async () => {
    const user = userEvent.setup();
    setup();
    const result = open('2026-01-31');
    await user.click(screen.getByRole('button', { name: 'Tháng sau' }));
    // 31 Jan + 1 month is clamped to the last day of February.
    expect(screen.getByRole('textbox')).toHaveValue('28/02/2026');
    await user.click(screen.getByRole('button', { name: 'Tháng trước' }));
    expect(screen.getByRole('textbox')).toHaveValue('28/01/2026');
    await user.click(screen.getByRole('button', { name: 'Chọn ngày' }));
    await expect(result).resolves.toBe('2026-01-28');
  });
});
