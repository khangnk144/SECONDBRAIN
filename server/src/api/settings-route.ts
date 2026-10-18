import type { FastifyInstance } from 'fastify';
import type { GlobalSettings, UiSettings } from '../config/global-settings.js';

export interface PublicSettingsResponse {
  port: number;
  ui: UiSettings;
}

/**
 * Builds the client view of the settings from an explicit allowlist of fields, so the
 * session token and any future secret (API keys) can never leak through this endpoint.
 */
export function toPublicSettings(settings: GlobalSettings, port: number): PublicSettingsResponse {
  const { name, language, theme, palette, fontSize } = settings.ui;
  return { port, ui: { name, language, theme, palette, fontSize } };
}

export function registerSettingsRoute(
  app: FastifyInstance,
  getSettings: () => GlobalSettings,
  port: number,
): void {
  app.get('/api/settings', async (_request, reply): Promise<PublicSettingsResponse> => {
    reply.header('cache-control', 'no-store');
    return toPublicSettings(getSettings(), port);
  });
}
