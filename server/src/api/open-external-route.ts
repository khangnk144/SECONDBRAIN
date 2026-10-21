import { realpath } from 'node:fs/promises';
import nodePath from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { isExecutableFileName, openExternalCommand } from '../attachments/open-external-command.js';
import { guardVaultPath } from '../security/path-guard.js';
import { VaultError } from '../vault/vault-types.js';
import { spawnDetached, type RevealOptions } from './reveal-command.js';
import { vaultPathSchema } from './vault-route-schemas.js';

/**
 * `POST /api/files/open-external { path }` → 204 (SPEC F15 "Mở bằng ứng dụng khác"): opens an
 * existing vault file with the OS default app through the same injectable launcher as reveal.
 * Path guard (never `.secondbrain/`), files only (a folder → 400), missing → 404, programs and
 * scripts refused (400). Nothing in the vault changes.
 */
export function registerOpenExternalRoute(
  app: FastifyInstance,
  context: AppContext,
  options: RevealOptions = {},
): void {
  const onError =
    options.onError ??
    ((code: string) => context.logger.warn(`Could not open a file with the OS (${code}).`));
  const spawn = options.spawn ?? spawnDetached(onError);
  const platform = options.platform ?? process.platform;

  app.post<{ Body: { path: string } }>(
    '/api/files/open-external',
    {
      schema: {
        body: { type: 'object', required: ['path'], properties: { path: vaultPathSchema } },
      },
    },
    async (request, reply) => {
      const entry = await context.vault.resolveEntry(guardVaultPath(request.body.path));
      if (entry.kind !== 'file') {
        throw new VaultError('VALIDATION', 'Only files can be opened with another app.', {
          path: entry.path,
          reason: 'not-a-file',
        });
      }
      // The name actually opened decides too (a link named `.pdf` may point at a program).
      const real = await realpath(entry.abs);
      if (isExecutableFileName(entry.path) || isExecutableFileName(nodePath.basename(real))) {
        throw new VaultError('VALIDATION', 'Programs and scripts are not opened from the app.', {
          path: entry.path,
          reason: 'executable',
        });
      }
      spawn(openExternalCommand(platform, real));
      return reply.code(204).send();
    },
  );
}
