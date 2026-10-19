import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVaultTestApp, q, type VaultTestApp } from './vault-test-app.js';

const PORT = 4823;
const NOW = new Date(2026, 9, 19, 8, 0);

describe('POST /api/note: unique names and exact content', () => {
  let t: VaultTestApp;
  beforeAll(async () => {
    t = await createVaultTestApp(PORT, { now: () => NOW, watcher: false });
  });
  afterAll(async () => t?.close());

  it('"unique" picks the next free name and answers the name actually used', async () => {
    const paths: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await t.call('POST', '/api/note', {
        path: '0 Inbox/Ghi chú mới.md',
        unique: true,
      });
      expect(res.statusCode, res.body).toBe(201);
      paths.push(res.json().path);
    }
    expect(paths).toEqual([
      '0 Inbox/Ghi chú mới.md',
      '0 Inbox/Ghi chú mới 2.md',
      '0 Inbox/Ghi chú mới 3.md',
    ]);
    const content = (await t.call('GET', `/api/note?${q(paths[2]!)}`)).json().content;
    expect(content).toBe('---\ntype: note\ncreated: 2026-10-19\n---\n\n');
  });

  it('"content" is written byte for byte; with a template it is refused', async () => {
    const exact = '\uFEFF# Bản khôi phục\r\nDòng hai\r\n';
    const res = await t.call('POST', '/api/note', {
      path: '1 Projects/Khôi phục.md',
      content: exact,
    });
    expect(res.statusCode).toBe(201);
    expect(readFileSync(path.join(t.vaultRoot, '1 Projects', 'Khôi phục.md'))).toEqual(
      Buffer.from(exact, 'utf8'),
    );
    const both = await t.call('POST', '/api/note', {
      path: '1 Projects/Hai thứ.md',
      content: 'x',
      template: 'Templates/Note.md',
    });
    expect(both.statusCode).toBe(400);
    expect(both.json().error.details.reason).toBe('content-and-template');
    expect(existsSync(path.join(t.vaultRoot, '1 Projects', 'Hai thứ.md'))).toBe(false);
    const again = await t.call('POST', '/api/note', {
      path: '1 Projects/Khôi phục.md',
      content: 'y',
    });
    expect(again.json().error.code).toBe('EXISTS');
    const unique = await t.call('POST', '/api/note', {
      path: '1 Projects/Khôi phục.md',
      content: 'y',
      unique: true,
    });
    expect(unique.json().path).toBe('1 Projects/Khôi phục 2.md');
  });
});

describe('PUT /api/note with conflictCopy: "Giữ bản của tôi" (F3.6, SPEC §4.10)', () => {
  let t: VaultTestApp;
  const NOTE = '0 Inbox/Hai cửa sổ.md';
  const trashDir = () => path.join(t.vaultRoot, '.secondbrain', 'trash');
  const trashEntries = () => (existsSync(trashDir()) ? readdirSync(trashDir()) : []);

  beforeAll(async () => {
    t = await createVaultTestApp(PORT + 1, { watcher: false });
    await t.call('POST', '/api/note', { path: NOTE, content: 'gốc\n' });
  });
  afterAll(async () => t?.close());

  it('window B keeps its version after A saved: A\'s version lands in the trash with reason "conflict"', async () => {
    const base = (await t.call('GET', `/api/note?${q(NOTE)}`)).json().revision;
    const a = await t.call('PUT', '/api/note', {
      path: NOTE,
      content: 'bản của A\n',
      expectedRevision: base,
    });
    expect(a.statusCode).toBe(200);
    const b = await t.call('PUT', '/api/note', {
      path: NOTE,
      content: 'bản của B\n',
      expectedRevision: base,
    });
    expect(b.statusCode).toBe(409);
    const { currentRevision, currentContent } = b.json().error.details;
    expect(currentContent).toBe('bản của A\n');

    const stale = await t.call('PUT', '/api/note', {
      path: NOTE,
      content: 'bản của B\n',
      expectedRevision: base,
      conflictCopy: true,
    });
    expect(stale.statusCode).toBe(409);
    expect(trashEntries()).toEqual([]);

    const keep = await t.call('PUT', '/api/note', {
      path: NOTE,
      content: 'bản của B\n',
      expectedRevision: currentRevision,
      conflictCopy: true,
    });
    expect(keep.statusCode, keep.body).toBe(200);
    const { revision, trashId } = keep.json();
    expect(trashEntries()).toEqual([trashId]);
    expect(
      readFileSync(path.join(trashDir(), trashId, 'files', '0 Inbox', 'Hai cửa sổ.md'), 'utf8'),
    ).toBe('bản của A\n');
    const meta = JSON.parse(readFileSync(path.join(trashDir(), trashId, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({ reason: 'conflict', originalPaths: [NOTE] });
    const note = (await t.call('GET', `/api/note?${q(NOTE)}`)).json();
    expect(note).toMatchObject({ content: 'bản của B\n', revision });
  });
});
