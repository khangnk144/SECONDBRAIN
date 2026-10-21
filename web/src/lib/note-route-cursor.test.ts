import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noteRoute, type Navigator } from './app-navigation';
import { createNote } from './note-create-operation';
import { installFetchMock, type FetchMock } from './testing/fetch-mock';
import { resetAppState } from './testing/reset-app-state';

const enc = encodeURIComponent;

describe('note route caret position (F14.2)', () => {
  let mock: FetchMock;
  let navigate: ReturnType<typeof vi.fn<Navigator>>;
  beforeEach(async () => {
    navigate = (await resetAppState()) as ReturnType<typeof vi.fn<Navigator>>;
    mock = installFetchMock();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds &cursor= only for a usable offset', () => {
    const path = '2 Areas/Giải tích 1.md';
    expect(noteRoute(path, { isNew: true, cursor: 42 })).toBe(
      `/note?path=${enc(path)}&new=1&cursor=42`,
    );
    expect(noteRoute(path, { cursor: 0 })).toBe(`/note?path=${enc(path)}&cursor=0`);
    for (const cursor of [null, undefined, -1, 1.5]) {
      expect(noteRoute(path, { cursor })).toBe(`/note?path=${enc(path)}`);
    }
  });

  it('a note created from a template opens with the cursor the server reported', async () => {
    mock.on('POST /api/note', {
      status: 201,
      body: { path: '0 Inbox/Bài giảng mới.md', revision: 'r', cursor: 31 },
    });
    await createNote({ title: 'Bài giảng mới', template: 'Templates/Lecture.md' });
    expect(navigate).toHaveBeenLastCalledWith(
      `/note?path=${enc('0 Inbox/Bài giảng mới.md')}&new=1&cursor=31`,
      undefined,
    );
  });
});
