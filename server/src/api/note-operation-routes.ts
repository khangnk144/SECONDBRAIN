import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { isNotePath } from '../markdown/content-classes.js';
import { guardVaultPath } from '../security/path-guard.js';
import { VaultError, type VaultPath } from '../vault/vault-types.js';
import { revisionSchema, vaultPathSchema } from './vault-route-schemas.js';

interface RenameBody {
  path: string;
  newPath: string;
  expectedRevision: string;
  relink?: boolean;
  dryRun?: boolean;
}

interface MoveBody {
  path: string;
  folder: string;
  expectedRevision: string;
  relink?: boolean;
  dryRun?: boolean;
}

interface TrashBody {
  paths: string[];
  expectedRevisions: string[];
}

/** `''` = the vault root; any other folder goes through the path guard. */
function guardFolder(input: string): VaultPath {
  return input === '' ? '' : guardVaultPath(input);
}

/** `dryRun: true` answers what would happen (same checks and planner) and changes nothing. */
const dryRunSchema = { type: 'boolean', default: false } as const;

/**
 * Rename, move and trash: multi-file, journaled operations (SPEC §4.12). Each answer is sent
 * after the index reflects the change, and the journal state is re-broadcast because a failed
 * operation may leave an entry the UI must offer to finish or undo. Rename and move also answer
 * dry runs, used by the confirm dialog to list the notes whose links would change (F4).
 */
export function registerNoteOperationRoutes(app: FastifyInstance, context: AppContext): void {
  const { vault } = context;
  // Neither step throws, so the `finally` below never hides the operation's own error.
  const afterOperation = async () => {
    await context.settled();
    await context.refreshPendingJournal();
  };

  app.post<{ Body: RenameBody }>(
    '/api/note/rename',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path', 'newPath', 'expectedRevision'],
          properties: {
            path: vaultPathSchema,
            newPath: vaultPathSchema,
            expectedRevision: revisionSchema,
            relink: { type: 'boolean', default: true },
            dryRun: dryRunSchema,
          },
        },
      },
    },
    async (request) => {
      const path = guardVaultPath(request.body.path);
      const newPath = guardVaultPath(request.body.newPath);
      if (isNotePath(path) !== isNotePath(newPath)) {
        throw new VaultError('VALIDATION', 'A rename cannot turn a note into another file type.', {
          path,
          newPath,
        });
      }
      const { expectedRevision, relink = true, dryRun = false } = request.body;
      if (dryRun) return vault.previewRename(path, newPath, { expectedRevision, relink });
      try {
        return await vault.rename(path, newPath, { expectedRevision, relink });
      } finally {
        await afterOperation();
      }
    },
  );

  app.post<{ Body: MoveBody }>(
    '/api/note/move',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path', 'folder', 'expectedRevision'],
          properties: {
            path: vaultPathSchema,
            folder: vaultPathSchema,
            expectedRevision: revisionSchema,
            relink: { type: 'boolean', default: true },
            dryRun: dryRunSchema,
          },
        },
      },
    },
    async (request) => {
      const path = guardVaultPath(request.body.path);
      const folder = guardFolder(request.body.folder);
      const { expectedRevision, relink = true, dryRun = false } = request.body;
      if (dryRun) return vault.previewMove(path, folder, { expectedRevision, relink });
      try {
        return await vault.move(path, folder, { expectedRevision, relink });
      } finally {
        await afterOperation();
      }
    },
  );

  app.post<{ Body: TrashBody }>(
    '/api/note/trash',
    {
      schema: {
        body: {
          type: 'object',
          required: ['paths', 'expectedRevisions'],
          properties: {
            paths: { type: 'array', minItems: 1, maxItems: 1000, items: vaultPathSchema },
            expectedRevisions: {
              type: 'array',
              minItems: 1,
              maxItems: 1000,
              items: revisionSchema,
            },
          },
        },
      },
    },
    async (request) => {
      const { expectedRevisions } = request.body;
      const paths = request.body.paths.map(guardVaultPath);
      if (paths.length !== expectedRevisions.length) {
        throw new VaultError('VALIDATION', 'Give one expected revision per path.', {});
      }
      try {
        return await vault.trash(paths, expectedRevisions, 'user');
      } finally {
        await afterOperation();
      }
    },
  );
}
