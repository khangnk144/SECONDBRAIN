import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { registerFilesRoute } from './files-route.js';
import { registerFolderRoutes } from './folder-routes.js';
import { registerJournalRoutes } from './journal-routes.js';
import { registerMaintenanceRoutes } from './maintenance-routes.js';
import { registerNoteFrontmatterRoutes } from './note-frontmatter-routes.js';
import { registerNoteMentionRoutes } from './note-mention-routes.js';
import { registerNoteOperationRoutes } from './note-operation-routes.js';
import { registerNoteRoutes } from './note-routes.js';
import { registerQueryRoutes } from './query-routes.js';
import type { RevealOptions } from './reveal-command.js';
import { registerRevealRoute } from './reveal-route.js';
import { registerVaultListingRoutes } from './vault-listing-routes.js';

export interface VaultRouteOptions {
  /** How "reveal in Explorer" launches the file manager (tests record the command instead). */
  reveal?: RevealOptions;
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
  registerNoteRoutes(app, context);
  registerNoteFrontmatterRoutes(app, context);
  registerNoteMentionRoutes(app, context);
  registerNoteOperationRoutes(app, context);
  registerFolderRoutes(app, context);
  registerRevealRoute(app, context, options.reveal);
  registerJournalRoutes(app, context);
  registerQueryRoutes(app, context);
  registerFilesRoute(app, context);
  registerMaintenanceRoutes(app, context);
}
