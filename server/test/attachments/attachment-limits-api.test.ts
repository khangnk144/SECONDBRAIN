import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_ATTACHMENT_BYTES, registerAttachmentRoutes } from '../../src/api/attachment-routes.js';
import { createAppContext, type AppContext } from '../../src/app-context/create-app-context.js';
import { buildApp } from '../../src/http/build-app.js';
import { createSilentLogger } from '../../src/logging/rotating-file-logger.js';
import { authHeaders, makeSettings, makeTempDir, removeDir } from '../helpers/test-environment.js';
import { multipartBody, type MultipartPart } from './multipart-body.js';

const PORT = 47632;
const LIMIT = 1024;

describe('POST /api/attachments limits (F15.1)', () => {
  let home: string;
  let context: AppContext;
  let app: FastifyInstance;

  beforeAll(async () => {
    home = makeTempDir('sb giới hạn tệp');
    const settings = makeSettings({ port: PORT });
    context = await createAppContext({
      home,
      settings,
      logger: createSilentLogger(),
      watcher: false,
    });
    // Only the attachment route, with a small limit (the real one is 200 MB).
    app = await buildApp({
      getSettings: () => settings,
      port: PORT,
      mode: 'production',
      webDir: path.join(home, 'web'),
      webDistDir: path.join(home, 'web', 'dist'),
      serveUi: false,
    });
    registerAttachmentRoutes(app, context, { maxBytes: LIMIT });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await context?.close();
    removeDir(home);
  });

  const send = (parts: MultipartPart[], origin = `http://localhost:${PORT}`) => {
    const { payload, contentType } = multipartBody(parts);
    return app.inject({
      method: 'POST',
      url: '/api/attachments',
      headers: { ...authHeaders(PORT), origin, 'content-type': contentType },
      payload,
    });
  };

  it('allows 200 MB per file by default', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(200 * 1024 * 1024);
  });

  it('a file over the limit → 413 VALIDATION and nothing is written', async () => {
    const res = await send([
      { name: 'file', filename: 'quá lớn.pdf', content: Buffer.alloc(LIMIT + 1, 7) },
    ]);
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toMatchObject({
      code: 'VALIDATION',
      details: { reason: 'too-large' },
    });
    expect(readdirSync(path.join(context.vault.root, '3 Resources', 'papers'))).toEqual([]);
  });

  it('a file exactly at the limit is saved', async () => {
    const res = await send([
      { name: 'file', filename: 'vừa đủ.pdf', content: Buffer.alloc(LIMIT, 7) },
    ]);
    expect(res.statusCode, res.body).toBe(201);
  });

  it('two files in one request → 413 VALIDATION, nothing new written', async () => {
    const before = readdirSync(path.join(context.vault.root, '3 Resources', 'other'));
    const res = await send([
      { name: 'file', filename: 'một.txt', content: 'một' },
      { name: 'file', filename: 'hai.txt', content: 'hai' },
    ]);
    expect(res.statusCode).toBe(413);
    expect(res.json().error.details.reason).toBe('too-many-files');
    expect(readdirSync(path.join(context.vault.root, '3 Resources', 'other'))).toEqual(before);
  });

  it('keeps the security rules: wrong token 401, foreign Origin 403', async () => {
    const { payload, contentType } = multipartBody([
      { name: 'file', filename: 'a.pdf', content: 'x' },
    ]);
    const noToken = await app.inject({
      method: 'POST',
      url: '/api/attachments',
      headers: { host: `localhost:${PORT}`, 'content-type': contentType },
      payload,
    });
    expect(noToken.statusCode).toBe(401);
    const foreign = await send(
      [{ name: 'file', filename: 'a.pdf', content: 'x' }],
      'http://evil.example',
    );
    expect(foreign.statusCode).toBe(403);
  });

  it('other routes still refuse multipart bodies (the parser is scoped to uploads)', async () => {
    const { payload, contentType } = multipartBody([{ name: 'text', value: 'ghi nhanh' }]);
    const res = await app.inject({
      method: 'PUT',
      url: '/api/settings',
      headers: {
        ...authHeaders(PORT),
        origin: `http://localhost:${PORT}`,
        'content-type': contentType,
      },
      payload,
    });
    expect(res.statusCode).toBe(415);
  });
});
