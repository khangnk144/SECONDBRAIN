// A scripted MCP client over Streamable HTTP, as Claude Desktop (or any MCP app) talks to
// `http://localhost:<port>/mcp`: the SDK's `Client` with the bearer token of the server's
// settings file (the session token). Tool results come back as `{ isError, data }`.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

/** The session token stored in `<home>/.secondbrain/settings.json` (the MCP bearer token). */
export function settingsToken(home: string): string {
  const file = path.join(home, '.secondbrain', 'settings.json');
  const settings = JSON.parse(readFileSync(file, 'utf8')) as { sessionToken?: string };
  if (!settings.sessionToken) throw new Error('no session token in settings.json');
  return settings.sessionToken;
}

export interface ToolResult {
  isError: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export interface ScriptedMcpClient {
  listTools(): Promise<string[]>;
  call(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
  close(): Promise<void>;
}

export async function connectMcp(origin: string, token: string): Promise<ScriptedMcpClient> {
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'e2e-scripted-client', version: '1.0.0' });
  await client.connect(transport);
  return {
    async listTools() {
      return (await client.listTools()).tools.map((tool) => tool.name);
    },
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      let data: unknown = result.structuredContent;
      if (data === undefined) {
        const first = (result.content as { type: string; text?: string }[] | undefined)?.[0];
        try {
          data = first?.text ? JSON.parse(first.text) : null;
        } catch {
          data = first?.text ?? null;
        }
      }
      return { isError: result.isError === true, data };
    },
    close: () => client.close(),
  };
}
