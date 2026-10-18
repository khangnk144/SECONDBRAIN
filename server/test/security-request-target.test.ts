import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestAppHandle } from './helpers/test-environment.js';

const PORT = 4786;

/** Sends one raw HTTP/1.1 request (browsers cannot send absolute-form targets; other clients can). */
function rawRequest(lines: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(PORT, '127.0.0.1');
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      data += chunk;
    });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    setTimeout(() => socket.end(), 400);
  });
}

function statusOf(response: string): number {
  return Number(response.split(' ')[1]);
}

describe('request target form', () => {
  let handle: TestAppHandle;
  beforeAll(async () => {
    handle = await createTestApp(PORT);
    handle.app.post('/api/__stub', async () => ({ wrote: true }));
    await handle.app.listen({ host: '127.0.0.1', port: PORT });
  });
  afterAll(async () => handle.cleanup());

  const host = `Host: localhost:${PORT}`;

  it('refuses an absolute-form API read without a token instead of routing it', async () => {
    for (const scheme of ['http', 'https']) {
      const response = await rawRequest([
        `GET ${scheme}://localhost:${PORT}/api/settings HTTP/1.1`,
        host,
        'Connection: close',
      ]);
      expect(statusOf(response)).toBe(400);
      expect(response).not.toContain('"ui"');
    }
  });

  it('refuses an absolute-form write without a token', async () => {
    const response = await rawRequest([
      `POST http://localhost:${PORT}/api/__stub HTTP/1.1`,
      host,
      'Content-Length: 0',
      'Connection: close',
    ]);
    expect(statusOf(response)).toBe(400);
    expect(response).not.toContain('wrote');
  });

  it('refuses an absolute-form WebSocket upgrade without a token', async () => {
    const response = await rawRequest([
      `GET http://localhost:${PORT}/ws HTTP/1.1`,
      host,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
    ]);
    expect(statusOf(response)).toBe(400);
    expect(response).not.toContain('101 Switching Protocols');
  });

  it('still serves normal origin-form requests', async () => {
    const response = await rawRequest(['GET /api/health HTTP/1.1', host, 'Connection: close']);
    expect(statusOf(response)).toBe(200);
  });
});
