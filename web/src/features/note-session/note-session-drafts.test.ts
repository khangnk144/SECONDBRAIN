import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { closeDraftDatabase } from '../drafts/draft-database';
import { indexedDbDrafts } from '../drafts/draft-store';
import type { NoteSession } from './note-session';
import { AUTOSAVE_DELAY_MS, DRAFT_DELAY_MS } from './session-core';
import {
  freshDraftDatabase,
  installFakeNoteServer,
  makeSession,
  settle,
  typeInto,
  useSessionFakeTimers,
  type FakeNoteServer,
} from './session-test-kit';

const PATH = '0 Inbox/Bài giảng 3.md';
const CONTENT = '# Bài giảng 3\n\nGiới hạn của dãy số.\n';
const TYPED = '# Bài giảng 3\n\nGiới hạn của dãy số.\n\nĐịnh lý kẹp.\n';

async function open(server: FakeNoteServer): Promise<NoteSession> {
  const { session } = makeSession(server.path);
  const opened = session.open();
  await settle();
  await opened;
  return session;
}

const puts = (server: FakeNoteServer) => server.mock.callsTo('PUT /api/note');

describe('drafts on reopen (F3.5)', () => {
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

  it('restores what was typed when the tab died, if the disk did not change', async () => {
    const first = await open(server);
    typeInto(first, 'Ôn ', 1);
    await settle(DRAFT_DELAY_MS);
    // The tab is killed: no save, no cleanup – only the draft remains.
    first.dispose();
    expect(puts(server)).toHaveLength(0);

    const original = server.revision;
    const second = await open(server);
    expect(second.getView().draftRestored).toBe(true);
    expect(second.getView().status).toBe('draft');
    expect(second.getView().doc?.textContent).toContain('Ôn Bài giảng 3');
    await settle(AUTOSAVE_DELAY_MS);
    expect(puts(server)[0]?.body).toMatchObject({
      content: CONTENT.replace('# Bài', '# Ôn Bài'),
      expectedRevision: original,
    });
    expect(second.getView().status).toBe('saved');
  });

  it('opens the conflict screen instead when the file changed in between', async () => {
    const first = await open(server);
    typeInto(first, 'Ôn ', 1);
    await settle(DRAFT_DELAY_MS);
    first.dispose();
    server.writeElsewhere('# Bài giảng 3\n\nSửa trong Notepad.\n');

    const second = await open(server);
    const view = second.getView();
    expect(view.status).toBe('conflict');
    expect(view.conflict).toEqual({
      base: null,
      disk: { revision: server.revision, text: '# Bài giảng 3\n\nSửa trong Notepad.\n' },
      mine: CONTENT.replace('# Bài', '# Ôn Bài'),
      mineBaseRevision: expect.any(String),
    });
    await settle(AUTOSAVE_DELAY_MS * 4);
    expect(puts(server)).toHaveLength(0);
  });

  it('drops a draft that already equals the disk', async () => {
    await indexedDbDrafts.write({
      vaultId: 'vault-a',
      windowId: 'window-earlier',
      path: PATH,
      baseRevision: 'rev-older',
      text: CONTENT,
      ts: 1,
    });
    const session = await open(server);
    expect(session.getView().status).toBe('clean');
    expect(session.getView().draftRestored).toBe(false);
    expect(await indexedDbDrafts.read('vault-a', PATH)).toBeNull();
  });

  it('"Bỏ bản nháp" goes back to the disk version without writing when nothing was saved', async () => {
    await indexedDbDrafts.write({
      vaultId: 'vault-a',
      windowId: 'window-earlier',
      path: PATH,
      baseRevision: server.revision ?? '',
      text: TYPED,
      ts: 1,
    });
    const session = await open(server);
    expect(session.getView().draftRestored).toBe(true);
    const discarded = session.discardDraft();
    await settle();
    await discarded;
    expect(session.getView().draftRestored).toBe(false);
    expect(session.getView().status).toBe('clean');
    expect(session.getView().doc?.textContent).not.toContain('Định lý kẹp');
    await settle(AUTOSAVE_DELAY_MS * 2);
    expect(puts(server)).toHaveLength(0);
    expect(await indexedDbDrafts.read('vault-a', PATH)).toBeNull();
  });

  it('"Bỏ bản nháp" after the restored draft was saved writes the old text back', async () => {
    await indexedDbDrafts.write({
      vaultId: 'vault-a',
      windowId: 'window-earlier',
      path: PATH,
      baseRevision: server.revision ?? '',
      text: TYPED,
      ts: 1,
    });
    const session = await open(server);
    await settle(AUTOSAVE_DELAY_MS);
    expect(server.content).toBe(TYPED);
    const discarded = session.discardDraft();
    await settle();
    await discarded;
    expect(server.content).toBe(CONTENT);
    expect(session.getView().status).toBe('saved');
  });

  it('keeps a draft of a note deleted elsewhere and can re-create the note from it', async () => {
    await indexedDbDrafts.write({
      vaultId: 'vault-a',
      windowId: 'window-earlier',
      path: PATH,
      baseRevision: server.revision ?? '',
      text: TYPED,
      ts: 1,
    });
    server.deleteElsewhere();
    const session = await open(server);
    expect(session.getView().conflict).toMatchObject({ base: null, disk: null, mine: TYPED });
    const kept = session.keepMine();
    await settle();
    await kept;
    expect(server.mock.callsTo('POST /api/note')[0]?.body).toEqual({ path: PATH, content: TYPED });
    expect(server.content).toBe(TYPED);
    expect(session.getView().status).toBe('saved');
  });

  it("a clean second window never deletes the first window's draft; a later window takes it over", async () => {
    const a = await open(server);
    const b = await open(server);
    server.offline = true;
    typeInto(a, 'Chỉ ở A ', 1);
    await settle(DRAFT_DELAY_MS);
    // B is clean: its flush is a no-op save, which used to remove the shared draft.
    await Promise.all([b.flush(), settle()]);
    b.dispose();
    await settle();
    expect((await indexedDbDrafts.read('vault-a', PATH))?.text).toBe(
      CONTENT.replace('# Bài', '# Chỉ ở A Bài'),
    );
    // A's tab is killed while the server is down; a new window opens the note later.
    a.dispose();
    server.offline = false;
    const c = await open(server);
    expect(c.getView().draftRestored).toBe(true);
    await settle(AUTOSAVE_DELAY_MS);
    expect(server.content).toBe(CONTENT.replace('# Bài', '# Chỉ ở A Bài'));
    expect(await indexedDbDrafts.read('vault-a', PATH)).toBeNull();
  });
});
