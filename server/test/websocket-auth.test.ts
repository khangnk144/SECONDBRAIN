import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createTestApp, TEST_TOKEN, type TestAppHandle } from './helpers/test-environment.js';

const PORT = 4784;

interface ConnectOutcome {
  opened: boolean;
  status?: number;
  firstMessage?: string;
}

function connect(url: string, headers: Record<string, string> = {}): Promise<ConnectOutcome> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, { headers });
    socket.on('message', (data) => {
      resolve({ opened: true, firstMessage: String(data) });
      socket.close();
    });
    socket.on('unexpected-response', (_req, res) => {
      resolve({ opened: false, status: res.statusCode });
      socket.terminate();
    });
    socket.on('error', () => resolve({ opened: false }));
  });
}

describe('WebSocket /ws authentication (real listening server)', () => {
  let handle: TestAppHandle;
  beforeAll(async () => {
    handle = await createTestApp(PORT);
    await handle.app.listen({ host: '127.0.0.1', port: PORT });
  });
  afterAll(async () => handle.cleanup());

  const base = `ws://localhost:${PORT}/ws`;
  const goodOrigin = { origin: `http://localhost:${PORT}` };

  it('rejects an upgrade without a token (401)', async () => {
    expect(await connect(base, goodOrigin)).toEqual({ opened: false, status: 401 });
  });

  it('rejects an upgrade with a wrong token (401)', async () => {
    expect(await connect(`${base}?token=nope`, goodOrigin)).toEqual({ opened: false, status: 401 });
  });

  it('rejects a foreign Origin even with the right token (403)', async () => {
    expect(await connect(`${base}?token=${TEST_TOKEN}`, { origin: 'http://evil.example' })).toEqual(
      { opened: false, status: 403 },
    );
  });

  it('rejects a foreign Host (421)', async () => {
    expect(
      await connect(`${base}?token=${TEST_TOKEN}`, { ...goodOrigin, host: 'evil.example' }),
    ).toEqual({ opened: false, status: 421 });
  });

  it('accepts the canonical Origin with the right token and sends hello', async () => {
    const outcome = await connect(`${base}?token=${TEST_TOKEN}`, goodOrigin);
    expect(outcome.opened).toBe(true);
    expect(JSON.parse(outcome.firstMessage ?? '{}')).toEqual({
      type: 'hello',
      version: expect.any(String),
    });
  });

  it('accepts a client that sends no Origin (local tools)', async () => {
    const outcome = await connect(`${base}?token=${TEST_TOKEN}`);
    expect(outcome.opened).toBe(true);
  });
});
