import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import type { InjectOptions } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_TOKEN } from '../helpers/test-environment.js';
import { createMemoryLogger, type VaultTestApp } from '../api/vault-test-app.js';
import { createMcpTestApp, fakeSourceId } from './mcp-test-kit.js';

const PORT = 47720;
const HOST = `localhost:${PORT}`;
const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'security-test', version: '1.0.0' },
  },
};
const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};
const bearer = (token = TEST_TOKEN) => ({ authorization: `Bearer ${token}` });
const STALE_SOURCE = '3 Resources/papers/cũ.pdf';

describe('Streamable HTTP MCP at /mcp: token, Origin, Host (F32.1, SPEC §5)', () => {
  let t: VaultTestApp;
  const logger = createMemoryLogger();
  const send = (
    method: InjectOptions['method'],
    headers: Record<string, string>,
    payload?: unknown,
  ) =>
    t.app.inject({
      method,
      url: '/mcp',
      headers,
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const post = (headers: Record<string, string>, payload: unknown = INITIALIZE) =>
    send('POST', { host: HOST, ...MCP_HEADERS, ...headers }, payload);

  beforeAll(async () => {
    t = await createMcpTestApp(PORT, {
      logger,
      seed: (root) => {
        // A run left `running` two hours ago: failed (stale) before the first MCP call is served.
        const dir = path.join(root, '.secondbrain', 'state', 'ingest');
        mkdirSync(dir, { recursive: true });
        const sourceId = fakeSourceId(STALE_SOURCE);
        const run = {
          runId: `${sourceId}.01JAAAAAAAAAAAAAAAAAAAAAAA`,
          contentHash: 'a'.repeat(64),
          startedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
          finishedAt: null,
          status: 'running',
          outputs: [],
          logLine: null,
          reason: null,
        };
        const manifest = { version: 1, sourceId, path: STALE_SOURCE, runs: [run] };
        writeFileSync(path.join(dir, `${sourceId}.json`), JSON.stringify(manifest));
      },
    });
  });
  afterAll(async () => t?.close());

  it('answers initialize with the bearer token (no Origin, or the canonical one), stateless, no CORS', async () => {
    const variants: Record<string, string>[] = [
      {},
      { origin: `http://localhost:${PORT}` },
      { authorization: `bearer ${TEST_TOKEN}` },
    ];
    for (const extra of variants) {
      const res = await post({ ...bearer(), ...extra });
      expect(res.statusCode).toBe(200);
      expect(res.json().result.serverInfo.name).toBe('second-brain');
      expect(res.headers['mcp-session-id']).toBeUndefined();
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('refuses a missing or wrong token, and the X-SB-Token header, with 401', async () => {
    const refused: Record<string, string>[] = [
      {},
      bearer('wrong-token'),
      { authorization: TEST_TOKEN },
      { authorization: `Basic ${TEST_TOKEN}` },
      { 'x-sb-token': TEST_TOKEN },
    ];
    for (const headers of refused) {
      const res = await post(headers);
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    }
    const caseVariant = await t.app.inject({
      method: 'GET',
      url: '/MCP/x',
      headers: { host: HOST },
    });
    expect(caseVariant.statusCode).toBe(401);
  });

  it('refuses a foreign Origin on POST and on GET with 403, and a wrong Host with 421', async () => {
    const foreign = { ...bearer(), origin: 'http://evil.example' };
    expect((await post(foreign)).statusCode).toBe(403);
    expect((await send('GET', { host: HOST, ...foreign })).statusCode).toBe(403);
    expect((await send('DELETE', { host: HOST, ...foreign })).statusCode).toBe(403);
    expect((await post({ ...bearer(), origin: 'null' })).statusCode).toBe(403);
    const misdirected = await send(
      'POST',
      { ...MCP_HEADERS, ...bearer(), host: `evil.example:${PORT}` },
      INITIALIZE,
    );
    expect(misdirected.statusCode).toBe(421);
  });

  it('GET and DELETE answer 405 (stateless); 127.0.0.1 is never redirected', async () => {
    for (const method of ['GET', 'DELETE'] as const) {
      const res = await send(method, { host: HOST, ...bearer() });
      expect(res.statusCode).toBe(405);
      expect(res.json()).toMatchObject({ jsonrpc: '2.0', error: { code: -32000 } });
    }
    const ip = await send('GET', { host: `127.0.0.1:${PORT}`, ...bearer() });
    expect(ip.statusCode).toBe(405);
  });

  it('the bearer token is not accepted on /api', async () => {
    const res = await t.app.inject({
      method: 'GET',
      url: '/api/tree',
      headers: { host: HOST, ...bearer() },
    });
    expect(res.statusCode).toBe(401);
  });

  it('a tool call over HTTP works and logs one line: tool, outcome, duration, no arguments', async () => {
    const call = {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'read_note', arguments: { path: 'Bí mật/không có.md' } },
    };
    const res = await post({ ...bearer(), 'mcp-protocol-version': LATEST_PROTOCOL_VERSION }, call);
    expect(res.statusCode).toBe(200);
    expect(res.json().result).toMatchObject({
      isError: true,
      structuredContent: { code: 'NOT_FOUND' },
    });
    const bad = { ...call, id: 8, params: { name: 'read_note', arguments: { path: 42 } } };
    expect((await post(bearer(), bad)).json().result.isError).toBe(true);
    const lines = logger.lines.filter((line) => line.includes('MCP read_note'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^INFO MCP read_note NOT_FOUND \d+ ms$/);
    expect(lines[1]).toMatch(/^INFO MCP read_note INVALID_REQUEST \d+ ms$/);
    expect(logger.lines.join('\n')).not.toContain('Bí mật');
  });

  it('abandoned ingest runs were failed (stale) before the first call was served', () => {
    const file = path.join(
      t.vaultRoot,
      '.secondbrain',
      'state',
      'ingest',
      `${fakeSourceId(STALE_SOURCE)}.json`,
    );
    const manifest = JSON.parse(readFileSync(file, 'utf8'));
    expect(manifest.runs[0]).toMatchObject({ status: 'failed', reason: 'stale' });
  });

  it('waits at the vault-switch gate like /api', async () => {
    const closing = t.host.gate.close(1000);
    await closing;
    let settled = false;
    const pending = post(bearer()).then((res) => {
      settled = true;
      return res;
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(settled).toBe(false);
    t.host.gate.open();
    expect((await pending).statusCode).toBe(200);
  });
});
