/**
 * Test helpers for note sessions: an in-memory note server behind the `api()` boundary (revision
 * checks like the real one), fake timers that leave IndexedDB's scheduling alone, and editing.
 */
import { EditorState } from '@tiptap/pm/state';
import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';
import { editorSchema } from '../../editor/schema/editor-schema';
import { getNote, patchNoteFrontmatter, postNote, putNote } from '../../lib/api/notes-api';
import type { NoteResponse } from '../../lib/api/notes-types';
import type { ContentClass, VaultPath } from '../../lib/api/vault-types';
import {
  apiError,
  installFetchMock,
  type FetchMock,
  type MockReply,
} from '../../lib/testing/fetch-mock';
import { closeDraftDatabase } from '../drafts/draft-database';
import { indexedDbDrafts } from '../drafts/draft-store';
import { createNoteSession, type NoteSession } from './note-session';
import type { SessionDeps } from './note-session-types';
import { applyTestPatch } from './session-test-patch';

const realSetImmediate = globalThis.setImmediate;

export function revisionOf(content: string): string {
  let hash = 7;
  for (let i = 0; i < content.length; i += 1) hash = (hash * 31 + content.charCodeAt(i)) | 0;
  return `rev-${(hash >>> 0).toString(16)}-${content.length}`;
}

export interface FakeNoteServer {
  mock: FetchMock;
  path: VaultPath;
  content: string | null;
  revision: string | null;
  utf8: boolean;
  noteClass: ContentClass;
  /** Fetch rejects like a stopped server. */
  offline: boolean;
  /** Answer the next write with this error instead of applying it. */
  failNextWrite: MockReply | null;
  /** Writes wait until `release()` is called. */
  hold(): () => void;
  /** Someone else writes the file (another window, another app). */
  writeElsewhere(content: string): void;
  deleteElsewhere(): void;
}

function noteResponse(server: FakeNoteServer): NoteResponse {
  return {
    path: server.path,
    content: server.content ?? '',
    revision: server.revision ?? '',
    utf8: server.utf8,
    mtime: 0,
    frontmatter: null,
    frontmatterError: null,
    backlinks: [],
    outlinks: [],
    tags: [],
    class: server.noteClass,
  };
}

export function installFakeNoteServer(path: VaultPath, content: string | null): FakeNoteServer {
  const mock = installFetchMock();
  let gate: Promise<void> | null = null;
  const server: FakeNoteServer = {
    mock,
    path,
    content,
    revision: content === null ? null : revisionOf(content),
    utf8: true,
    noteClass: 'user',
    offline: false,
    failNextWrite: null,
    hold() {
      let release = () => undefined as void;
      gate = new Promise<void>((resolve) => (release = resolve));
      return () => {
        gate = null;
        release();
      };
    },
    writeElsewhere(next) {
      server.content = next;
      server.revision = revisionOf(next);
    },
    deleteElsewhere() {
      server.content = null;
      server.revision = null;
    },
  };
  const conflict = () =>
    apiError(409, 'CONFLICT', {
      path,
      currentRevision: server.revision,
      ...(server.content !== null && server.utf8 ? { currentContent: server.content } : {}),
    });
  const write = async (expected: string | undefined, next: string, created = false) => {
    if (gate) await gate;
    if (server.offline) throw new TypeError('Failed to fetch');
    if (server.failNextWrite) {
      const reply = server.failNextWrite;
      server.failNextWrite = null;
      return reply;
    }
    if (created ? server.revision !== null : expected !== server.revision || expected === null) {
      return created ? apiError(409, 'EXISTS', { path }) : conflict();
    }
    server.writeElsewhere(next);
    return { body: { revision: server.revision, path }, status: created ? 201 : 200 };
  };
  mock.on('GET /api/note', () => {
    if (server.offline) throw new TypeError('Failed to fetch');
    return server.content === null ? apiError(404, 'NOT_FOUND') : { body: noteResponse(server) };
  });
  mock.on('PUT /api/note', (call) => {
    const body = call.body as { content: string; expectedRevision: string };
    return write(body.expectedRevision, body.content);
  });
  mock.on('POST /api/note', (call) =>
    write(undefined, (call.body as { content: string }).content, true),
  );
  mock.on('PATCH /api/note/frontmatter', async (call) => {
    const body = call.body as {
      expectedRevision: string;
      set?: Record<string, unknown>;
      unset?: string[];
    };
    const next = applyTestPatch(server.content ?? '', body.set ?? {}, body.unset ?? []);
    const reply = await write(body.expectedRevision, next);
    return reply.status === 200 ? { body: { revision: server.revision, content: next } } : reply;
  });
  return server;
}

/** Fake timers for setTimeout/Date only: fake-indexeddb keeps its own (real) scheduling. */
export function useSessionFakeTimers(): void {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
}

/** Lets pending requests, IndexedDB work and timers up to `ms` run. */
export async function settle(ms = 0): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await vi.advanceTimersByTimeAsync(round === 0 ? ms : 0);
    for (let i = 0; i < 8; i += 1) await new Promise<void>((resolve) => realSetImmediate(resolve));
  }
}

export async function freshDraftDatabase(): Promise<void> {
  await closeDraftDatabase();
  vi.stubGlobal('indexedDB', new IDBFactory());
}

let windowSeq = 0;

/** Each test session acts as its own browser window unless a test says otherwise. */
export function testSessionDeps(overrides: Partial<SessionDeps> = {}): SessionDeps {
  windowSeq += 1;
  return {
    windowId: `window-${windowSeq}`,
    api: { getNote, putNote, postNote, patchNoteFrontmatter },
    drafts: indexedDbDrafts,
    renameNote: vi.fn(async (_path: VaultPath, title: string) => ({
      ok: true as const,
      path: title,
    })),
    notify: vi.fn(),
    schema: editorSchema,
    now: () => Date.now(),
    ...overrides,
  };
}

export function makeSession(path: VaultPath, overrides: Partial<SessionDeps> = {}) {
  const deps = testSessionDeps(overrides);
  return { session: createNoteSession(deps, 'vault-a', path), deps };
}

/** Types `text` at document position `pos` (1 = start of the first block). */
export function typeInto(session: NoteSession, text: string, pos = 1): void {
  const doc = session.getView().doc;
  if (!doc) throw new Error('session has no document yet');
  session.docChanged(EditorState.create({ doc }).tr.insertText(text, pos).doc);
}
