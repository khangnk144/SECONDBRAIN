import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFileLogger, redactSecrets } from '../src/logging/rotating-file-logger.js';
import { createTestApp, makeTempDir, removeDir, TEST_TOKEN } from './helpers/test-environment.js';

describe('Request logging', () => {
  let dir: string;
  beforeEach(() => {
    dir = makeTempDir('sb logs Nhật ký');
  });
  afterEach(() => removeDir(dir));

  it('writes method, path, status and duration, never the token or query strings', async () => {
    const logger = createFileLogger({ dir, secrets: () => [TEST_TOKEN] });
    const handle = await createTestApp(4787, { logger });
    await handle.app.ready();
    const host = 'localhost:4787';
    await handle.app.inject({
      method: 'GET',
      url: '/api/settings?q=Đồ%20án',
      headers: { host, 'x-sb-token': TEST_TOKEN },
    });
    await handle.app.inject({ method: 'GET', url: `/ws?token=${TEST_TOKEN}`, headers: { host } });
    await handle.app.inject({
      method: 'GET',
      url: '/api/settings',
      headers: { host, 'x-sb-token': 'wrong' },
    });
    await handle.cleanup();

    const log = readFileSync(path.join(dir, 'server.log'), 'utf8');
    expect(log).toMatch(/INFO GET \/api\/settings 200 \d+\.\dms/);
    expect(log).toMatch(/INFO GET \/api\/settings 401/);
    expect(log).not.toContain(TEST_TOKEN);
    expect(log).not.toContain('?');
    expect(log).not.toContain('án');
  });

  it('redacts secrets and token-like query parameters in free-form messages', () => {
    expect(redactSecrets(`token is ${TEST_TOKEN}`, [TEST_TOKEN])).toBe('token is [redacted]');
    expect(redactSecrets('GET /ws?token=abc&x=1')).toBe('GET /ws?token=[redacted]&x=1');
    expect(redactSecrets('header X-SB-Token: abc123')).toBe('header X-SB-Token: [redacted]');
  });

  it('rotates at the size limit and keeps writing', () => {
    const logger = createFileLogger({ dir, maxBytes: 200 });
    for (let i = 0; i < 20; i += 1) logger.info(`line ${i} ${'x'.repeat(40)}`);
    const file = path.join(dir, 'server.log');
    expect(existsSync(`${file}.1`)).toBe(true);
    expect(statSync(file).size).toBeLessThan(400);
    writeFileSync(file, '');
    logger.info('after');
    expect(readFileSync(file, 'utf8')).toContain('after');
  });
});
