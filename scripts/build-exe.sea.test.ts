// Linux smoke test of the single executable (SPEC F29.1, CI). It builds the binary (and the app
// when stale), so it takes about a minute: run with SB_TEST_SEA=1
//   SB_TEST_SEA=1 npx vitest run scripts/build-exe.sea.test.ts
// SB_TEST_SEA_SKIP_BUILD=1 packs the existing server/dist and web/dist (a tree mid-change).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeFixturePdf } from '../server/test/fixtures/sources/pdf-fixture-writer.js';
import { buildExe } from './build-exe.js';

const enabled = process.env.SB_TEST_SEA === '1';
const timings: Record<string, string> = {};
const since = (start: number) => `${((Date.now() - start) / 1000).toFixed(2)} s`;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** node:http, so the Host header can be the allowlisted `localhost:<port>`. */
function request(port: number, method: string, url: string, headers = {}, body?: string) {
  return new Promise<{ status: number; type: string; text: string }>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: url,
        headers: { host: `localhost:${port}`, ...headers },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), text }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

async function waitFor<T>(probe: () => Promise<T | null>, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => null);
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

describe.skipIf(!enabled)('single executable on Linux (F29.1)', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'sb-sea-'));
  const home = path.join(temp, 'home Đồ án');
  const dataHome = path.join(temp, 'xdg data');
  let exe = '';
  let port = 0;
  let server: ChildProcess | null = null;
  let serverExit: Promise<number | null> = Promise.resolve(null);
  const env = { ...process.env, XDG_DATA_HOME: dataHome, SB_HOME: '', SB_PORT: '' };
  const args = () => ['--home', home, '--port', String(port), '--login'];
  const run = (extra: string[]) =>
    spawnSync(exe, [...extra, '--home', home, '--port', String(port)], { env, encoding: 'utf8' });
  const token = () =>
    (
      JSON.parse(readFileSync(path.join(home, '.secondbrain/settings.json'), 'utf8')) as {
        sessionToken: string;
      }
    ).sessionToken;
  const health = async () => {
    const res = await request(port, 'GET', '/api/health');
    return res.status === 200 ? (JSON.parse(res.text) as { app: string; vaultId: string }) : null;
  };
  const start = () => {
    server = spawn(exe, args(), { env, stdio: 'ignore' });
    serverExit = new Promise((resolve) => server?.once('exit', resolve));
  };

  beforeAll(async () => {
    mkdirSync(home, { recursive: true });
    const built = Date.now();
    const skip = process.env.SB_TEST_SEA_SKIP_BUILD === '1' ? ['--skip-build'] : [];
    exe = await buildExe([...skip, '--out', path.join(temp, 'out')]);
    timings.build = since(built);
    port = await freePort();
  }, 600_000);

  afterAll(() => {
    server?.kill();
    console.log(
      'SEA smoke timings',
      timings,
      'binary bytes',
      existsSync(exe) ? statSync(exe).size : 0,
    );
    rmSync(temp, { recursive: true, force: true });
  });

  it('(F29.1) first start extracts the runtime, boots and serves health and the UI shell', async () => {
    const started = Date.now();
    start();
    expect((await waitFor(health, 60_000)).app).toBe('second-brain');
    timings.firstStartToHealth = since(started);
    const runtimes = path.join(dataHome, 'second-brain', 'runtime');
    expect(existsSync(runtimes)).toBe(true);
    const shell = await request(port, 'GET', '/');
    expect(shell.status).toBe(200);
    expect(shell.type).toContain('text/html');
    expect(shell.text).toContain('<div id="root">');
    const system = await request(port, 'GET', '/api/system', { 'x-sb-token': token() });
    expect(JSON.parse(system.text)).toMatchObject({ runtime: 'exe', exePath: exe });
  }, 90_000);

  it('(F29.1) creates a note through the API and finds it by search, PDF text included', async () => {
    const headers = { 'x-sb-token': token(), 'content-type': 'application/json' };
    const note = {
      path: '1 Projects/Đồ án Giải tích.md',
      content: '# Đồ án\n\nma trận nghịch đảo\n',
    };
    const created = await request(port, 'POST', '/api/note', headers, JSON.stringify(note));
    expect(created.status).toBe(201);
    const found = await request(
      port,
      'GET',
      `/api/search?q=${encodeURIComponent('nghịch đảo')}`,
      headers,
    );
    expect(JSON.parse(found.text).results.map((r: { path: string }) => r.path)).toContain(
      note.path,
    );
    // pdf.js runs in a worker from the extracted runtime (no @napi-rs/canvas in the payload).
    // At least 20 letters, or the text counts as "none" (SPEC F30 quality rule).
    const pdf = writeFixturePdf({
      pages: [['Chuỗi Fourier rời rạc và biến đổi nhanh trong xử lý tín hiệu số']],
      title: 'Fourier',
    });
    const vault = path.join(home, 'vault');
    mkdirSync(path.join(vault, '3 Resources'), { recursive: true });
    writeFileSync(path.join(vault, '3 Resources', 'Fourier.pdf'), pdf);
    const hits = await waitFor(async () => {
      const res = await request(
        port,
        'GET',
        `/api/search?q=${encodeURIComponent('fourier roi rac')}`,
        headers,
      );
      const paths = (JSON.parse(res.text).results as Array<{ path: string }>).map((r) => r.path);
      return paths.includes('3 Resources/Fourier.pdf') ? paths : null;
    }, 30_000);
    expect(hits).toContain('3 Resources/Fourier.pdf');
  }, 60_000);

  it('(F29.1) a second start leaves the running server alone; --stop ends it', async () => {
    const before = readFileSync(path.join(home, '.secondbrain/server.json'), 'utf8');
    const warm = Date.now();
    const second = run(['--login']);
    timings.secondStart = since(warm);
    expect(second.status).toBe(0);
    expect(readFileSync(path.join(home, '.secondbrain/server.json'), 'utf8')).toBe(before);
    const stop = run(['--stop']);
    expect(stop.status).toBe(0);
    expect(await serverExit).toBe(0);
    expect(await health().catch(() => null)).toBeNull();
    expect(run(['--stop']).status).toBe(0); // not running: nothing to do
  }, 60_000);

  it('(F29.1) re-extracts a damaged runtime folder on the next start', () => {
    const root = path.join(dataHome, 'second-brain', 'runtime');
    const [dir] = readdirSync(root).filter((name) => /^[0-9a-f]{16}$/.test(name));
    const entry = path.join(root, String(dir), 'app', 'server', 'dist', 'index.js');
    rmSync(entry);
    const again = Date.now();
    expect(run(['--stop']).status).toBe(0);
    timings.reextractAndStop = since(again);
    expect(existsSync(entry)).toBe(true);
  }, 60_000);
});
