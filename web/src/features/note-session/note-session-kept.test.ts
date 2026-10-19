import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { closeDraftDatabase } from '../drafts/draft-database';
import { listKeptVersions } from '../drafts/draft-store';
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
const ELSEWHERE = '# Giải tích 1\n\nĐạo hàm (cửa sổ khác).\n';
const MINE = '# Của tôi Giải tích 1\n\nGiới hạn.\n';

async function run<T>(promise: Promise<T>): Promise<T> {
  await settle();
  return promise;
}

describe('versions set aside by "Tải lại" can be looked at again', () => {
  let server: FakeNoteServer;
  let session: NoteSession;
  let deps: SessionDeps;

  beforeEach(async () => {
    await resetAppState('vault-a');
    await freshDraftDatabase();
    useSessionFakeTimers();
    server = installFakeNoteServer(PATH, CONTENT);
    ({ session, deps } = makeSession(PATH));
    await run(session.open());
    server.writeElsewhere(ELSEWHERE);
    typeInto(session, 'Của tôi ', 1);
    await settle(AUTOSAVE_DELAY_MS);
    await run(session.reloadFromDisk());
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await closeDraftDatabase();
  });

  it('counts them, shows the newest against the disk, and restores it through keep-mine', async () => {
    expect(session.getView().keptCount).toBe(1);
    await run(session.reviewKept());
    const conflict = session.getView().conflict;
    expect(conflict).toMatchObject({
      mine: MINE,
      disk: { revision: server.revision, text: ELSEWHERE },
      keptId: expect.any(Number),
    });
    const diskRevision = server.revision;
    await run(session.keepMine());
    expect(server.mock.callsTo('PUT /api/note').at(-1)?.body).toEqual({
      path: PATH,
      content: MINE,
      expectedRevision: diskRevision,
      conflictCopy: true,
    });
    expect(server.content).toBe(MINE);
    await settle();
    expect(session.getView().keptCount).toBe(0);
    expect(await listKeptVersions('vault-a', PATH)).toEqual([]);
  });

  it('"Tải lại" there lets the set-aside version go, writing nothing', async () => {
    await run(session.reviewKept());
    const puts = server.mock.callsTo('PUT /api/note').length;
    await run(session.reloadFromDisk());
    expect(server.mock.callsTo('PUT /api/note')).toHaveLength(puts);
    expect(session.getView().conflict).toBeNull();
    expect(session.getView().doc?.textContent).toContain('Đạo hàm');
    expect(session.getView().keptCount).toBe(0);
    expect(deps.notify).toHaveBeenCalledWith({ kind: 'kept-discarded' });
  });

  it('"Đóng" goes back to the disk version and keeps the set-aside one', async () => {
    await run(session.reviewKept());
    await run(session.closeKeptReview());
    expect(session.getView().conflict).toBeNull();
    expect(session.getView().doc?.textContent).toContain('Đạo hàm');
    expect(session.getView().keptCount).toBe(1);
    await settle(AUTOSAVE_DELAY_MS * 2);
    expect(server.content).toBe(ELSEWHERE);
  });
});
