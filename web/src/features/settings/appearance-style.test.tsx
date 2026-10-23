import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '../../i18n';
import { apiError, installFetchMock, type FetchMock } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { DEFAULT_UI_PREFS } from '../../lib/ui-prefs';
import { applyUiPrefsLive } from '../../lib/ui-prefs-live';
import { useUiPrefsStore } from '../../lib/ui-prefs-store';
import { resetSettingsStore } from './settings-store';
import { installSettingsRoutes, renderSettings, settingsResponse } from './settings-test-kit';

let mock: FetchMock;
const puts = () => mock.callsTo('PUT /api/settings').map((call) => call.body);
const root = () => document.documentElement;

describe('Settings → Giao diện → Phong cách (F35.1)', () => {
  beforeEach(async () => {
    await resetAppState();
    resetSettingsStore();
    applyUiPrefsLive({ ...DEFAULT_UI_PREFS });
    mock = installFetchMock();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('(F35.1) choosing a style applies data-style at once and saves only ui.style', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    const group = screen.getByRole('group', { name: 'Phong cách' });
    const bento = within(group).getByRole('radio', { name: 'Bento mềm' });
    expect(within(group).getByRole('radio', { name: 'Yên tĩnh' })).toBeChecked();

    await user.click(bento);
    expect(root().dataset.style).toBe('bento'); // before the server answered: no reload
    expect(bento).toBeChecked();
    await waitFor(() => expect(puts()).toEqual([{ ui: { style: 'bento' } }]));
    expect(useUiPrefsStore.getState().prefs.style).toBe('bento');

    await user.click(within(group).getByRole('radio', { name: 'Yên tĩnh' }));
    expect(root().dataset.style).toBe('calm');
    await waitFor(() => expect(puts()).toHaveLength(2));
  });

  it('goes back to the previous style when the save fails', async () => {
    const user = userEvent.setup();
    installSettingsRoutes(mock, settingsResponse());
    mock.on('PUT /api/settings', apiError(500, 'WRITE_FAILED'));
    renderSettings();
    await user.click(screen.getByRole('radio', { name: 'Bento mềm' }));
    await waitFor(() => expect(root().dataset.style).toBe('calm'));
    expect(useUiPrefsStore.getState().prefs.style).toBe('calm');
  });

  it('has English labels', async () => {
    await i18n.changeLanguage('en');
    installSettingsRoutes(mock, settingsResponse());
    renderSettings();
    const group = screen.getByRole('group', { name: 'Style' });
    expect(within(group).getByRole('radio', { name: 'Soft bento' })).toBeVisible();
    expect(within(group).getByRole('radio', { name: 'Calm' })).toBeVisible();
  });
});
