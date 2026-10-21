/** Test helpers for the Settings screen: a settings answer and the screen inside a router. */
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { SettingsPatch, SettingsResponse } from '../../lib/api/settings-types';
import type { FetchMock } from '../../lib/testing/fetch-mock';
import { DEFAULT_UI_PREFS } from '../../lib/ui-prefs';
import { DialogHost } from '../dialogs/dialog-host';
import { SettingsScreen } from './settings-screen';

export function settingsResponse(overrides: Partial<SettingsResponse> = {}): SettingsResponse {
  return {
    port: 4747,
    configuredPort: 4747,
    restartRequired: false,
    ui: { ...DEFAULT_UI_PREFS },
    reminders: { time: '08:00' },
    system: { runAtLogin: false, runAtLoginSupported: true, platform: 'windows' },
    vault: {
      path: 'D:\\SECONDBRAIN\\vault',
      id: 'vault-a',
      isDefault: true,
      defaultPath: 'D:\\SECONDBRAIN\\vault',
    },
    ai: {
      provider: 'anthropic',
      keys: {
        anthropic: { set: false, last4: null },
        openai: { set: false, last4: null },
        gemini: { set: false, last4: null },
      },
      chatModel: null,
      embeddingModel: null,
      folders: null,
      enabled: false,
      embeddings: false,
    },
    ...overrides,
  };
}

/**
 * A settings "server": GET answers `state`, PUT merges the patch into it like the real route (a
 * key is never echoed, only its last 4 characters).
 */
export function installSettingsRoutes(mock: FetchMock, initial: SettingsResponse) {
  const state = { current: initial };
  mock.on('GET /api/settings', () => ({ body: state.current }));
  mock.on('PUT /api/settings', (call) => {
    const patch = call.body as SettingsPatch;
    const next = structuredClone(state.current);
    if (patch.ui) next.ui = { ...next.ui, ...patch.ui };
    if (patch.reminders?.time) next.reminders.time = patch.reminders.time;
    if (patch.system?.runAtLogin !== undefined) next.system.runAtLogin = patch.system.runAtLogin;
    if (patch.port !== undefined) {
      next.configuredPort = patch.port;
      next.restartRequired = patch.port !== next.port;
    }
    if (patch.ai) {
      const { apiKey, ...rest } = patch.ai;
      next.ai = { ...next.ai, ...rest };
      if (apiKey) {
        next.ai.keys[apiKey.provider] = apiKey.value
          ? { set: true, last4: `…${apiKey.value.slice(-4)}` }
          : { set: false, last4: null };
      }
    }
    state.current = next;
    return { body: next };
  });
  mock.on('GET /api/sample-data', { body: { offered: false, present: false } });
  mock.on('GET /api/tree', {
    body: {
      inboxCount: 0,
      root: {
        path: '',
        name: '',
        noteCount: 0,
        urgent: false,
        files: [],
        folders: ['0 Inbox', '1 Projects', '2 Areas', '3 Resources', '4 Archive'].map((name) => ({
          path: name,
          name,
          noteCount: 0,
          urgent: false,
          folders: [],
          files: [],
        })),
      },
    },
  });
  return state;
}

export function renderSettings() {
  const router = createMemoryRouter(
    [
      {
        path: '/settings',
        element: (
          <>
            <SettingsScreen />
            <DialogHost />
          </>
        ),
      },
      { path: '/reminders', element: <p data-testid="reminders-route" /> },
    ],
    { initialEntries: ['/settings'] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}
