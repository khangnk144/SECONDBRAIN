import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import type { SearchResult } from '../../lib/api/search-types';
import { APP_COMMANDS, availableCommands } from '../../lib/commands/command-registry';
import { useSearchUi } from '../../lib/search-ui-store';
import { registerShortcut } from '../../lib/shortcuts/shortcut-registry';
import { useTabsStore } from '../../lib/tabs-store';
import { installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { SearchPalette } from './search-palette';

function renderPalette() {
  render(
    <>
      <button type="button" onClick={() => useSearchUi.getState().openSearch()}>
        opener
      </button>
      <SearchPalette />
    </>,
  );
}

async function openPalette(user: ReturnType<typeof userEvent.setup>, query = '') {
  useSearchUi.getState().setQuery('');
  await user.click(screen.getByRole('button', { name: 'opener' }));
  const dialog = screen.getByRole('dialog', { name: 'Tìm ghi chú' });
  const input = within(dialog).getByRole('combobox');
  if (query) await user.type(input, query);
  return { dialog, input };
}

const optionTexts = (dialog: HTMLElement) =>
  within(dialog)
    .queryAllByRole('option')
    .map((option) => option.textContent);

describe('palette commands (F8.4)', () => {
  let mock: FetchMock;
  let answer: (q: string) => SearchResult[];
  const runs = new Map<string, ReturnType<typeof vi.fn>>();

  beforeEach(async () => {
    await resetAppState();
    answer = () => [];
    mock = installFetchMock();
    mock.on('GET /api/search', (call) => ({
      body: { results: answer(call.query.get('q') ?? '') },
    }));
    // Each command's own effect is covered by the registry test; here only that it runs.
    for (const command of APP_COMMANDS) {
      const run = vi.fn();
      runs.set(command.id, run);
      vi.spyOn(command, 'run').mockImplementation(run);
    }
    renderPalette();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('`>` lists the commands available here with their key, asking the server nothing', async () => {
    const user = userEvent.setup();
    const { dialog } = await openPalette(user, '>');
    const list = within(dialog).getByRole('listbox', { name: 'Lệnh' });
    const texts = within(list)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(texts[0]).toBe('Ghi chú mớiAlt+N');
    expect(texts).toContain('Mở Lịch');
    expect(texts).toContain('Mở Bản đồ nãoAlt+G');
    expect(texts).toContain('Xây lại chỉ mục');
    // Nothing that needs a note on screen, and no AI before its phase.
    expect(texts).not.toContain('Chế độ nguồnAlt+S');
    expect(texts.some((text) => text?.includes('AI'))).toBe(false);
    expect(texts).toHaveLength(availableCommands().length);
    // The first request (blank query, sent on open) is the only one.
    expect(mock.callsTo('GET /api/search').every((c) => c.query.get('q') === '')).toBe(true);
    expect(within(dialog).getByText('Gõ tên lệnh để lọc, Enter để chạy.')).toBeVisible();
  });

  it('every available command is reachable by typing, arrows and Enter', async () => {
    const user = userEvent.setup();
    useTabsStore.setState({
      tabs: [
        { id: 'a', path: 'a/Một.md', lastActive: 1 },
        { id: 'b', path: 'b/Hai.md', lastActive: 2 },
      ],
      activeId: 'b',
      routeActive: true,
    });
    registerShortcut({ id: 'source-mode', keys: 'Alt+S', run: () => undefined, labelKey: 'x' });
    const commands = availableCommands();
    expect(commands).toHaveLength(APP_COMMANDS.length);
    for (const command of commands) {
      const label = i18n.t(command.labelKey);
      const { dialog, input } = await openPalette(user, `>${label}`);
      const options = within(dialog).getAllByRole('option');
      const index = options.findIndex((o) => o.textContent?.startsWith(label));
      expect(index, label).toBeGreaterThanOrEqual(0);
      for (let step = 0; step < index; step += 1) await user.keyboard('{ArrowDown}');
      expect(input).toHaveAttribute('aria-activedescendant', options[index]?.id);
      await user.keyboard('{Enter}');
      expect(screen.queryByRole('dialog')).toBeNull();
      await waitFor(() => expect(runs.get(command.id), label).toHaveBeenCalledTimes(1));
    }
  });

  it('runs a command only after the palette closed and focus is back on the opener', async () => {
    const user = userEvent.setup();
    let focusedWhenRun: Element | null = null;
    runs.get('quick-capture')?.mockImplementation(() => {
      focusedWhenRun = document.activeElement;
    });
    await openPalette(user, '>ghi nhanh');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(runs.get('quick-capture')).toHaveBeenCalled());
    expect(focusedWhenRun).toBe(screen.getByRole('button', { name: 'opener' }));
  });

  it('a plain query lists the commands it names below the notes', async () => {
    const user = userEvent.setup();
    answer = (q) =>
      q === 'mo lich'
        ? [
            {
              path: '2 Areas/Mở lịch học.md',
              title: 'Mở lịch học',
              folder: '2 Areas',
              class: 'user',
              matchedIn: 'title',
              snippet: null,
              score: 1,
            },
          ]
        : [];
    const { dialog } = await openPalette(user, 'mo lich');
    await waitFor(() =>
      expect(optionTexts(dialog)).toEqual(['Mở lịch học2 Areas', "Tạo 'mo lich'", 'Mở Lịch']),
    );
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await waitFor(() => expect(runs.get('openCalendar')).toHaveBeenCalledTimes(1));
  });

  it("Enter on a command's exact name runs that command, not a longer one", async () => {
    const user = userEvent.setup();
    const { dialog } = await openPalette(user, '>mở hôm nay');
    expect(optionTexts(dialog)[0]).toBe('Mở Hôm nay');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(runs.get('openToday')).toHaveBeenCalledTimes(1));
    expect(runs.get('daily-note')).not.toHaveBeenCalled();

    const second = await openPalette(user, '>mở ghi chú');
    expect(optionTexts(second.dialog).slice(0, 2)).toEqual([
      'Mở ghi chú hôm nayAlt+T',
      'Ghi chú mớiAlt+N',
    ]);
  });

  it('says when no command matches and offers no note creation', async () => {
    const user = userEvent.setup();
    const { dialog, input } = await openPalette(user, '>không có');
    expect(within(dialog).getByText("Không có lệnh nào khớp 'không có'.")).toBeVisible();
    expect(optionTexts(dialog)).toEqual([]);
    expect(input).toHaveAttribute('aria-expanded', 'false');
  });
});
