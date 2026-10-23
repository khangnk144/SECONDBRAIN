import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import type { GlobalSettings } from '../config/global-settings.js';
import { registerAiRoutes } from './ai-routes.js';
import { registerAiStatusRoutes } from './ai-status-routes.js';
import { registerAttachmentRoutes } from './attachment-routes.js';
import { registerBackupScheduleRoutes } from './backup-schedule-routes.js';
import { registerCaptureRoute } from './capture-route.js';
import { registerDailyRoutes } from './daily-routes.js';
import { registerFilesRoute } from './files-route.js';
import { registerFolderRoutes } from './folder-routes.js';
import { registerGraphRoutes } from './graph-routes.js';
import { registerHistoryRoutes } from './history-routes.js';
import { registerJournalRoutes } from './journal-routes.js';
import { registerMaintenanceRoutes } from './maintenance-routes.js';
import { registerNoteFrontmatterRoutes } from './note-frontmatter-routes.js';
import { registerNoteMentionRoutes } from './note-mention-routes.js';
import { registerNoteOperationRoutes } from './note-operation-routes.js';
import { registerNoteRoutes } from './note-routes.js';
import { registerNoteTaskRoutes } from './note-task-routes.js';
import { registerNotifyRoutes } from './notify-routes.js';
import type { ChannelDeps } from '../reminders/channels/channel-types.js';
import { registerOpenExternalRoute } from './open-external-route.js';
import { registerQueryRoutes } from './query-routes.js';
import { registerReminderRoutes } from './reminder-routes.js';
import { registerResourcesRoutes } from './resources-routes.js';
import { registerReviewRoutes } from './review-routes.js';
import { registerSemesterPageRoutes } from './semester-page-routes.js';
import type { TemplateLanguage } from '../templates/template-variables.js';
import type { RevealOptions } from './reveal-command.js';
import { registerRevealRoute } from './reveal-route.js';
import { registerVaultListingRoutes } from './vault-listing-routes.js';

export interface VaultRouteOptions {
  /** How "reveal in Explorer" launches the file manager (tests record the command instead). */
  reveal?: RevealOptions;
  /** UI language of the global settings: template variables are written in it (F13.2). */
  uiLanguage?: () => TemplateLanguage;
  /** Global settings (the reminder time is reported even when the reminder plugin is off). */
  settings?: () => GlobalSettings;
  /** M5 (F31): network of the Telegram/email test messages (tests inject fetch and SMTP). */
  notify?: ChannelDeps;
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
  registerAttachmentRoutes(app, context);
  registerResourcesRoutes(app, context);
  registerOpenExternalRoute(app, context, options.reveal);
  registerHistoryRoutes(app, context);
  registerMaintenanceRoutes(app, context);
  registerReminderRoutes(app, context, { settings: options.settings });
  registerBackupScheduleRoutes(app, context, options.reveal);
  // M5: weekly review (F26) and the generated "Học kỳ này" page (F25).
  registerReviewRoutes(app, context);
  registerSemesterPageRoutes(app, context, { settings: options.settings });
  if (options.settings) {
    registerNotifyRoutes(app, context, { settings: options.settings, channels: options.notify });
    registerAiStatusRoutes(app, context, { settings: options.settings });
    registerAiRoutes(app, context, { settings: options.settings });
  }
}
