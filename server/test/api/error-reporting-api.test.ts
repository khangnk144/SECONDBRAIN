import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryLogger, createVaultTestApp, q, type VaultTestApp } from './vault-test-app.js';

const PORT = 4798;
const NOTE = '0 Inbox/Bài nộp.md';

describe('errors reach the client and the log without paths, messages or stacks', () => {
  let t: VaultTestApp;
  const logger = createMemoryLogger();
  let failWith: string | undefined;

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      watcher: false,
      logger,
      faults: {
        failOperation: (operation, target) =>
          operation === 'write' && target === NOTE ? failWith : undefined,
      },
    });
    await t.call('POST', '/api/note', { path: NOTE });
  });
  afterAll(async () => t?.close());

  const noLeak = (text: string) => {
    expect(text).not.toContain(t.home);
    expect(text).not.toMatch(/\n\s+at /); // no stack trace
  };

  it.each(['ENOSPC', 'EACCES'])(
    'disk refusal %s on save → 500 WRITE_FAILED with the vault path; file unchanged (F1.8)',
    async (code) => {
      const disk = path.join(t.vaultRoot, ...NOTE.split('/'));
      const before = readFileSync(disk);
      const note = (await t.call('GET', `/api/note?${q(NOTE)}`)).json();
      failWith = code;
      const res = await t.call('PUT', '/api/note', {
        path: NOTE,
        content: 'nội dung mới\n',
        expectedRevision: note.revision,
      });
      failWith = undefined;
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toMatchObject({
        code: 'WRITE_FAILED',
        message: expect.any(String),
        details: { path: NOTE, cause: code },
      });
      noLeak(res.body);
      expect(readFileSync(disk)).toEqual(before);
      expect((await t.call('GET', `/api/note?${q(NOTE)}`)).json().revision).toBe(note.revision);
      const line = logger.lines.find((l) => l.includes(`(${code})`));
      expect(line).toBe(`ERROR Write failed on PUT /api/note (${code}).`);
    },
  );

  it('an unexpected failure answers a generic 500 and logs only route and error name', async () => {
    const original = t.context.index.tags;
    t.context.index.tags = () => {
      throw new TypeError(`${t.home}/vault/Nhật ký bí mật.md could not be read`);
    };
    try {
      const res = await t.call('GET', '/api/tags');
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({
        error: { code: 'INTERNAL', message: 'Internal server error.' },
      });
    } finally {
      t.context.index.tags = original;
    }
    expect(logger.lines).toContain('ERROR Unhandled error on GET /api/tags (TypeError).');
    for (const line of logger.lines) {
      noLeak(line);
      expect(line).not.toContain('bí mật');
    }
  });

  it('a failing journal refresh never hides the operation result or its error', async () => {
    const original = t.context.vault.pendingJournal;
    t.context.vault.pendingJournal = async () => {
      throw Object.assign(new Error('journal folder unreadable'), { code: 'EIO' });
    };
    try {
      const note = (await t.call('GET', `/api/note?${q(NOTE)}`)).json();
      const stale = await t.call('POST', '/api/note/rename', {
        path: NOTE,
        newPath: '0 Inbox/Khác.md',
        expectedRevision: 'f'.repeat(64),
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe('CONFLICT');
      const renamed = await t.call('POST', '/api/note/rename', {
        path: NOTE,
        newPath: '0 Inbox/Khác.md',
        expectedRevision: note.revision,
      });
      expect(renamed.statusCode, renamed.body).toBe(200);
      expect(renamed.json().path).toBe('0 Inbox/Khác.md');
    } finally {
      t.context.vault.pendingJournal = original;
    }
    expect(logger.lines).toContain('WARN Reading the journal after an operation failed (EIO).');
  });
});
