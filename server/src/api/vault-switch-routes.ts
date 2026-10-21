import type { FastifyInstance } from 'fastify';
import type { VaultHost } from '../app-context/vault-host.js';
import { assertBody, type BodySchema } from '../http/strict-body-schema.js';

const SWITCH_BODY: BodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    // An absolute folder on this machine; null = the default `<home>/vault`.
    path: {
      type: ['string', 'null'],
      minLength: 1,
      maxLength: 4096,
      pattern: '^[^\\u0000-\\u001f]*$',
    },
  },
};

/**
 * `POST /api/vault/switch { path }` (SPEC F18.3) → 200 `{ vaultId, path }`. Requests arriving
 * meanwhile wait and are answered by the new vault; on failure the previous vault is open again
 * and the answer is 400 `VAULT_UNUSABLE` with `details.reason`. Clients get `vault:switched`.
 */
export function registerVaultSwitchRoutes(app: FastifyInstance, host: VaultHost): void {
  app.post('/api/vault/switch', async (request) => {
    const body = assertBody<{ path: string | null }>(SWITCH_BODY, request.body);
    return host.switchTo(body.path);
  });
}
