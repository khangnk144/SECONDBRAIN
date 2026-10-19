import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMarkdown } from '../../editor/markdown/markdown-document';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { closeDraftDatabase } from '../drafts/draft-database';
import type { NoteSession } from './note-session';
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

// Lets a test make the converter report a save without an exact Markdown form.
const converter = vi.hoisted(() => ({ inexact: false }));
vi.mock('../../editor/markdown/markdown-document', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../editor/markdown/markdown-document')>();
  return {
    ...actual,
    saveMarkdownWithSnapshot: (...args: Parameters<typeof actual.saveMarkdownWithSnapshot>) => {
      const result = actual.saveMarkdownWithSnapshot(...args);
      return converter.inexact ? { ...result, exact: false } : result;
    },
  };
});

const PATH = '1 Projects/Đồ án Giải tích.md';
const CONTENT = '---\nstatus: doing\n---\n# Đồ án\n\nThân *bài* viết.\n';

async function open(server: FakeNoteServer): Promise<NoteSession> {
  const { session } = makeSession(server.path);
  const opened = session.open();
  await settle();
  await opened;
  return session;
}

const puts = (server: FakeNoteServer) => server.mock.callsTo('PUT /api/note');

describe('note session races around source mode and saves', () => {
  let server: FakeNoteServer;

  beforeEach(async () => {
    await resetAppState('vault-a');
    await freshDraftDatabase();
    useSessionFakeTimers();
    converter.inexact = false;
    server = installFakeNoteServer(PATH, CONTENT);
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await closeDraftDatabase();
  });

  it('Alt+S while a property patch is on its way waits for it and keeps the new front matter', async () => {
    const session = await open(server);
    const release = server.hold();
    const patched = session.patchFrontmatter({ set: { status: 'done' } });
    await settle();
    const entered = session.setSourceMode(true);
    await settle();
    expect(session.getView().source).toBeNull();
    release();
    await settle();
    await Promise.all([patched, entered]);
    expect(session.getView().source?.text).toBe(CONTENT.replace('doing', 'done'));
    await settle(AUTOSAVE_DELAY_MS * 4);
    expect(puts(server)).toHaveLength(0);
    expect(server.content).toBe(CONTENT.replace('doing', 'done'));
  });

  it('a save on its way never brings back old bytes over a source-mode edit', async () => {
    const session = await open(server);
    typeInto(session, 'X', 1);
    const release = server.hold();
    await settle(AUTOSAVE_DELAY_MS);
    const entered = session.setSourceMode(true);
    await settle();
    // The switch waits for the save on its way, so the source text is built from its result.
    expect(session.getView().source).toBeNull();
    release();
    await settle();
    await entered;
    const shown = session.getView().source?.text ?? '';
    session.sourceChanged(shown.replace('*bài*', '_bài_'));
    void session.setSourceMode(false);
    await settle(AUTOSAVE_DELAY_MS);
    typeInto(session, 'Y', 1);
    await settle(AUTOSAVE_DELAY_MS);
    expect(server.content).toBe('---\nstatus: doing\n---\n# YXĐồ án\n\nThân _bài_ viết.\n');
  });

  it('after a save without an exact Markdown form, the editor shows what the file now holds', async () => {
    const session = await open(server);
    const version = session.getView().docVersion;
    converter.inexact = true;
    typeInto(session, 'X', 1);
    await settle(AUTOSAVE_DELAY_MS);
    const view = session.getView();
    expect(view.status).toBe('saved');
    expect(view.docVersion).toBe(version + 1);
    expect(view.keepSelection).toBe(true);
    expect(view.doc?.eq(loadMarkdown(server.content ?? '').doc)).toBe(true);
  });

  it('waits with that reload until no keystroke is on its way, so nothing typed is lost', async () => {
    const session = await open(server);
    const version = session.getView().docVersion;
    converter.inexact = true;
    typeInto(session, 'X', 1);
    const release = server.hold();
    await settle(AUTOSAVE_DELAY_MS);
    typeInto(session, 'Y', 1);
    converter.inexact = false;
    release();
    await settle();
    expect(session.getView().docVersion).toBe(version);
    await settle(AUTOSAVE_DELAY_MS);
    expect(server.content).toContain('# YXĐồ án');
    expect(session.getView().docVersion).toBe(version + 1);
    expect(session.getView().doc?.textContent).toContain('YXĐồ án');
  });
});
