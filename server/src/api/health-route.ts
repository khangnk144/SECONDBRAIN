import type { FastifyInstance } from 'fastify';
import { APP_ID } from '../version.js';

export interface HealthResponse {
  ok: true;
  app: typeof APP_ID;
  version: string;
  vaultId: string | null;
}

/** Public liveness probe (no token): used by the launcher and the single-instance check. */
export function registerHealthRoute(
  app: FastifyInstance,
  version: string,
  getVaultId: () => string | null,
): void {
  app.get('/api/health', async (_request, reply): Promise<HealthResponse> => {
    reply.header('cache-control', 'no-store');
    return { ok: true, app: APP_ID, version, vaultId: getVaultId() };
  });
}
