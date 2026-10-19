import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { closeDraftDatabase } from '../drafts/draft-database';
import type { NoteSession } from './note-session';
import type { SessionDeps } from './note-session-types';
import { AUTOSAVE_DELAY_MS } from './session-core';
import {
  freshDraftDatabase,
  installFakeNoteServer,
  makeSession,
  settle,
  typeInto,
  useSessionFakeTimers,
  type FakeNoteServer,
} from './session-test-kit';

const PATH = '1 Projects/Đồ án Giải tích.md';
const CONTENT = '---\ntype: project\n---\n# Đồ án\n\nThân bài.\n';

async function open(
  server: FakeNoteServer,
  overrides: Partial<SessionDeps> = {},
): Promise<{ session: NoteSession; deps: SessionDeps }> {
  const made = makeSession(server.path, overrides);
  const opened = made.session.open();
  await settle();
  await opened;
  return made;
}

async function run<T>(promise: Promise<T>): Promise<T> {
  await settle();
  return promise;
}

const routes = (server: FakeNoteServer) =>
  server.mock.calls
    .filter((call) => call.method !== 'GET')
    .map((call) => `${call.method} ${call.path}`);

describe('property edits from the note session (F7.1, F7.3)', () => {
  let server: FakeNoteServer;

  beforeEach(async () => {
    await resetAppState('vault-a');
    await freshDraftDatabase();
    useSessionFakeTimers();
    server = installFakeNoteServer(PATH, CONTENT);
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await closeDraftDatabase();
  });

  it('saves pending body edits first, then patches at the revision that save produced', async () => {
    const { session } = await open(server);
    typeInto(session, 'Mới ', 1);
    const ok = await run(session.patchFrontmatter({ set: { deadline: '2026-11-05' } }));
    expect(ok).toBe(true);
    expect(routes(server)).toEqual(['PUT /api/note', 'PATCH /api/note/frontmatter']);
    const [put, patch] = server.mock.calls.filter((call) => call.method !== 'GET');
    expect(patch?.body).toEqual({
      path: PATH,
      expectedRevision: expect.any(String),
      set: { deadline: '2026-11-05' },
    });
    expect(put?.body).toMatchObject({ content: CONTENT.replace('# Đồ án', '# Mới Đồ án') });
    expect(server.content).toBe(
      '---\ntype: project\ndeadline: 2026-11-05\n---\n# Mới Đồ án\n\nThân bài.\n',
    );
    expect(session.getView().frontmatterRaw).toBe(
      '---\ntype: project\ndeadline: 2026-11-05\n---\n',
    );
    expect(session.getView().status).toBe('saved');
  });

  it('keeps body edits typed during the patch unsaved, then saves them on the new front matter', async () => {
    const { session } = await open(server);
    const release = server.hold();
    const patched = session.patchFrontmatter({ set: { status: 'doing' }, unset: ['type'] });
    await settle();
    typeInto(session, 'Trong lúc ', 1);
    release();
    expect(await run(patched)).toBe(true);
    expect(['dirty', 'draft']).toContain(session.getView().status);
    await settle(AUTOSAVE_DELAY_MS);
    expect(server.content).toBe('---\nstatus: doing\n---\n# Trong lúc Đồ án\n\nThân bài.\n');
    expect(session.getView().status).toBe('saved');
  });

  it('a stale revision on the patch opens the conflict when there are edits', async () => {
    const { session } = await open(server);
    const release = server.hold();
    const patched = session.patchFrontmatter({ set: { status: 'done' } });
    await settle();
    typeInto(session, 'Của tôi ', 1);
    server.writeElsewhere('---\ntype: note\n---\n# Đồ án\n\nỞ chỗ khác.\n');
    release();
    expect(await run(patched)).toBe(false);
    expect(session.getView().status).toBe('conflict');
  });

  it('a stale revision without edits reloads the note and says the change did not go through', async () => {
    const { session, deps } = await open(server);
    server.writeElsewhere('---\ntype: note\n---\n# Đồ án\n\nỞ chỗ khác.\n');
    expect(await run(session.patchFrontmatter({ set: { status: 'done' } }))).toBe(false);
    expect(session.getView().status).toBe('clean');
    expect(session.getView().doc?.textContent).toContain('Ở chỗ khác');
    expect(deps.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'patch-failed' }));
  });
});

describe('title rename from the note session (F3.7)', () => {
  let server: FakeNoteServer;

  beforeEach(async () => {
    await resetAppState('vault-a');
    await freshDraftDatabase();
    useSessionFakeTimers();
    server = installFakeNoteServer(PATH, CONTENT);
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await closeDraftDatabase();
  });

  it('saves first, renames at the saved revision, then follows the new path', async () => {
    const newPath = '1 Projects/Đồ án Giải tích 2.md';
    const renameNote = vi.fn(async () => ({ ok: true as const, path: newPath }));
    const { session } = await open(server, { renameNote });
    typeInto(session, 'X', 1);
    const result = await run(session.rename('Đồ án Giải tích 2'));
    expect(result).toEqual({ ok: true, path: newPath });
    expect(routes(server)).toEqual(['PUT /api/note']);
    expect(renameNote).toHaveBeenCalledWith(PATH, 'Đồ án Giải tích 2', {
      expectedRevision: server.revision,
    });
    expect(session.path()).toBe(newPath);
  });
});

describe('source mode through the revision contract (F3.8)', () => {
  let server: FakeNoteServer;
  const FILE = '\uFEFF---\r\ntype: note\r\n---\r\n# Nguồn\r\n\r\nMột dòng.\r\n';

  beforeEach(async () => {
    await resetAppState('vault-a');
    await freshDraftDatabase();
    useSessionFakeTimers();
    server = installFakeNoteServer(PATH, FILE);
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await closeDraftDatabase();
  });

  it('shows the exact text, saves edits with the file line endings and BOM, then re-loads the editor', async () => {
    const { session } = await open(server);
    const original = server.revision;
    void session.setSourceMode(true);
    await settle();
    const shown = session.getView().source?.text ?? '';
    expect(shown).toBe('---\ntype: note\n---\n# Nguồn\n\nMột dòng.\n');
    session.sourceChanged(`${shown}$$x^2$$\n`);
    await settle(AUTOSAVE_DELAY_MS);
    expect(server.mock.callsTo('PUT /api/note')[0]?.body).toEqual({
      path: PATH,
      content: `${FILE}$$x^2$$\r\n`,
      expectedRevision: original,
    });
    const version = session.getView().docVersion;
    void session.setSourceMode(false);
    await settle();
    expect(session.getView().source).toBeNull();
    expect(session.getView().docVersion).toBe(version + 1);
    typeInto(session, 'A', 1);
    await settle(AUTOSAVE_DELAY_MS);
    expect(server.content).toBe(`${FILE.replace('# Nguồn', '# ANguồn')}$$x^2$$\r\n`);
  });
});
