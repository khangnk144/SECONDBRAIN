import type { VaultPath, VaultService } from '../vault/vault-types.js';
import { linkedPathRefusal } from './mcp-permissions.js';
import { McpToolError } from './mcp-tool-result.js';

/**
 * Refuses (`FORBIDDEN`, rule `linked-path`) an MCP write whose path really leads somewhere else
 * (a folder link inside the vault, a Windows short name): the permission table judged the
 * requested path, so the write must land exactly there.
 */
export async function assertRealPath(
  vault: Pick<VaultService, 'realPath'>,
  path: VaultPath,
): Promise<void> {
  const refusal = linkedPathRefusal(path, await vault.realPath(path));
  if (refusal && !refusal.allowed) {
    throw new McpToolError('FORBIDDEN', refusal.message, { rule: refusal.rule, path });
  }
}
