/** `GET /api/mcp/config`, mirrored by hand from `server/src/api/mcp-config-route.ts`. */

export interface McpConfig {
  /** What Claude Desktop runs: the Node binary and the bridge script (absolute paths). */
  stdio: { command: string; args: string[] };
  /** `claude_desktop_config.json` text (2-space JSON). */
  stdioSnippet: string;
  http: { url: string };
  /** The same for the HTTP transport; holds the session token as `Bearer <token>`. */
  httpSnippet: string;
  /** The bridge file exists (a fresh checkout has no build yet). */
  bridgeBuilt: boolean;
}
