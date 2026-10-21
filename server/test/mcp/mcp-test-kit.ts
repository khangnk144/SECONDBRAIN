/**
 * MCP test helpers: a real vault host (`createVaultTestApp`) with a fake source-text service
 * (the text of each raw source is scripted per path), a scripted MCP client over an in-memory
 * transport, and a recorder of WebSocket broadcasts.
 */
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AppContext } from '../../src/app-context/create-app-context.js';
import { SOURCES_PLUGIN, type VaultPlugin } from '../../src/app-context/vault-plugins.js';
import { connectMcpServer, createMcpServer } from '../../src/mcp/create-mcp-server.js';
import { KeyedLock } from '../../src/mcp/keyed-lock.js';
import type { McpDeps } from '../../src/mcp/mcp-deps.js';
import { guardVaultPath } from '../../src/security/path-guard.js';
import type {
  ExtractionQuality,
  ExtractionReason,
  SourceStatus,
  SourceText,
  SourceTextService,
} from '../../src/sources/source-types.js';
import type { ServerEvent } from '../../src/ws/server-events.js';
import { createVaultTestApp, type VaultTestApp } from '../api/vault-test-app.js';

/** Every tool of SPEC F32 plus `write_note`, sorted. */
export const ALL_TOOLS = [
  'append_to_daily',
  'capture_to_inbox',
  'get_backlinks',
  'get_today',
  'get_upcoming_deadlines',
  'graph_neighbors',
  'ingest_begin',
  'ingest_complete',
  'ingest_fail',
  'list_notes',
  'list_sources',
  'read_note',
  'read_source',
  'search_notes',
  'wiki_index_update',
  'wiki_lint',
  'wiki_log_append',
  'write_note',
  'write_wiki_page',
];

/**
 * `createVaultTestApp` with `/mcp` and `GET /api/mcp/config` registered the way the lead wires
 * them (the routes read the vault host's context per request).
 */
export async function createMcpTestApp(
  port: number,
  options: Parameters<typeof createVaultTestApp>[1] = {},
): Promise<VaultTestApp> {
  return createVaultTestApp(port, {
    ...options,
    // `/mcp` and `/api/mcp/config` come with the app (build-app registers them).
    appDir: options.appDir ?? '/opt/second brain/app',
    homeDir: options.homeDir,
  });
}

export interface FakeSourceText {
  pages: string[];
  quality?: ExtractionQuality;
  reason?: ExtractionReason | null;
  title?: string;
}

const SUPPORTED = /\.(pdf|md|txt|html?)$/i;
const key = (path: string) => path.normalize('NFC').toLowerCase();

export const fakeSourceId = (path: string) =>
  `src_${createHash('sha256').update(key(path)).digest('hex').slice(0, 16)}`;

/** Scripted text per source path; files without a script read as one page of their bytes. */
export function createFakeSources(
  context: AppContext,
  scripts: Map<string, FakeSourceText>,
): SourceTextService {
  const scriptOf = async (path: string): Promise<Required<FakeSourceText>> => {
    const script = scripts.get(path);
    const bytes = await context.vault.readBytes(path);
    return {
      pages: script?.pages ?? [bytes.bytes.toString('utf8')],
      quality: script?.quality ?? 'ok',
      reason: script?.reason ?? null,
      title: script?.title ?? path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, ''),
    };
  };
  const status = async (input: string): Promise<SourceStatus | null> => {
    const path = guardVaultPath(input);
    if (!SUPPORTED.test(path) || (await context.vault.stat(path)) === null) return null;
    const { revision } = await context.vault.readBytes(path);
    const script = await scriptOf(path);
    return {
      path,
      sourceId: fakeSourceId(path),
      contentHash: revision,
      quality: script.quality,
      pageCount: script.pages.length,
      reason: script.reason,
    };
  };
  return {
    async read(input, options = {}): Promise<SourceText> {
      const path = guardVaultPath(input);
      const bytes = await context.vault.readBytes(path);
      const script = await scriptOf(path);
      const last = script.pages.length;
      const from = Math.min(Math.max(options.fromPage ?? 1, 1), last);
      const to = Math.min(Math.max(options.toPage ?? last, from), last);
      return {
        path: bytes.path,
        sourceId: fakeSourceId(bytes.path),
        contentHash: bytes.revision,
        title: script.title,
        pageCount: last,
        pages: script.pages.slice(from - 1, to).map((text, i) => ({ page: from + i, text })),
        extractionQuality: script.quality,
        reason: script.reason,
      };
    },
    status,
    async listSources() {
      const files = (await context.vault.list()).files
        .map((file) => file.path)
        .filter((path) => key(path).startsWith('3 resources/') && SUPPORTED.test(path))
        .sort();
      const out: SourceStatus[] = [];
      for (const path of files) {
        const entry = await status(path);
        if (entry) out.push(entry);
      }
      return out;
    },
    sourceIdOf: fakeSourceId,
    async close() {},
  };
}

export function fakeSourcesPlugin(scripts: Map<string, FakeSourceText>): VaultPlugin {
  return {
    name: SOURCES_PLUGIN,
    start: async (host) => createFakeSources(host.context, scripts),
  };
}

export interface ToolCall {
  isError: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export interface McpTestClient {
  client: Client;
  call(name: string, args?: Record<string, unknown>): Promise<ToolCall>;
  close(): Promise<void>;
}

/** A scripted MCP client talking to a fresh server over an in-memory transport pair. */
export async function connectTestClient(
  t: VaultTestApp,
  locks = new KeyedLock(),
): Promise<McpTestClient> {
  const deps: McpDeps = { context: t.context, settings: () => t.settings, locks };
  const server = createMcpServer(deps);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await connectMcpServer(server, serverSide, deps);
  const client = new Client({ name: 'scripted-test-client', version: '1.0.0' });
  await client.connect(clientSide);
  return {
    client,
    async call(name, args = {}) {
      const result = await client.callTool({ name, arguments: args });
      return { isError: result.isError === true, data: result.structuredContent };
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

/** Every event the hub broadcasts from now on (a socket that only records). */
export function recordBroadcasts(t: VaultTestApp): ServerEvent[] {
  const events: ServerEvent[] = [];
  t.host.hub.add({
    readyState: 1,
    bufferedAmount: 0,
    send: (data) => events.push(JSON.parse(data) as ServerEvent),
    terminate: () => undefined,
    on: () => undefined,
  });
  return events;
}
