import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createVaultTestApp, q, snapshotTree, type VaultTestApp } from './vault-test-app.js';

const PORT = 4792;
const NOW = new Date(2026, 9, 18, 9, 30);

describe('note mutations through the API', () => {
  let t: VaultTestApp;
  const read = async (vaultPath: string) =>
    (await t.call('GET', `/api/note?${q(vaultPath)}`)).json();
  const create = async (vaultPath: string, extra: object = {}) =>
    t.call('POST', '/api/note', { path: vaultPath, ...extra });
  const save = async (vaultPath: string, content: string) => {
    const { revision } = await read(vaultPath);
    const res = await t.call('PUT', '/api/note', {
      path: vaultPath,
      content,
      expectedRevision: revision,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json().revision as string;
  };

  beforeAll(async () => {
    t = await createVaultTestApp(PORT, { now: () => NOW, watcher: false });
  });
  afterAll(async () => t?.close());

  it('creates a blank note with type and created date, and refuses an existing name', async () => {
    const res = await create('0 Inbox/Ý tưởng mới.md');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({
      path: '0 Inbox/Ý tưởng mới.md',
      revision: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    const note = await read('0 Inbox/Ý tưởng mới.md');
    expect(note.content).toBe('---\ntype: note\ncreated: 2026-10-18\n---\n\n');
    expect(note).toMatchObject({
      frontmatter: { type: 'note', created: '2026-10-18' },
      class: 'user',
    });
    const again = await create('0 Inbox/ý tưởng mới.md');
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('EXISTS');
  });

  it('creates from a template with title, date and time filled in and no cursor marker', async () => {
    const res = await create('1 Projects/Đồ án Xác suất.md', {
      template: 'Templates/Course project.md',
    });
    expect(res.statusCode, res.body).toBe(201);
    const { content } = await read('1 Projects/Đồ án Xác suất.md');
    expect(content).not.toMatch(/\{\{(title|date|time|cursor)\}\}/);
    expect(content).toContain('2026-10-18');
    const notTemplate = await create('0 Inbox/x.md', { template: '0 Inbox/Ý tưởng mới.md' });
    expect(notTemplate.json().error.code).toBe('VALIDATION');
  });

  it('saves at the expected revision and answers 409 with the current revision and content otherwise', async () => {
    const before = await read('0 Inbox/Ý tưởng mới.md');
    const revision = await save('0 Inbox/Ý tưởng mới.md', `${before.content}Nội dung #ý-tưởng\n`);
    const after = await read('0 Inbox/Ý tưởng mới.md');
    expect(after.revision).toBe(revision);
    expect(after.tags).toEqual(['ý-tưởng']);
    const stale = await t.call('PUT', '/api/note', {
      path: '0 Inbox/Ý tưởng mới.md',
      content: 'mine',
      expectedRevision: before.revision,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({
      code: 'CONFLICT',
      details: { currentRevision: revision, currentContent: after.content },
    });
  });

  it('renames with relink: the linking note is rewritten and backlinks follow (F1.6 EXISTS too)', async () => {
    await create('2 Areas/Giải tích 1.md');
    await create('1 Projects/Đồ án Giải tích.md');
    await save('1 Projects/Đồ án Giải tích.md', 'Môn: [[Giải tích 1]] và [[Giải tích 1|GT1]]\n');
    const course = await read('2 Areas/Giải tích 1.md');
    expect(course.backlinks.map((b: { fromPath: string }) => b.fromPath)).toEqual([
      '1 Projects/Đồ án Giải tích.md',
    ]);

    const taken = await t.call('POST', '/api/note/rename', {
      path: '2 Areas/Giải tích 1.md',
      newPath: '0 Inbox/Ý tưởng mới.md',
      expectedRevision: course.revision,
      relink: true,
    });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('EXISTS');
    const stale = await t.call('POST', '/api/note/rename', {
      path: '2 Areas/Giải tích 1.md',
      newPath: '2 Areas/Giải tích A1.md',
      expectedRevision: 'e'.repeat(64),
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toMatchObject({
      code: 'CONFLICT',
      details: { currentRevision: course.revision, currentContent: course.content },
    });

    const res = await t.call('POST', '/api/note/rename', {
      path: '2 Areas/Giải tích 1.md',
      newPath: '2 Areas/Giải tích A1.md',
      expectedRevision: course.revision,
      relink: true,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      path: '2 Areas/Giải tích A1.md',
      affected: ['1 Projects/Đồ án Giải tích.md'],
      journalId: expect.any(String),
    });
    expect((await read('1 Projects/Đồ án Giải tích.md')).content).toBe(
      'Môn: [[Giải tích A1]] và [[Giải tích A1|GT1]]\n',
    );
    const renamed = await read('2 Areas/Giải tích A1.md');
    expect(renamed.backlinks).toEqual([
      expect.objectContaining({ fromPath: '1 Projects/Đồ án Giải tích.md', line: 1 }),
    ]);
    expect((await t.call('GET', `/api/note?${q('2 Areas/Giải tích 1.md')}`)).statusCode).toBe(404);
  });

  it('moves into another folder (and to the root) keeping the name', async () => {
    const note = await read('0 Inbox/Ý tưởng mới.md');
    const res = await t.call('POST', '/api/note/move', {
      path: '0 Inbox/Ý tưởng mới.md',
      folder: '1 Projects',
      expectedRevision: note.revision,
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().path).toBe('1 Projects/Ý tưởng mới.md');
    const toRoot = await t.call('POST', '/api/note/move', {
      path: '1 Projects/Ý tưởng mới.md',
      folder: '',
      expectedRevision: note.revision,
    });
    expect(toRoot.json().path).toBe('Ý tưởng mới.md');
  });

  it('trashes into .secondbrain/trash, then undo restores the file through the journal', async () => {
    const note = await read('Ý tưởng mới.md');
    const stale = await t.call('POST', '/api/note/trash', {
      paths: ['Ý tưởng mới.md'],
      expectedRevisions: ['f'.repeat(64)],
    });
    expect(stale.statusCode).toBe(409);
    const res = await t.call('POST', '/api/note/trash', {
      paths: ['Ý tưởng mới.md'],
      expectedRevisions: [note.revision],
    });
    expect(res.statusCode, res.body).toBe(200);
    const { journalId, trashId } = res.json();
    expect(existsSync(path.join(t.vaultRoot, 'Ý tưởng mới.md'))).toBe(false);
    const meta = JSON.parse(
      readFileSync(path.join(t.vaultRoot, '.secondbrain', 'trash', trashId, 'meta.json'), 'utf8'),
    );
    expect(meta).toMatchObject({ originalPaths: ['Ý tưởng mới.md'], reason: 'user' });
    expect((await t.call('GET', `/api/note?${q('Ý tưởng mới.md')}`)).statusCode).toBe(404);

    const undo = await t.call('POST', `/api/journal/${journalId}/undo`);
    expect(undo.statusCode, undo.body).toBe(200);
    expect((await read('Ý tưởng mới.md')).revision).toBe(note.revision);
    expect((await t.call('GET', '/api/journal/pending')).json()).toEqual({ entries: [] });
    expect((await t.call('POST', '/api/journal/01JAAAAAAAAAAAAAAAAAAAAAAA/undo')).statusCode).toBe(
      404,
    );
  });

  it('creates folders and lists everything in the tree with the inbox count', async () => {
    expect((await t.call('POST', '/api/folder', { path: '2 Areas/Môn học' })).statusCode).toBe(201);
    expect((await t.call('POST', '/api/folder', { path: '2 Areas/Môn học' })).statusCode).toBe(409);
    await create('0 Inbox/Ghi nhanh.md');
    const tree = (await t.call('GET', '/api/tree')).json();
    expect(tree.inboxCount).toBe(1);
    const areas = tree.root.folders.find((f: { name: string }) => f.name === '2 Areas');
    expect(areas.folders.map((f: { name: string }) => f.name)).toContain('Môn học');
    expect(areas.files.map((f: { title: string }) => f.title)).toContain('Giải tích A1');
  });

  it('GET endpoints never create or change anything (SPEC §5)', async () => {
    const skip = (relative: string) => relative.startsWith('.secondbrain/cache');
    const before = snapshotTree(t.vaultRoot, skip);
    for (const url of [
      '/api/tree',
      `/api/note?${q('0 Inbox/Không có.md')}`,
      `/api/note?${q('Daily/2026-10-18.md')}`,
      `/api/note?${q('2 Areas/Giải tích A1.md')}`,
      '/api/search?q=giai',
      '/api/search?q=',
      '/api/today',
      '/api/calendar?month=2026-10',
      '/api/tasks',
      '/api/tags',
      `/api/files?${q('Templates/Note.md')}`,
      `/api/files?${q('Attachments/không có.png')}`,
      '/api/templates',
      '/api/journal/pending',
      '/api/sample-data',
    ]) {
      const res = await t.call('GET', url);
      expect(res.statusCode, url).toBeLessThan(500);
    }
    expect(snapshotTree(t.vaultRoot, skip)).toEqual(before);
    expect(readdirSync(path.join(t.vaultRoot, '.secondbrain', 'state'))).not.toContain(
      'sample.json',
    );
  });
});
