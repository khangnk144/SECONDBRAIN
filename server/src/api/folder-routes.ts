import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { guardVaultPath } from '../security/path-guard.js';
import { vaultPathSchema } from './vault-route-schemas.js';

interface FolderRenameBody {
  path: string;
  newPath: string;
  relink?: boolean;
  dryRun?: boolean;
}

const pathBody = {
  type: 'object',
  required: ['path'],
  properties: { path: vaultPathSchema },
} as const;

/**
 * Folder create, rename/move (with relink) and trash (SPEC §9, F2). Rename and trash are
 * journaled and undone through `POST /journal/:id/undo`; the standard folders of SPEC §3 are
 * refused with 403 `FORBIDDEN`.
 */
export function registerFolderRoutes(app: FastifyInstance, context: AppContext): void {
  const afterOperation = async () => {
    await context.settled();
    await context.refreshPendingJournal();
  };

  app.post<{ Body: { path: string } }>(
    '/api/folder',
    { schema: { body: pathBody } },
    async (request, reply) => {
      const path = guardVaultPath(request.body.path);
      await context.vault.createFolder(path);
      await context.settled();
      return reply.code(201).send({ path });
    },
  );

  app.post<{ Body: FolderRenameBody }>(
    '/api/folder/rename',
    {
      schema: {
        body: {
          type: 'object',
          required: ['path', 'newPath'],
          properties: {
            path: vaultPathSchema,
            newPath: vaultPathSchema,
            relink: { type: 'boolean', default: true },
            dryRun: { type: 'boolean', default: false },
          },
        },
      },
    },
    async (request) => {
      const path = guardVaultPath(request.body.path);
      const newPath = guardVaultPath(request.body.newPath);
      const { relink = true, dryRun = false } = request.body;
      if (dryRun) return context.vault.previewRenameFolder(path, newPath, { relink });
      try {
        return await context.vault.renameFolder(path, newPath, { relink });
      } finally {
        await afterOperation();
      }
    },
  );

  app.post<{ Body: { path: string } }>(
    '/api/folder/trash',
    { schema: { body: pathBody } },
    async (request) => {
      const path = guardVaultPath(request.body.path);
      try {
        return await context.vault.trashFolder(path);
      } finally {
        await afterOperation();
      }
    },
  );
}
