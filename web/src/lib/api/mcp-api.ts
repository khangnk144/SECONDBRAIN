/** Settings "Kết nối Claude (MCP)" (SPEC F18, F32.1). */
import { api } from '../api';
import type { McpConfig } from './mcp-types';

/** Both connection snippets; read-only, never cached by the server. */
export function getMcpConfig(): Promise<McpConfig> {
  return api().get<McpConfig>('/mcp/config');
}
