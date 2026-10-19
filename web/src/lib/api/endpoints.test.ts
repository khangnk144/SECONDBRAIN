import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFetchMock } from '../testing/fetch-mock';
import { postFolderRenameDryRun, postFolderTrash } from './folders-api';
import { postJournalUndo } from './journal-api';
import {
  getNote,
  postNote,
  postNoteMoveDryRun,
  postNoteRenameDryRun,
  postNoteTrash,
  putNote,
} from './notes-api';
import { getSearch } from './search-api';
import { postReveal } from './vault-api';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('typed API endpoints', () => {
  it('sends paths in the query with %20 (never +) and keeps Vietnamese letters', async () => {
    const mock = installFetchMock();
    mock.on('GET /api/note', { body: { path: '1 Projects/Đồ án Giải tích.md' } });
    await getNote('1 Projects/Đồ án Giải tích.md');
    const [call] = mock.calls;
    expect(call?.url).toBe('/api/note?path=' + encodeURIComponent('1 Projects/Đồ án Giải tích.md'));
    expect(call?.url).not.toContain('+');
    expect(call?.query.get('path')).toBe('1 Projects/Đồ án Giải tích.md');
  });

  it('marks dry runs and passes revision, relink and conflict-copy flags in the body', async () => {
    const mock = installFetchMock();
    mock.on('POST /api/note/rename', { body: { dryRun: true, path: 'b.md', affected: [] } });
    mock.on('POST /api/note/move', { body: { dryRun: true, path: 'x/a.md', affected: [] } });
    mock.on('PUT /api/note', { body: { revision: 'r2', trashId: 't1' } });
    mock.on('POST /api/folder/rename', { body: { dryRun: true, path: 'B', affected: [] } });
    await postNoteRenameDryRun({ path: 'a.md', newPath: 'b.md', expectedRevision: 'r1' });
    await postNoteMoveDryRun({ path: 'a.md', folder: 'x', expectedRevision: 'r1' });
    await putNote({ path: 'a.md', content: 'x', expectedRevision: 'r1', conflictCopy: true });
    await postFolderRenameDryRun({ path: 'A', newPath: 'B', relink: true });
    expect(mock.calls.map((c) => c.body)).toEqual([
      { path: 'a.md', newPath: 'b.md', expectedRevision: 'r1', dryRun: true },
      { path: 'a.md', folder: 'x', expectedRevision: 'r1', dryRun: true },
      { path: 'a.md', content: 'x', expectedRevision: 'r1', conflictCopy: true },
      { path: 'A', newPath: 'B', relink: true, dryRun: true },
    ]);
  });

  it('covers create, trash, folder trash, undo, reveal and search', async () => {
    const mock = installFetchMock();
    mock.on('POST /api/note', {
      status: 201,
      body: { path: '0 Inbox/Ghi chú mới 2.md', revision: 'r' },
    });
    mock.on('POST /api/note/trash', { body: { journalId: 'j1', trashId: 't1' } });
    mock.on('POST /api/folder/trash', { body: { journalId: 'j2', trashId: 't2' } });
    mock.on('POST /api/journal/01ABCDEFGHJK/undo', { body: { ok: true } });
    mock.on('POST /api/reveal', { status: 204 });
    mock.on('GET /api/search', { body: { results: [] } });

    await expect(postNote({ path: '0 Inbox/Ghi chú mới.md', unique: true })).resolves.toEqual({
      path: '0 Inbox/Ghi chú mới 2.md',
      revision: 'r',
    });
    await postNoteTrash(['a.md', 'b.md'], ['r1', 'r2']);
    await postFolderTrash('2 Areas/Cũ');
    await postJournalUndo('01ABCDEFGHJK');
    await expect(postReveal('a.md')).resolves.toBeUndefined();
    await getSearch({ q: 'giai tich', tag: 'đồ-án', limit: 8 });

    expect(mock.callsTo('POST /api/note')[0]?.body).toEqual({
      path: '0 Inbox/Ghi chú mới.md',
      unique: true,
    });
    expect(mock.callsTo('POST /api/note/trash')[0]?.body).toEqual({
      paths: ['a.md', 'b.md'],
      expectedRevisions: ['r1', 'r2'],
    });
    expect(mock.callsTo('POST /api/folder/trash')[0]?.body).toEqual({ path: '2 Areas/Cũ' });
    const search = mock.callsTo('GET /api/search')[0];
    expect(search?.query.get('q')).toBe('giai tich');
    expect(search?.query.get('tag')).toBe('đồ-án');
    expect(search?.query.get('limit')).toBe('8');
  });
});
