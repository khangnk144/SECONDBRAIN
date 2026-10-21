import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { runMcpBridge, type McpBridge } from '../../src/mcp/mcp-bridge.js';
import { makeTempDir, removeDir, TEST_TOKEN } from '../helpers/test-environment.js';
import type { VaultTestApp } from '../api/vault-test-app.js';
import { ALL_TOOLS, createMcpTestApp } from './mcp-test-kit.js';
import { StreamClientTransport } from './stream-client-transport.js';

const PORT = 47721;
const DOWN_PORT = 47729;
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

function writeSettings(home: string, port: number, token: string) {
  mkdirSync(path.join(home, '.secondbrain'), { recursive: true });
  writeFileSync(
    path.join(home, '.secondbrain', 'settings.json'),
    JSON.stringify({ port, sessionToken: token }),
  );
}

/** The bridge with in-memory stdio, and an SDK client on the other end (as Claude Desktop). */
async function bridgeClient(home: string, extra: Partial<Parameters<typeof runMcpBridge>[0]> = {}) {
  const io = new StreamClientTransport();
  const bridge = await runMcpBridge({
    home,
    appDir: '/nowhere',
    stdin: io.stdin,
    stdout: io.stdout,
    stderr: io.stderr,
    startServer: () => {
      throw new Error('the server is already running');
    },
    pollMs: 100,
    ...extra,
  });
  const client = new Client({ name: 'claude-desktop-stand-in', version: '1.0.0' });
  return { io, bridge, client };
}

describe('stdio bridge to the running server (F32.1, F32.5)', () => {
  let t: VaultTestApp;
  let home: string;
  const open: { bridge: McpBridge; client: Client }[] = [];
  beforeAll(async () => {
    t = await createMcpTestApp(PORT, { listen: true });
    home = makeTempDir('sb bridge home Cầu nối');
    writeSettings(home, PORT, TEST_TOKEN);
  });
  afterEach(async () => {
    for (const { client, bridge } of open.splice(0)) {
      await client.close();
      await bridge.closed;
    }
  });
  afterAll(async () => {
    await t?.close();
    removeDir(home);
  });

  it('lists every tool and runs search_notes; stdout carries protocol messages only', async () => {
    const { io, bridge, client } = await bridgeClient(home);
    open.push({ bridge, client });
    await client.connect(io);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(ALL_TOOLS);
    const search = await client.callTool({ name: 'search_notes', arguments: { query: 'paper' } });
    expect(search.isError).toBeFalsy();
    expect(search.structuredContent).toHaveProperty('results');
    for (const line of io.stdoutText.join('').split('\n').filter(Boolean)) {
      expect(JSON.parse(line)).toHaveProperty('jsonrpc', '2.0');
    }
    expect(io.stderrText.join('')).toContain('second-brain-mcp: CONNECTED');
  });

  it('a capture through the bridge reaches WebSocket clients as note:created within 1 s', async () => {
    const socket = new WebSocket(`ws://localhost:${PORT}/ws?token=${TEST_TOKEN}`);
    const created = new Promise<{ path: string; at: number }>((resolve) => {
      socket.on('message', (data) => {
        const event = JSON.parse(String(data)) as { type: string; path?: string };
        if (event.type === 'note:created' && event.path?.startsWith('0 Inbox/')) {
          resolve({ path: event.path, at: Date.now() });
        }
      });
    });
    await new Promise((resolve) => socket.once('open', resolve));
    const { io, bridge, client } = await bridgeClient(home);
    open.push({ bridge, client });
    await client.connect(io);
    const started = Date.now();
    const result = await client.callTool({
      name: 'capture_to_inbox',
      arguments: { text: 'Từ Claude Desktop' },
    });
    const event = await created;
    socket.close();
    expect((result.structuredContent as { path: string }).path).toBe(
      '0 Inbox/Từ Claude Desktop.md',
    );
    expect(event.path).toBe('0 Inbox/Từ Claude Desktop.md');
    expect(event.at - started).toBeLessThan(1000);
  });

  it('re-reads the token once after a 401', async () => {
    const otherHome = makeTempDir('sb bridge token Mã');
    try {
      writeSettings(otherHome, PORT, 'stale-token-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
      const { io, bridge, client } = await bridgeClient(otherHome);
      open.push({ bridge, client });
      writeSettings(otherHome, PORT, TEST_TOKEN);
      await client.connect(io);
      expect((await client.listTools()).tools).toHaveLength(ALL_TOOLS.length);
    } finally {
      removeDir(otherHome);
    }
  });

  it('with the server down it calls startServer once and waits for health', async () => {
    const downHome = makeTempDir('sb bridge down Tắt');
    let starts = 0;
    let started: VaultTestApp | null = null;
    try {
      writeSettings(downHome, DOWN_PORT, TEST_TOKEN);
      const { io, bridge, client } = await bridgeClient(downHome, {
        startServer: () => {
          starts += 1;
          void createMcpTestApp(DOWN_PORT, { listen: true }).then((app) => {
            started = app;
          });
        },
      });
      open.push({ bridge, client });
      expect(starts).toBe(1);
      await client.connect(io);
      expect((await client.listTools()).tools.length).toBe(ALL_TOOLS.length);
      expect(io.stderrText.join('')).toContain('SERVER_STARTING');
      await client.close();
      await bridge.closed;
      open.pop();
    } finally {
      await (started as VaultTestApp | null)?.close();
      removeDir(downHome);
    }
  });

  it('gives up with a code when the server never answers', async () => {
    const deadHome = makeTempDir('sb bridge dead Chết');
    try {
      writeSettings(deadHome, DOWN_PORT, TEST_TOKEN);
      const io = new StreamClientTransport();
      await expect(
        runMcpBridge({
          home: deadHome,
          appDir: '/nowhere',
          stdin: io.stdin,
          stdout: io.stdout,
          stderr: io.stderr,
          startServer: () => undefined,
          startTimeoutMs: 300,
          pollMs: 50,
        }),
      ).rejects.toThrow('SERVER_UNREACHABLE');
      expect(io.stderrText.join('')).toContain('SERVER_UNREACHABLE');
      expect(io.stdoutText).toEqual([]);
    } finally {
      removeDir(deadHome);
    }
  });
});

describe('stdio bridge import graph (F32.5)', () => {
  it('reaches no vault, index, watcher, reminder, history, AI or app-context module', () => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/(?:import|export)[^'"]*?from\s+'(\.[^']+)'/g)) {
        visit(path.resolve(path.dirname(file), (match[1] as string).replace(/\.js$/, '.ts')));
      }
    };
    visit(path.join(SRC, 'mcp-stdio.ts'));
    const reached = [...seen].map((file) => path.relative(SRC, file).split(path.sep).join('/'));
    expect(reached).toContain('mcp/mcp-bridge.ts');
    const forbidden =
      /^(vault|index|reminders|git|ai|app-context|sources|ws|api|http|graph|markdown|backup)\//;
    expect(reached.filter((file) => forbidden.test(file) || file.includes('watcher'))).toEqual([]);
    expect(reached.sort()).toEqual([
      'config/app-paths.ts',
      'mcp-stdio.ts',
      'mcp/bridge-server.ts',
      'mcp/mcp-bridge.ts',
      'version.ts',
    ]);
  });
});
