import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetReminders } from '../features/reminders/reminders-store';
import { startSettingsSync } from '../features/settings/settings-sync';
import { resetSettingsStore } from '../features/settings/settings-store';
import { installSettingsRoutes, settingsResponse } from '../features/settings/settings-test-kit';
import { todayView } from '../features/today/today-test-fixtures';
import { i18n } from '../i18n';
import { installFetchMock } from '../lib/testing/fetch-mock';
import { resetAppState } from '../lib/testing/reset-app-state';
import { applyUiPrefsLive } from '../lib/ui-prefs-live';
import { DEFAULT_UI_PREFS } from '../lib/ui-prefs';
import { emitServerEvent } from '../lib/ws/server-event-bus';
import { appRoutes } from './routes';
import todayEn from '../i18n/locales/today.en.json';

/** Letters only Vietnamese uses (English text never has them). */
const VIETNAMESE_LETTERS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
/** Names that stay as they are in every language: the language's own name, the user's name. */
const KEEP = ['Tiếng Việt'];

/** Words with Vietnamese letters left in the visible text of `element`. */
function vietnameseLeft(element: Element): string[] {
  let text = element.textContent ?? '';
  for (const kept of KEEP) text = text.split(kept).join(' ');
  return text.split(/\s+/).filter((word) => VIETNAMESE_LETTERS.test(word));
}

function renderShell(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('switching the language updates every visible string without a reload (F19.2)', () => {
  beforeEach(async () => {
    await resetAppState();
    resetSettingsStore();
    resetReminders();
    applyUiPrefsLive({ ...DEFAULT_UI_PREFS });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 21, 9, 30));
    const mock = installFetchMock();
    installSettingsRoutes(mock, settingsResponse());
    mock.on('GET /api/today', { body: todayView() });
    mock.on('GET /api/reminders', {
      body: { available: true, time: '08:00', toastSupported: true, reminders: [] },
    });
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await i18n.changeLanguage('vi');
  });

  it('Settings, the sidebar and Today read in English after choosing English in Settings', async () => {
    const user = userEvent.setup();
    const router = renderShell('/settings');
    await screen.findByRole('heading', { level: 2, name: 'Kho ghi chú' });
    // The check does see Vietnamese: plenty of it before the switch.
    expect(vietnameseLeft(document.body).length).toBeGreaterThan(50);
    await user.click(screen.getByRole('radio', { name: 'English' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings'),
    );
    expect(vietnameseLeft(document.body)).toEqual([]);
    expect(document.documentElement.lang).toBe('en');

    await act(() => router.navigate('/'));
    expect(await screen.findByText(todayEn.summary.nothingUrgent)).toBeVisible();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good morning, khangnie.');
    expect(vietnameseLeft(document.body)).toEqual([]);
  });

  it('a switch made in another window rebuilds the screen on show in the new language', async () => {
    const stop = startSettingsSync();
    renderShell('/');
    expect(await screen.findByText('Chào buổi sáng, khangnie.')).toBeVisible();
    const before = document.querySelector('.app-main__inner');
    act(() =>
      emitServerEvent({ type: 'settings:changed', ui: { ...DEFAULT_UI_PREFS, language: 'en' } }),
    );
    expect(await screen.findByText(todayEn.summary.nothingUrgent)).toBeVisible();
    // Screens that keep translated text outside React (editor, canvas) are built again.
    expect(document.querySelector('.app-main__inner')).not.toBe(before);
    expect(vietnameseLeft(document.body)).toEqual([]);
    stop();
  });
});
