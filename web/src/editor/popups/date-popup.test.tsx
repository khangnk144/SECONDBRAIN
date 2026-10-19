import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { saveMarkdown } from '../markdown/markdown-document';
import { renderEditor } from '../__tests__/render-editor';
import { monthWeeks } from './calendar-model';

function activeDay(root: HTMLElement): HTMLElement {
  const id = root.getAttribute('aria-activedescendant');
  const cell = id ? document.getElementById(id) : null;
  if (!cell) throw new Error('no active day');
  return cell;
}

function startTask() {
  const t = renderEditor('- [ ] Nộp bài\n');
  t.caretAfter('Nộp bài');
  return t;
}

describe('date popup (F3)', () => {
  beforeEach(async () => {
    await resetAppState();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 19, 22, 0)); // Monday 19 Oct 2026, late evening local time
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('weeks start on Monday and cover the month', () => {
    const weeks = monthWeeks({ year: 2026, month: 10, day: 19 });
    expect(weeks[0]![0]).toEqual({ year: 2026, month: 9, day: 28 });
    expect(weeks.at(-1)![6]).toEqual({ year: 2026, month: 11, day: 1 });
  });

  it('@ opens on today; arrows, Page Down and Enter insert the due token', () => {
    const t = startTask();
    t.type(' @');
    const popup = screen.getByRole('group', { name: 'Chọn ngày' });
    expect(popup).toBeInTheDocument();
    expect(activeDay(t.root)).toHaveAttribute('aria-current', 'date');
    expect(activeDay(t.root)).toHaveTextContent('19');
    t.press('ArrowRight');
    t.press('ArrowDown');
    expect(activeDay(t.root)).toHaveTextContent('27');
    t.press('PageDown');
    expect(activeDay(t.root)).toHaveAccessibleName('Thứ Sáu, 27 tháng 11, 2026');
    expect(screen.getByRole('grid')).toHaveAccessibleName('Tháng 11 năm 2026');
    t.press('Enter');
    expect(screen.queryByRole('group', { name: 'Chọn ngày' })).toBeNull();
    expect(saveMarkdown(t.editor.state.doc, t.loaded.snapshot)).toBe(
      '- [ ] Nộp bài 📅 2026-11-27\n',
    );
  });

  it('quick choices pick today, tomorrow or next week; typing filters them', () => {
    const t = startTask();
    t.type(' @mai');
    expect(activeDay(t.root)).toHaveTextContent('20');
    t.press('Enter');
    expect(saveMarkdown(t.editor.state.doc, t.loaded.snapshot)).toBe(
      '- [ ] Nộp bài 📅 2026-10-20\n',
    );
  });

  it('a click on "Tuần sau" inserts the date a week from today', () => {
    const t = startTask();
    t.type(' 📅');
    fireEvent.click(screen.getByRole('button', { name: 'Tuần sau' }));
    expect(saveMarkdown(t.editor.state.doc, t.loaded.snapshot)).toBe(
      '- [ ] Nộp bài 📅 2026-10-26\n',
    );
  });

  it('a date picked in the middle of a line keeps a space before the next word', () => {
    const t = renderEditor('- [ ] Nộp bài Ôn tập\n');
    t.caretAfter('Nộp bài');
    t.type(' @');
    t.press('Enter');
    expect(saveMarkdown(t.editor.state.doc, t.loaded.snapshot)).toBe(
      '- [ ] Nộp bài 📅 2026-10-19 Ôn tập\n',
    );
  });

  it('Esc closes without inserting; @someone stays plain text', () => {
    const t = startTask();
    t.type(' @');
    t.press('Escape');
    expect(screen.queryByRole('group', { name: 'Chọn ngày' })).toBeNull();
    t.type(' @khang');
    expect(screen.queryByRole('group', { name: 'Chọn ngày' })).toBeNull();
    expect(t.press('ArrowLeft')).toBe(false);
  });
});
