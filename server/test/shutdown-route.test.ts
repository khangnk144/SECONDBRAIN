import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/http/build-app.js';
import {
  makeFakeAppDir,
  makeSettings,
  makeTempDir,
  removeDir,
  TEST_TOKEN,
} from './helpers/test-environment.js';

const PORT = 4787;
const HOST = `localhost:${PORT}`;

describe('POST /api/shutdown', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach(removeDir));

  async function appWithShutdown(requestShutdown: () => void) {
    const root = makeTempDir();
    dirs.push(root);
    const { webDir, webDistDir } = makeFakeAppDir(root);
    const settings = makeSettings();
    return buildApp({
      getSettings: () => settings,
      port: PORT,
      mode: 'production',
      webDir,
      webDistDir,
      requestShutdown,
    });
  }

  it('needs the session token and refuses foreign origins', async () => {
    const requestShutdown = vi.fn();
    const app = await appWithShutdown(requestShutdown);
    const noToken = await app.inject({
      method: 'POST',
      url: '/api/shutdown',
      headers: { host: HOST },
    });
    expect(noToken.statusCode).toBe(401);
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/shutdown',
      headers: { host: HOST, origin: 'http://evil.example', 'x-sb-token': TEST_TOKEN },
    });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(requestShutdown).not.toHaveBeenCalled();
    await app.close();
  });

  it('answers 202 then asks the process to stop, whatever body PowerShell sends', async () => {
    for (const extra of [
      {},
      { 'content-type': 'application/x-www-form-urlencoded' },
      { 'content-type': 'application/json' },
    ]) {
      const requestShutdown = vi.fn();
      const app = await appWithShutdown(requestShutdown);
      const res = await app.inject({
        method: 'POST',
        url: '/api/shutdown',
        headers: { host: `127.0.0.1:${PORT}`, 'x-sb-token': TEST_TOKEN, ...extra },
        payload: '',
      });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ ok: true });
      await vi.waitFor(() => expect(requestShutdown).toHaveBeenCalledTimes(1));
      await app.close();
    }
  });

  it('is absent when the caller did not enable it', async () => {
    const root = makeTempDir();
    dirs.push(root);
    const { webDir, webDistDir } = makeFakeAppDir(root);
    const settings = makeSettings();
    const app = await buildApp({
      getSettings: () => settings,
      port: PORT,
      mode: 'production',
      webDir,
      webDistDir,
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/shutdown',
      headers: { host: HOST, 'x-sb-token': TEST_TOKEN },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
