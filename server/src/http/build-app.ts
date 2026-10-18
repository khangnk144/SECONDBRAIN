import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerHealthRoute } from '../api/health-route.js';
import { registerSettingsRoute } from '../api/settings-route.js';
import { registerShutdownRoute } from '../api/shutdown-route.js';
import type { GlobalSettings } from '../config/global-settings.js';
import { registerRequestLogging } from '../logging/register-request-logging.js';
import { createSilentLogger, type AppLogger } from '../logging/rotating-file-logger.js';
import { registerSecurityHooks } from '../security/register-security-hooks.js';
import type { ServerMode } from '../security/security-headers.js';
import { DEFAULT_HMR_PORT, registerDevShellSource } from '../shell/dev-shell-source.js';
import { registerProdShellSource } from '../shell/prod-shell-source.js';
import { registerUiShellRoutes } from '../shell/register-ui-shell-routes.js';
import { SERVER_VERSION } from '../version.js';
import { registerWebSocketRoute } from '../ws/register-websocket-route.js';
import { sendApiError, type ApiErrorCode } from './api-errors.js';

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
    const err = error as { statusCode?: number; validation?: unknown; message?: string };
    const status =
      err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500)
      logger.error(
        `Unhandled error on ${request.method} ${request.url.split('?')[0]}: ${err.message ?? 'unknown'}`,
      );
    const code = err.validation ? 'VALIDATION' : errorCodeForStatus(status);
    const message = status === 500 ? 'Internal server error.' : (err.message ?? 'Bad request.');
    return sendApiError(reply, status, code, message);
  });

  registerHealthRoute(app, version, () => null);
  registerSettingsRoute(app, options.getSettings, options.port);
  registerWebSocketRoute(app, version);
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
