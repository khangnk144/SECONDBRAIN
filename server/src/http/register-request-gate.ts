import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RequestGate } from '../app-context/request-gate.js';
import {
  decodedRequestPath,
  isApiPath,
  isWebSocketPath,
} from '../security/host-and-origin-rules.js';
import { sendApiError } from './api-errors.js';

/** Optional request header: the vault the client believes is open (see the check below). */
export const VAULT_ID_HEADER = 'x-sb-vault-id';

/**
 * Never held: the launcher's liveness probe, and the switch itself (a second switch must be
 * refused at once, not queued behind the first).
 */
const UNGATED = new Set(['/api/health', '/api/vault/switch']);

const releases = new WeakMap<FastifyRequest, () => void>();

/**
 * Root onRequest hook (after the security hook): API requests wait at the gate while a vault
 * switch runs and are counted while they run; WebSocket upgrades only wait, so clients that
 * connect after a switch are greeted by the new vault. A request carrying `x-sb-vault-id` for a
 * vault that is no longer open is refused with 409 `CONFLICT` (`reason: 'vault-switched'`), so a
 * save queued behind a switch can never land in the other vault.
 */
export function registerRequestGate(
  app: FastifyInstance,
  gate: RequestGate,
  currentVaultId: () => string,
): void {
  app.addHook('onRequest', async (request, reply) => {
    const path = decodedRequestPath(request.url);
    if (isWebSocketPath(path)) {
      await gate.pass();
      return;
    }
    if (!isApiPath(path) || UNGATED.has(path.toLowerCase())) return;
    const release = await gate.enter();
    releases.set(request, release);
    reply.raw.once('close', release);
    const header = request.headers[VAULT_ID_HEADER];
    const expected = Array.isArray(header) ? header[0] : header;
    const vaultId = currentVaultId();
    if (expected !== undefined && expected !== vaultId) {
      return sendApiError(reply, 409, 'CONFLICT', 'Another vault is open now; reload the app.', {
        reason: 'vault-switched',
        vaultId,
      });
    }
  });
  app.addHook('onResponse', async (request) => {
    releases.get(request)?.();
  });
}

/**
 * A request that is about to switch vaults itself (restore with `open`) stops counting as in
 * flight, or the switch would wait for it.
 */
export function releaseFromGate(request: FastifyRequest): void {
  releases.get(request)?.();
}
