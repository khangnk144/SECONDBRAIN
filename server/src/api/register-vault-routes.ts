import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { registerCaptureRoute } from './capture-route.js';
import { registerDailyRoutes } from './daily-routes.js';
import { registerFilesRoute } from './files-route.js';
import { registerFolderRoutes } from './folder-routes.js';
import { registerGraphRoutes } from './graph-routes.js';
import { registerJournalRoutes } from './journal-routes.js';
import { registerMaintenanceRoutes } from './maintenance-routes.js';
import { registerNoteFrontmatterRoutes } from './note-frontmatter-routes.js';
import { registerNoteMentionRoutes } from './note-mention-routes.js';
import { registerNoteOperationRoutes } from './note-operation-routes.js';
import { registerNoteRoutes } from './note-routes.js';
import { registerNoteTaskRoutes } from './note-task-routes.js';
import { registerQueryRoutes } from './query-routes.js';
import type { TemplateLanguage } from '../templates/template-variables.js';
import type { RevealOptions } from './reveal-command.js';
import { registerRevealRoute } from './reveal-route.js';
import { registerVaultListingRoutes } from './vault-listing-routes.js';

export interface VaultRouteOptions {
  /** How "reveal in Explorer" launches the file manager (tests record the command instead). */
  reveal?: RevealOptions;
  /** UI language of the global settings: template variables are written in it (F13.2). */
  uiLanguage?: () => TemplateLanguage;
}

/**
 * Every REST route that needs an open vault (SPEC §9). Token, Origin and Host rules are already
 * enforced by the root security hook; `VaultError`s become `{ error: { code, message, details } }`
 * in the app's error handler. Paths travel in the `path` query parameter (GET) or the JSON body
 * (mutations), never as URL segments.
 */
export function registerVaultRoutes(
  app: FastifyInstance,
  context: AppContext,
  options: VaultRouteOptions = {},
): void {
  registerVaultListingRoutes(app, context);
  const uiLanguage = options.uiLanguage ?? (() => 'vi');
  registerNoteRoutes(app, context, uiLanguage);
  registerNoteFrontmatterRoutes(app, context);
  registerNoteMentionRoutes(app, context);
  registerNoteTaskRoutes(app, context);
  registerCaptureRoute(app, context);
  registerDailyRoutes(app, context, uiLanguage);
  registerNoteOperationRoutes(app, context);
  registerFolderRoutes(app, context);
  registerRevealRoute(app, context, options.reveal);
  registerJournalRoutes(app, context);
  registerQueryRoutes(app, context);
  registerGraphRoutes(app, context);
  registerFilesRoute(app, context);
  registerMaintenanceRoutes(app, context);
}
