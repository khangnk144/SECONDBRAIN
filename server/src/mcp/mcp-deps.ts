import type { AppContext } from '../app-context/create-app-context.js';
import { SOURCES_PLUGIN } from '../app-context/vault-plugins.js';
import type { GlobalSettings } from '../config/global-settings.js';
import { mcpSettingsOf } from '../config/settings-sections.js';
import { toLocalDate } from '../lib/local-date.js';
import type { SourceTextService } from '../sources/source-types.js';
import type { KeyedLock } from './keyed-lock.js';
import { McpToolError } from './mcp-tool-result.js';

/**
 * What every MCP tool works with. The context is the delegating one (always the vault open now);
 * the tools call the same services as the REST routes, with the caller role `mcp` decided by the
 * permission table, never by the client.
 */
export interface McpDeps {
  context: AppContext;
  /** Current global settings (read on every call: they change at runtime). */
  settings: () => GlobalSettings;
  /** Per-source serialization of ingest manifests; shared by every request. */
  locks: KeyedLock;
}

/** The text service of raw sources (PDF text), looked up per call; `UNAVAILABLE` without it. */
export function sourceService(deps: McpDeps): SourceTextService {
  const service = deps.context.plugin<SourceTextService>(SOURCES_PLUGIN);
  if (!service) {
    throw new McpToolError(
      'UNAVAILABLE',
      'Source text is not available right now; try again later.',
    );
  }
  return service;
}

/** Settings "Cho phép AI sửa ghi chú cá nhân"; anything but an explicit `true` means off. */
export function allowNoteEdits(settings: GlobalSettings): boolean {
  return mcpSettingsOf(settings).allowNoteEdits;
}

export function todayOf(deps: McpDeps): string {
  return toLocalDate(deps.context.now());
}
