import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError } from '../../lib/testing/fetch-mock';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
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

const PATH = '1 Projects/Đồ án Giải tích.md';
const CONTENT = '---\ntype: project\n---\n# Đồ án Giải tích\n\nĐoạn một.\n\n- [ ] Nộp bản nháp\n';

async function openSession(server: FakeNoteServer): Promise<NoteSession> {
  const { session } = makeSession(server.path);
  const opened = session.open();
  await settle();
  await opened;
  return session;
}

const status = (session: NoteSession) => session.getView().status;
const puts = (server: FakeNoteServer) => server.mock.callsTo('PUT /api/note');

describe('note session autosave (F3.4, F20.1)', () => {
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

  it('writes within 1 s of the last keystroke and says saved only after the server confirmed', async () => {
    const session = await openSession(server);
    const original = server.revision;
    expect(status(session)).toBe('clean');
    typeInto(session, 'Mới ', 1);
    expect(status(session)).toBe('dirty');
    await settle(DRAFT_DELAY_MS);
    expect(status(session)).toBe('draft');
    expect(await indexedDbDrafts.read('vault-a', PATH)).toMatchObject({
      baseRevision: original,
      text: CONTENT.replace('# Đồ án', '# Mới Đồ án'),
    });
    const release = server.hold();
    await settle(AUTOSAVE_DELAY_MS - DRAFT_DELAY_MS);
    expect(AUTOSAVE_DELAY_MS).toBeLessThan(1000);
    expect(puts(server)).toHaveLength(1);
    expect(puts(server)[0]?.body).toEqual({
      path: PATH,
      content: CONTENT.replace('# Đồ án', '# Mới Đồ án'),
      expectedRevision: original,
    });
    expect(status(session)).toBe('saving');
    release();
    await settle();
    expect(status(session)).toBe('saved');
    expect(server.content).toBe(CONTENT.replace('# Đồ án', '# Mới Đồ án'));
    expect(await indexedDbDrafts.read('vault-a', PATH)).toBeNull();
  });

  it('shows the error state with the draft kept while the server is down, then resumes on resync', async () => {
    const session = await openSession(server);
    server.offline = true;
    typeInto(session, 'Xa ', 1);
    await settle(AUTOSAVE_DELAY_MS);
    expect(status(session)).toBe('error');
    expect(session.getView().errorKind).toBe('offline');
    await settle(1000);
    expect(puts(server).length).toBeGreaterThanOrEqual(2);
    expect(status(session)).toBe('error');
    const draft = await indexedDbDrafts.read('vault-a', PATH);
    expect(draft?.text).toContain('# Xa Đồ án');
    server.offline = false;
    emitServerEvent({ type: 'resync' });
    await settle();
    expect(status(session)).toBe('saved');
    expect(server.content).toContain('# Xa Đồ án');
    expect(await indexedDbDrafts.read('vault-a', PATH)).toBeNull();
  });

  it('reports a full disk as its own error and retries on its own', async () => {
    const session = await openSession(server);
    server.failNextWrite = apiError(500, 'WRITE_FAILED', { path: PATH, cause: 'ENOSPC' });
    typeInto(session, 'Đầy ', 1);
    await settle(AUTOSAVE_DELAY_MS);
    expect(status(session)).toBe('error');
    expect(session.getView().errorKind).toBe('disk-full');
    await settle(1000);
    expect(status(session)).toBe('saved');
    expect(server.content).toContain('# Đầy Đồ án');
  });

  it('saves edits typed during a save right after it, on the new revision, one write at a time', async () => {
    const session = await openSession(server);
    typeInto(session, 'A', 1);
    const release = server.hold();
    await settle(AUTOSAVE_DELAY_MS);
    const firstRevisionSent = (puts(server)[0]?.body as { expectedRevision: string })
      .expectedRevision;
    typeInto(session, 'B', 1);
    await settle(AUTOSAVE_DELAY_MS - 100);
    expect(puts(server)).toHaveLength(1);
    release();
    await settle();
    const afterFirst = server.revision;
    expect(firstRevisionSent).not.toBe(afterFirst);
    expect(status(session)).not.toBe('saved');
    expect((await indexedDbDrafts.read('vault-a', PATH))?.baseRevision).toBe(afterFirst);
    await settle(AUTOSAVE_DELAY_MS);
    expect(puts(server)).toHaveLength(2);
    expect((puts(server)[1]?.body as { expectedRevision: string }).expectedRevision).toBe(
      afterFirst,
    );
    expect(server.content).toContain('# BAĐồ án');
    expect(status(session)).toBe('saved');
  });

  it('keeps CRLF, untouched blocks and the front matter byte for byte', async () => {
    const crlf = '---\r\ntags: [a]   # giữ\r\n---\r\n# Tiêu đề\r\n\r\nGiữ   *nguyên*  \r\n';
    server.writeElsewhere(crlf);
    const session = await openSession(server);
    typeInto(session, 'X', 1);
    await settle(AUTOSAVE_DELAY_MS);
    expect(server.content).toBe(crlf.replace('# Tiêu', '# XTiêu'));
  });
});

describe('no edit, no write (P1)', () => {
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

  it('never writes when a note is opened and closed', async () => {
    const session = await openSession(server);
    await settle(5000);
    expect(await session.flush()).toBe(true);
    session.dispose();
    expect(puts(server)).toHaveLength(0);
  });

  it('never writes an edit that was undone before the autosave', async () => {
    const session = await openSession(server);
    const before = session.getView().doc;
    typeInto(session, 'tạm ', 1);
    if (before) session.docChanged(before);
    await settle(AUTOSAVE_DELAY_MS * 4);
    expect(puts(server)).toHaveLength(0);
    expect(status(session)).toBe('clean');
    expect(await indexedDbDrafts.read('vault-a', PATH)).toBeNull();
  });

  it('never writes after entering and leaving source mode without changes', async () => {
    const session = await openSession(server);
    void session.setSourceMode(true);
    await settle();
    session.sourceChanged(`${session.getView().source?.text ?? ''}x`);
    session.sourceChanged(session.getView().source?.text.slice(0, -1) ?? '');
    void session.setSourceMode(false);
    await settle();
    await settle(AUTOSAVE_DELAY_MS * 4);
    expect(puts(server)).toHaveLength(0);
  });
});
