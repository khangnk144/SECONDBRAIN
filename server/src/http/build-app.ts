import path from 'node:path';
import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerBackupRoutes } from '../api/backup-routes.js';
import { registerHealthRoute } from '../api/health-route.js';
import { registerVaultRoutes, type VaultRouteOptions } from '../api/register-vault-routes.js';
import { registerSettingsRoutes } from '../api/settings-route.js';
import { registerShutdownRoute } from '../api/shutdown-route.js';
import { registerSystemRoutes } from '../api/system-routes.js';
import { registerVaultSwitchRoutes } from '../api/vault-switch-routes.js';
import { errorCodeOf } from '../app-context/app-context-errors.js';
import type { AppContext } from '../app-context/create-app-context.js';
import type { VaultHost } from '../app-context/vault-host.js';
import type { GlobalSettings } from '../config/global-settings.js';
import { createSettingsStore, type SettingsStore } from '../config/settings-store.js';
import { registerRequestLogging } from '../logging/register-request-logging.js';
import { createSilentLogger, type AppLogger } from '../logging/rotating-file-logger.js';
import { registerSecurityHooks } from '../security/register-security-hooks.js';
import type { ServerMode } from '../security/security-headers.js';
import { DEFAULT_HMR_PORT, registerDevShellSource } from '../shell/dev-shell-source.js';
import { registerProdShellSource } from '../shell/prod-shell-source.js';
import { registerUiShellRoutes } from '../shell/register-ui-shell-routes.js';
import { createRunAtLoginService, type RunAtLoginService } from '../system/run-at-login.js';
import { isVaultError } from '../vault/vault-types.js';
import { SERVER_VERSION } from '../version.js';
import { registerWebSocketRoute } from '../ws/register-websocket-route.js';
import { isApiError, sendApiError, type ApiErrorCode } from './api-errors.js';
import { registerRequestGate } from './register-request-gate.js';
import { VAULT_ERROR_STATUS } from './vault-error-status.js';

function errorCodeForStatus(status: number): ApiErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status >= 500) return 'INTERNAL';
  return 'VALIDATION';
}

export interface BuildAppOptions {
  /** Current settings; a getter so later milestones can change them at runtime. */
  getSettings: () => GlobalSettings;
  port: number;
  mode: ServerMode;
  /** Absolute path of app/web (index.html, vite.config.ts) – used in development. */
  webDir: string;
  /** Absolute path of app/web/dist – used in production. */
  webDistDir: string;
  logger?: AppLogger;
  version?: string;
  hmrPort?: number;
  /** Set to false to skip the UI shell entirely (API-only tests). */
  serveUi?: boolean;
  /** Enables POST /api/shutdown; called after the 202 reply has been sent. */
  requestShutdown?: () => void;
  /** Saves settings changes (PUT /settings, vault switch); without it they stay in memory. */
  settingsStore?: SettingsStore;
  /**
   * The vault host (what `startServer` passes): vault routes on its delegating context, the vault
   * switch, backups, and the request gate that holds requests during a switch.
   */
  host?: VaultHost;
  /**
   * A single open vault without a host (older tests): vault routes and WS events, no switch and
   * no backups. Without host and context only the shell, health, settings and shutdown exist.
   */
  context?: AppContext;
  /** Vault route settings (e.g. the file-manager launcher used by reveal and the logs folder). */
  vaultRoutes?: VaultRouteOptions;
  /** "Chạy khi đăng nhập Windows"; default: the Startup-folder shortcut service. */
  runAtLogin?: RunAtLoginService;
  /** The app folder (launcher scripts); default: the parent of `webDir`. */
  appDir?: string;
  /** Platform reported by GET /settings (tests). */
  platform?: NodeJS.Platform;
}

/**
 * Creates the Fastify instance with the full security boundary, API routes, WebSocket channel
 * and UI shell. Does not listen; callers (startServer, tests) decide that. Routes may still be
 * added by the caller before `ready()`.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const logger = options.logger ?? createSilentLogger();
  const version = options.version ?? SERVER_VERSION;
  const hmrPort = options.hmrPort ?? DEFAULT_HMR_PORT;

  const app = Fastify({
    logger: false,
    bodyLimit: 10 * 1024 * 1024,
    return503OnClosing: true,
  });

  // The websocket plugin goes first: its onRequest hook marks upgrade requests so that its
  // onResponse hook can destroy the socket of an upgrade the security hook refuses.
  await app.register(fastifyWebsocket, { options: { maxPayload: 1024 * 1024 } });
  registerSecurityHooks(app, {
    port: options.port,
    getToken: () => options.getSettings().sessionToken,
  });
  registerRequestLogging(app, logger);

  app.setErrorHandler((error, request, reply) => {
    if (isApiError(error)) {
      return sendApiError(reply, error.status, error.code, error.message, error.details);
    }
    if (isVaultError(error)) {
      // The disk refused a write: worth a log line (code only, no path: paths are note titles).
      if (error.code === 'WRITE_FAILED') {
        const cause = String(error.details?.cause ?? 'unknown');
        logger.error(`Write failed on ${request.method} ${request.url.split('?')[0]} (${cause}).`);
      }
      return sendApiError(
        reply,
        VAULT_ERROR_STATUS[error.code],
        error.code,
        error.message,
        error.details,
      );
    }
    const err = error as { statusCode?: number; validation?: unknown; message?: string };
    const status =
      err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    // Code or name only: messages can carry absolute paths and note titles (SPEC §5 Logs).
    if (status === 500) {
      logger.error(
        `Unhandled error on ${request.method} ${request.url.split('?')[0]} (${errorCodeOf(error)}).`,
      );
    }
    const code = err.validation ? 'VALIDATION' : errorCodeForStatus(status);
    const message = status === 500 ? 'Internal server error.' : (err.message ?? 'Bad request.');
    return sendApiError(reply, status, code, message);
  });

  const { host } = options;
  const context = host?.context ?? options.context;
  if (host) registerRequestGate(app, host.gate, () => host.current.vault.id);
  registerHealthRoute(app, version, () => context?.vault.id ?? null);
  registerSettingsRoutes(app, {
    store: options.settingsStore ?? createSettingsStore(options.getSettings, async () => {}),
    port: options.port,
    platform: options.platform ?? process.platform,
    runAtLogin:
      options.runAtLogin ??
      createRunAtLoginService({ appDir: options.appDir ?? path.dirname(options.webDir) }),
    vaultInfo: () => host?.vaultInfo() ?? null,
    hub: context?.hub ?? null,
  });
  registerWebSocketRoute(
    app,
    version,
    context ? { hub: context.hub, onConnect: (send) => context.greet(send) } : {},
  );
  if (context) {
    registerVaultRoutes(app, context, {
      uiLanguage: () => options.getSettings().ui.language,
      settings: () => options.getSettings(),
      ...options.vaultRoutes,
    });
    registerSystemRoutes(app, context, options.vaultRoutes?.reveal);
  }
  if (host) {
    registerVaultSwitchRoutes(app, host);
    await registerBackupRoutes(app, host);
  }
  if (options.requestShutdown) await registerShutdownRoute(app, options.requestShutdown);

  if (options.serveUi === false) {
    app.setNotFoundHandler(async (_request, reply) =>
      sendApiError(reply, 404, 'NOT_FOUND', 'Not found.'),
    );
    return app;
  }

  const source =
    options.mode === 'development'
      ? await registerDevShellSource(app, { webDir: options.webDir, hmrPort })
      : await registerProdShellSource(app, options.webDistDir);
  registerUiShellRoutes(app, {
    source,
    getSettings: options.getSettings,
    port: options.port,
    mode: options.mode,
    hmrPort,
  });
  return app;
}
