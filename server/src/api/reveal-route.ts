import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app-context/create-app-context.js';
import { guardVaultPath } from '../security/path-guard.js';
import { revealCommand, spawnDetached, type RevealOptions } from './reveal-command.js';
import { vaultPathSchema } from './vault-route-schemas.js';

/**
 * "Hiện trong Explorer" (SPEC F2): opens the OS file manager at a vault file or folder. The path
 * goes through the path guard and must exist (404 otherwise); nothing in the vault changes.
 */
export function registerRevealRoute(
  app: FastifyInstance,
  context: AppContext,
  options: RevealOptions = {},
): void {
  const onError =
    options.onError ??
    ((code: string) => context.logger.warn(`Could not open the file manager (${code}).`));
  const spawn = options.spawn ?? spawnDetached(onError);
  const platform = options.platform ?? process.platform;

  app.post<{ Body: { path: string } }>(
    '/api/reveal',
    {
      schema: {
        body: { type: 'object', required: ['path'], properties: { path: vaultPathSchema } },
      },
    },
    async (request, reply) => {
      const entry = await context.vault.resolveEntry(guardVaultPath(request.body.path));
      spawn(revealCommand(platform, entry.abs));
      return reply.code(204).send();
    },
  );
}
