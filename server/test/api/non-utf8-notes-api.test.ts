import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVaultTestApp, q, type VaultTestApp } from './vault-test-app.js';

const PORT = 4809;
const ANSI = '1 Projects/Ghi chép ANSI.md';
/** Saved by an old editor in Windows-1252: `é` is the single byte 0xE9, not valid UTF-8. */
const ANSI_BYTES = Buffer.concat([
  Buffer.from('Xem [[Giải tích 1]] r', 'utf8'),
  Buffer.from([0xe9]),
  Buffer.from('sum\n', 'utf8'),
]);

describe('notes that are not valid UTF-8 are reported and never rewritten', () => {
  let t: VaultTestApp;
  const disk = (p: string) => path.join(t.vaultRoot, ...p.split('/'));

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, {
      watcher: false,
      seed: (root) => {
        const write = (p: string, content: string | Buffer) => {
          mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
          writeFileSync(path.join(root, p), content);
        };
        write('2 Areas/Giải tích 1.md', '# Giải tích 1\n');
        write('1 Projects/Đồ án.md', 'Môn [[Giải tích 1]]\n');
        write(ANSI, ANSI_BYTES);
      },
    });
  });
  afterAll(async () => t?.close());

  it('GET /note says whether the content is exact UTF-8', async () => {
    expect((await t.call('GET', `/api/note?${q(ANSI)}`)).json().utf8).toBe(false);
    expect((await t.call('GET', `/api/note?${q('1 Projects/Đồ án.md')}`)).json().utf8).toBe(true);
  });

  it('saving such a note is refused and its bytes stay as they were', async () => {
    const note = (await t.call('GET', `/api/note?${q(ANSI)}`)).json();
    const res = await t.call('PUT', '/api/note', {
      path: ANSI,
      content: note.content,
      expectedRevision: note.revision,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatchObject({ code: 'VALIDATION', details: { reason: 'not-utf8' } });
    expect(readFileSync(disk(ANSI))).toEqual(ANSI_BYTES);
  });

  it('a rename with relink rewrites UTF-8 notes and reports the skipped ones', async () => {
    const course = (await t.call('GET', `/api/note?${q('2 Areas/Giải tích 1.md')}`)).json();
    const res = await t.call('POST', '/api/note/rename', {
      path: '2 Areas/Giải tích 1.md',
      newPath: '2 Areas/Giải tích A1.md',
      expectedRevision: course.revision,
      relink: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ affected: ['1 Projects/Đồ án.md'], skipped: [ANSI] });
    expect(readFileSync(disk('1 Projects/Đồ án.md'), 'utf8')).toBe('Môn [[Giải tích A1]]\n');
    expect(readFileSync(disk(ANSI))).toEqual(ANSI_BYTES);
  });
});
