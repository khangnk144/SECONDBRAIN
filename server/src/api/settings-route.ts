import type { FastifyInstance } from 'fastify';
import { errorCodeOf } from '../app-context/app-context-errors.js';
import { applySettingsPatch, parseSettingsPatch } from '../config/settings-patch.js';
import {
  buildSettingsResponse,
  publicUi,
  type SettingsResponse,
  type VaultInfo,
} from '../config/settings-response.js';
import type { SettingsStore } from '../config/settings-store.js';
import { bodyValidationError } from '../http/strict-body-schema.js';
import type { RunAtLoginService } from '../system/run-at-login.js';
import { VaultError } from '../vault/vault-types.js';
import type { WebSocketHub } from '../ws/websocket-hub.js';

export interface SettingsRouteOptions {
  store: SettingsStore;
  /** The port this process listens on. */
  port: number;
  platform: NodeJS.Platform;
  runAtLogin: RunAtLoginService;
  /** The open vault, or null in API-only builds without one. */
  vaultInfo: () => VaultInfo | null;
  /** Where `settings:changed` goes (null without a vault: no WS events then). */
  hub: WebSocketHub | null;
}

class ShortcutError extends Error {}

/**
 * `GET /api/settings` and `PUT /api/settings` (SPEC F18). Both answer the same allowlisted view
 * (API keys only as `…last4`, never the session token). PUT validates strictly, then changes the
 * startup shortcut and the settings file in one queued update; the live settings object changes
 * in place, so the reminder time, template language… apply without a restart.
 */
export function registerSettingsRoutes(app: FastifyInstance, options: SettingsRouteOptions): void {
  const { store, runAtLogin } = options;

  const respond = async (): Promise<SettingsResponse> =>
    buildSettingsResponse(store.get(), {
      port: options.port,
      platform: options.platform,
      runAtLogin: { enabled: await runAtLogin.isEnabled(), supported: runAtLogin.supported },
      vault: options.vaultInfo(),
    });

  app.get('/api/settings', async (_request, reply): Promise<SettingsResponse> => {
    reply.header('cache-control', 'no-store');
    return respond();
  });

  app.put('/api/settings', async (request, reply): Promise<SettingsResponse> => {
    const patch = parseSettingsPatch(request.body);
    const runAtLoginWanted = patch.system?.runAtLogin;
    if (runAtLoginWanted === true && !runAtLogin.supported) {
      throw bodyValidationError(
        { field: 'system.runAtLogin', reason: 'unsupported-platform' },
        'Starting at login is only available on Windows.',
      );
    }
    let uiChanged: boolean;
    try {
      uiChanged = await store.update(async (draft) => {
        const before = JSON.stringify(publicUi(draft.ui));
        // Only when it differs from the disk: the web may resend the whole section with every save.
        if (runAtLoginWanted !== undefined && runAtLoginWanted !== (await runAtLogin.isEnabled())) {
          await runAtLogin.setEnabled(runAtLoginWanted).catch((error: unknown) => {
            throw new ShortcutError(errorCodeOf(error));
          });
        }
        applySettingsPatch(draft, patch);
        return JSON.stringify(publicUi(draft.ui)) !== before;
      });
    } catch (error) {
      if (error instanceof ShortcutError) {
        throw new VaultError(
          'WRITE_FAILED',
          'Windows did not let the app change its Startup shortcut.',
          {
            reason: 'shortcut-failed',
            cause: error.message,
          },
        );
      }
      throw new VaultError('WRITE_FAILED', 'The settings could not be saved.', {
        cause: errorCodeOf(error),
      });
    }
    if (uiChanged)
      options.hub?.broadcast({ type: 'settings:changed', ui: publicUi(store.get().ui) });
    reply.header('cache-control', 'no-store');
    return respond();
  });
}
