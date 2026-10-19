import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VaultPath } from '../../lib/api/vault-types';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { closeDraftDatabase } from '../drafts/draft-database';
import type { NoteSession } from './note-session';
import type { SessionDeps } from './note-session-types';
import { AUTOSAVE_DELAY_MS } from './session-core';
import { mergeOnto } from './session-rename';
import {
  freshDraftDatabase,
  installFakeNoteServer,
  makeSession,
  settle,
  typeInto,
  useSessionFakeTimers,
  type FakeNoteServer,
} from './session-test-kit';

const PATH = '2 Areas/A.md';
const CONTENT = '# A\n\nXem [[A#Ý chính]] trước.\n\n## Ý chính\n';
const RELINKED = CONTENT.replace('[[A#', '[[B#');

async function run<T>(promise: Promise<T>): Promise<T> {
  await settle();
  return promise;
}

describe('title rename that rewrites links inside the note itself (F3.7)', () => {
  let server: FakeNoteServer;
  let session: NoteSession;
  let typeDuringRename: string | null;

  beforeEach(async () => {
    await resetAppState('vault-a');
    await freshDraftDatabase();
    useSessionFakeTimers();
    server = installFakeNoteServer(PATH, CONTENT);
    typeDuringRename = null;
    // Stands in for lib renameNote: the server relinks the note's own self-link.
    const renameNote: SessionDeps['renameNote'] = vi.fn(async (_path: VaultPath, title: string) => {
      server.writeElsewhere(RELINKED);
      if (typeDuringRename) typeInto(session, typeDuringRename, 1);
      return { ok: true as const, path: `2 Areas/${title}.md` };
    });
    const made = makeSession(PATH, { renameNote });
    session = made.session;
    await run(session.open());
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await closeDraftDatabase();
  });

  it('takes the relinked text as the new base before any further save', async () => {
    await run(session.rename('B'));
    expect(session.path()).toBe('2 Areas/B.md');
    expect(session.getView().status).toBe('clean');
    typeInto(session, 'Mới ', 1);
    await settle(AUTOSAVE_DELAY_MS);
    expect(session.getView().status).toBe('saved');
    expect(server.content).toBe(RELINKED.replace('# A', '# Mới A'));
  });

  it('carries words typed while the rename ran over to the relinked text, without a conflict', async () => {
    typeDuringRename = 'Gõ ';
    await run(session.rename('B'));
    expect(session.getView().conflict).toBeNull();
    await settle(AUTOSAVE_DELAY_MS);
    expect(server.content).toBe(RELINKED.replace('# A', '# Gõ A'));
    expect(session.getView().status).toBe('saved');
  });

  it('a case-only rename moves the session too', async () => {
    const renameNote = vi.fn(async () => ({ ok: true as const, path: '2 Areas/a.md' }));
    const other = makeSession(PATH, { renameNote }).session;
    await run(other.open());
    await run(other.rename('a'));
    expect(other.path()).toBe('2 Areas/a.md');
  });
});

describe('mergeOnto', () => {
  it('applies the base→theirs change onto mine, or gives up when the lines overlap', () => {
    expect(mergeOnto('a\nb\nc\n', 'a\nB\nc\n', 'x\na\nb\nc\n')).toBe('x\na\nB\nc\n');
    expect(mergeOnto('a\nb\nc\n', 'a\nB\nc\n', 'a\nmine\nc\n')).toBeNull();
  });
});
