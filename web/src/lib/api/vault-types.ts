/**
 * Shapes shared by every endpoint, mirrored by hand from the server
 * (`server/src/vault/vault-types.ts`, `server/src/markdown/markdown-types.ts`).
 */

/** Vault-relative path: forward slashes, NFC, no leading slash. `''` = the vault root folder. */
export type VaultPath = string;

/** SPEC §4.2 content classes. */
export type ContentClass =
  'user' | 'archived' | 'template' | 'source' | 'wiki' | 'control' | 'attachment';

/** `GET /api/health` (no token needed). `vaultId` is null while no vault is open. */
export interface HealthResponse {
  ok: true;
  app: string;
  version: string;
  vaultId: string | null;
}
