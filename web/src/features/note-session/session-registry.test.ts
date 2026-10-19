import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAppState } from '../../lib/testing/reset-app-state';
import { emitServerEvent } from '../../lib/ws/server-event-bus';
import { closeDraftDatabase } from '../drafts/draft-database';
import { indexedDbDrafts } from '../drafts/draft-store';
import {
  acquireNoteSession,
  noteHasUnsavedChanges,
  openSessionCount,
  releaseNoteSession,
  resetNoteSessions,
} from './session-registry';
import {
  freshDraftDatabase,
  installFakeNoteServer,
  settle,
  testSessionDeps,
  typeInto,
  useSessionFakeTimers,
  type FakeNoteServer,
} from './session-test-kit';

const PATH = '2 Areas/Xác suất thống kê.md';

describe('note session registry', () => {
  let server: FakeNoteServer;

  beforeEach(async () => {
    await resetAppState('vault-a');
    await freshDraftDatabase();
    useSessionFakeTimers();
    server = installFakeNoteServer(PATH, '# Xác suất\n');
  });
  afterEach(async () => {
    resetNoteSessions();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await closeDraftDatabase();
  });

  it('shares one session per note and saves pending edits before letting it go', async () => {
    const deps = testSessionDeps();
    const first = acquireNoteSession('vault-a', PATH, deps);
    const second = acquireNoteSession('vault-a', PATH.normalize('NFD'), deps);
    expect(second).toBe(first);
    await settle();
    expect(noteHasUnsavedChanges('vault-a', PATH)).toBe(false);
    typeInto(first, 'Ôn ', 1);
    expect(noteHasUnsavedChanges('vault-a', PATH)).toBe(true);
    releaseNoteSession(first);
    releaseNoteSession(second);
    await settle();
    expect(server.content).toBe('# Ôn Xác suất\n');
    expect(openSessionCount()).toBe(0);
  });

  it('keeps the session when a release is followed at once by an acquire (StrictMode)', async () => {
    const deps = testSessionDeps();
    const session = acquireNoteSession('vault-a', PATH, deps);
    releaseNoteSession(session);
    expect(acquireNoteSession('vault-a', PATH, deps)).toBe(session);
    await settle();
    expect(openSessionCount()).toBe(1);
    expect(server.mock.callsTo('GET /api/note')).toHaveLength(1);
  });

  it('finds the session under the new path after a rename', async () => {
    const deps = testSessionDeps();
    const session = acquireNoteSession('vault-a', PATH, deps);
    await settle();
    const newPath = '2 Areas/Xác suất.md';
    emitServerEvent({
      type: 'note:renamed',
      oldPath: PATH,
      path: newPath,
      revision: server.revision ?? '',
    });
    releaseNoteSession(session);
    expect(acquireNoteSession('vault-a', newPath, deps)).toBe(session);
  });

  it('writes the draft at once when the page is hidden', async () => {
    const session = acquireNoteSession('vault-a', PATH, testSessionDeps());
    await settle();
    server.offline = true;
    typeInto(session, 'Gấp ', 1);
    window.dispatchEvent(new Event('pagehide'));
    await settle(10);
    expect((await indexedDbDrafts.read('vault-a', PATH))?.text).toBe('# Gấp Xác suất\n');
  });
});
