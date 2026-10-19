import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { closeDraftDatabase } from '../drafts/draft-database';
import { indexedDbDrafts, listKeptVersions } from '../drafts/draft-store';
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

const PATH = '2 Areas/Giải tích 1.md';
const CONTENT = '# Giải tích 1\n\nGiới hạn.\n';
const ELSEWHERE = '# Giải tích 1\n\nĐạo hàm (sửa ở cửa sổ khác).\n';
const MINE = '# Của tôi Giải tích 1\n\nGiới hạn.\n';

async function open(server: FakeNoteServer): Promise<{ session: NoteSession; deps: SessionDeps }> {
  const made = makeSession(server.path);
  const opened = made.session.open();
  await settle();
  await opened;
  return made;
}

async function run(promise: Promise<unknown>): Promise<void> {
  await settle();
  await promise;
}

const puts = (server: FakeNoteServer) => server.mock.callsTo('PUT /api/note');

describe('conflicts with three versions (F3.6)', () => {
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

  it('two windows: A saves, B gets a 409 and sees base, disk and mine; keep mine sends conflictCopy', async () => {
    const a = await open(server);
    const b = await open(server);
    const original = server.revision;
    typeInto(a.session, 'A ', 1);
    await settle(AUTOSAVE_DELAY_MS);
    const diskRevision = server.revision;
    expect(a.session.getView().status).toBe('saved');

    typeInto(b.session, 'Của tôi ', 1);
    await settle(AUTOSAVE_DELAY_MS);
    expect(b.session.getView().status).toBe('conflict');
    expect(b.session.getView().conflict).toEqual({
      base: CONTENT,
      disk: { revision: diskRevision, text: '# A Giải tích 1\n\nGiới hạn.\n' },
      mine: MINE,
      mineBaseRevision: original,
    });
    // Nothing more is written while the conflict is open; mine is kept as a draft on its base.
    await settle(AUTOSAVE_DELAY_MS * 6);
    expect(puts(server)).toHaveLength(2);
    expect(await indexedDbDrafts.read('vault-a', PATH)).toMatchObject({
      text: MINE,
      baseRevision: original,
    });

    await run(b.session.keepMine());
    expect(puts(server)[2]?.body).toEqual({
      path: PATH,
      content: MINE,
      expectedRevision: diskRevision,
      conflictCopy: true,
    });
    expect(server.content).toBe(MINE);
    expect(b.session.getView().status).toBe('saved');
    expect(b.deps.notify).toHaveBeenCalledWith({ kind: 'kept-mine' });
    expect(await indexedDbDrafts.read('vault-a', PATH)).toBeNull();
  });

  it('"Tải lại" sets mine aside first, then shows the disk version', async () => {
    const { session, deps } = await open(server);
    server.writeElsewhere(ELSEWHERE);
    typeInto(session, 'Của tôi ', 1);
    await settle(AUTOSAVE_DELAY_MS);
    expect(session.getView().status).toBe('conflict');
    await run(session.reloadFromDisk());
    expect((await listKeptVersions('vault-a', PATH)).map((v) => v.text)).toEqual([MINE]);
    expect(session.getView().status).toBe('clean');
    expect(session.getView().conflict).toBeNull();
    expect(session.getView().doc?.textContent).toContain('Đạo hàm');
    expect(await indexedDbDrafts.read('vault-a', PATH)).toBeNull();
    expect(deps.notify).toHaveBeenCalledWith({ kind: 'reloaded' });
  });

  it('a second change on disk during "keep mine" refreshes the disk version and stays in conflict', async () => {
    const { session, deps } = await open(server);
    server.writeElsewhere(ELSEWHERE);
    typeInto(session, 'Của tôi ', 1);
    await settle(AUTOSAVE_DELAY_MS);
    server.writeElsewhere('# Giải tích 1\n\nLần hai.\n');
    await run(session.keepMine());
    expect(session.getView().conflict?.disk?.text).toBe('# Giải tích 1\n\nLần hai.\n');
    expect(deps.notify).toHaveBeenCalledWith({ kind: 'disk-changed-again' });
    expect(server.content).toBe('# Giải tích 1\n\nLần hai.\n');
  });
});

describe('changes made elsewhere', () => {
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

  it('reload silently while clean, keeping the selection', async () => {
    const { session } = await open(server);
    const version = session.getView().docVersion;
    server.writeElsewhere(ELSEWHERE);
    emitServerEvent({ type: 'note:changed', path: PATH, revision: server.revision ?? '' });
    await settle();
    const view = session.getView();
    expect(view.doc?.textContent).toContain('Đạo hàm');
    expect(view.docVersion).toBe(version + 1);
    expect(view.keepSelection).toBe(true);
    expect(view.status).toBe('clean');
    expect(puts(server)).toHaveLength(0);
  });

  it('go to the conflict at once while dirty, before any save', async () => {
    const { session } = await open(server);
    typeInto(session, 'Của tôi ', 1);
    server.writeElsewhere(ELSEWHERE);
    emitServerEvent({ type: 'note:changed', path: PATH, revision: server.revision ?? '' });
    await settle();
    expect(session.getView().status).toBe('conflict');
    expect(session.getView().conflict?.disk?.text).toBe(ELSEWHERE);
    expect(puts(server)).toHaveLength(0);
  });

  it('ignore the echo of our own save, even when it arrives before the answer', async () => {
    const { session } = await open(server);
    typeInto(session, 'A ', 1);
    const release = server.hold();
    await settle(AUTOSAVE_DELAY_MS);
    const { revisionOf } = await import('./session-test-kit');
    const echo = revisionOf('# A Giải tích 1\n\nGiới hạn.\n');
    emitServerEvent({ type: 'note:changed', path: PATH, revision: echo });
    const version = session.getView().docVersion;
    release();
    await settle();
    expect(server.revision).toBe(echo);
    expect(session.getView().status).toBe('saved');
    expect(session.getView().docVersion).toBe(version);
    expect(server.mock.callsTo('GET /api/note')).toHaveLength(1);
  });

  it('a deletion while dirty is a conflict with the disk deleted; while clean the note is gone', async () => {
    const { session, deps } = await open(server);
    typeInto(session, 'Của tôi ', 1);
    server.deleteElsewhere();
    emitServerEvent({ type: 'note:deleted', path: PATH });
    await settle();
    expect(session.getView().conflict).toMatchObject({ disk: null, mine: MINE });

    session.dispose();
    await indexedDbDrafts.remove('vault-a', PATH, deps.windowId);
    server.writeElsewhere(CONTENT);
    const other = await open(server);
    server.deleteElsewhere();
    emitServerEvent({ type: 'note:deleted', path: PATH });
    await settle();
    expect(other.session.getView().loadProblem).toBe('not-found');
  });

  it('follow a rename made elsewhere: later saves go to the new path', async () => {
    const { session } = await open(server);
    typeInto(session, 'Mới ', 1);
    await settle(100);
    const newPath = '2 Areas/Giải tích I.md';
    emitServerEvent({
      type: 'note:renamed',
      oldPath: PATH,
      path: newPath,
      revision: server.revision ?? '',
    });
    expect(session.path()).toBe(newPath);
    await settle(AUTOSAVE_DELAY_MS);
    expect(puts(server)[0]?.body).toMatchObject({ path: newPath });
    expect(await indexedDbDrafts.read('vault-a', PATH)).toBeNull();
  });
});
