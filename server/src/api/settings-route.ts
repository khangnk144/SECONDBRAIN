import type { FastifyInstance } from 'fastify';
import type { AiRuntime } from '../ai/ai-types.js';
import { errorCodeOf } from '../app-context/app-context-errors.js';
import type { GlobalSettings } from '../config/global-settings.js';
import { applySettingsPatch, parseSettingsPatch } from '../config/settings-patch.js';
import {
  buildSettingsResponse,
  publicUi,
  type SettingsResponse,
  type VaultInfo,
} from '../config/settings-response.js';
import type { SettingsStore } from '../config/settings-store.js';
import { mcpSettingsOf } from '../config/settings-sections.js';
import { bodyValidationError } from '../http/strict-body-schema.js';
import type { RunAtLoginService } from '../system/run-at-login.js';
import { isVaultError, VaultError } from '../vault/vault-types.js';
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
  /**
   * The AI plugin of the open vault, looked up per request. After an `ai`/`mcp` change it
   * re-evaluates (embedding jobs start or stop) and broadcasts `ai:status` itself; without it the
   * route broadcasts an `ai:status` with embeddings off so clients still refetch.
   */
  ai?: () => AiRuntime | null;
  /** Clock for consent timestamps (tests). */
  now?: () => Date;
}

class ShortcutError extends Error {}

/** What the AI plugin and the MCP permissions read; a change of it is announced as `ai:status`. */
const aiView = (settings: GlobalSettings): string =>
  JSON.stringify([settings.ai, mcpSettingsOf(settings)]);

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
    const now = options.now ?? (() => new Date());
    let changed: { ui: boolean; ai: boolean };
    try {
      changed = await store.update(async (draft) => {
        const before = JSON.stringify(publicUi(draft.ui));
        const aiBefore = aiView(draft);
        // Before any side effect: a refused patch (consent-required) must change nothing at all.
        applySettingsPatch(draft, patch, now());
        // Only when it differs from the disk: the web may resend the whole section with every save.
        if (runAtLoginWanted !== undefined && runAtLoginWanted !== (await runAtLogin.isEnabled())) {
          await runAtLogin.setEnabled(runAtLoginWanted).catch((error: unknown) => {
            throw new ShortcutError(errorCodeOf(error));
          });
        }
        return {
          ui: JSON.stringify(publicUi(draft.ui)) !== before,
          ai: aiView(draft) !== aiBefore,
        };
      });
    } catch (error) {
      if (isVaultError(error) && error.code === 'VALIDATION') throw error;
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
    if (changed.ui)
      options.hub?.broadcast({ type: 'settings:changed', ui: publicUi(store.get().ui) });
    if (changed.ai) announceAiChange(options);
    reply.header('cache-control', 'no-store');
    return respond();
  });
}

/** Lets the AI plugin re-evaluate (it broadcasts `ai:status`); never fails the saved request. */
function announceAiChange(options: SettingsRouteOptions): void {
  let runtime: AiRuntime | null;
  try {
    runtime = options.ai?.() ?? null;
  } catch {
    runtime = null; // between vaults during a switch: clients refetch the status anyway
  }
  if (runtime?.settingsChanged) {
    runtime.settingsChanged();
    return;
  }
  options.hub?.broadcast({ type: 'ai:status', embeddings: { state: 'off', done: 0, total: 0 } });
}
