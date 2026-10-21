import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mcpConfig } from '../../src/api/mcp-config-route.js';
import { makeTempDir, removeDir, TEST_TOKEN } from '../helpers/test-environment.js';
import type { VaultTestApp } from '../api/vault-test-app.js';
import { createMcpTestApp } from './mcp-test-kit.js';

const PORT = 47727;

describe('GET /api/mcp/config: the Claude Desktop snippets (F32.1)', () => {
  let t: VaultTestApp;
  let install: string;
  let appDir: string;
  beforeAll(async () => {
    install = makeTempDir('sb install Cài đặt');
    appDir = path.join(install, 'app');
    t = await createMcpTestApp(PORT, { appDir, homeDir: install });
  });
  afterAll(async () => {
    await t?.close();
    removeDir(install);
  });

  it('gives the stdio command, both snippets and whether the bridge is built', async () => {
    const bridge = path.join(appDir, 'server', 'dist', 'mcp-stdio.js');
    const first = await t.call('GET', '/api/mcp/config');
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const config = first.json();
    expect(config.stdio).toEqual({ command: process.execPath, args: [bridge] });
    expect(JSON.parse(config.stdioSnippet)).toEqual({
      mcpServers: { 'second-brain': config.stdio },
    });
    expect(config.stdioSnippet).toBe(
      JSON.stringify({ mcpServers: { 'second-brain': config.stdio } }, null, 2),
    );
    expect(config.http).toEqual({ url: `http://localhost:${PORT}/mcp` });
    expect(JSON.parse(config.httpSnippet)).toEqual({
      mcpServers: {
        'second-brain': {
          type: 'http',
          url: `http://localhost:${PORT}/mcp`,
          headers: { Authorization: `Bearer ${TEST_TOKEN}` },
        },
      },
    });
    expect(config.bridgeBuilt).toBe(false);
    mkdirSync(path.dirname(bridge), { recursive: true });
    writeFileSync(bridge, '// built');
    expect((await t.call('GET', '/api/mcp/config')).json().bridgeBuilt).toBe(true);
  });

  it('names the home only when it is not the parent of the app folder', async () => {
    const config = await mcpConfig({
      settings: () => t.settings,
      port: PORT,
      appDir,
      homeDir: path.join(install, 'khác'),
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
    });
    expect(config.stdio.args.slice(1)).toEqual(['--home', path.join(install, 'khác')]);
    expect(JSON.parse(config.stdioSnippet).mcpServers['second-brain'].command).toBe(
      'C:\\Program Files\\nodejs\\node.exe',
    );
  });
});
