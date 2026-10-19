import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiError, installFetchMock, type FetchMock } from './testing/fetch-mock';
import { resetAppState } from './testing/reset-app-state';
import { useToastStore } from './toast-store';
import { conflictMessage, undoJournal } from './undo-toast';

const lastToast = () => useToastStore.getState().toasts.at(-1);

describe('undo conflict names the changed notes (SPEC §4.12, F20.2)', () => {
  let mock: FetchMock;
  beforeEach(async () => {
    await resetAppState();
    mock = installFetchMock();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('one note: its title', async () => {
    mock.on(
      'POST /api/journal/01JOURNAL0030/undo',
      apiError(409, 'CONFLICT', {
        journalId: '01JOURNAL0030',
        conflicts: [
          { path: '2 Areas/Giải tích 1.md', expectedRevision: 'a', currentRevision: 'b' },
        ],
      }),
    );
    await expect(undoJournal('01JOURNAL0030')).resolves.toBe(false);
    expect(lastToast()).toMatchObject({
      message: 'Không hoàn tác được vì ghi chú “Giải tích 1” đã được sửa sau đó.',
      tone: 'error',
    });
  });

  it('several notes: the first title and how many others; the count alone when unnamed', async () => {
    mock.on(
      'POST /api/journal/01JOURNAL0031/undo',
      apiError(409, 'CONFLICT', {
        journalId: '01JOURNAL0031',
        conflicts: [{ path: 'Daily/2026-10-18.md' }, { path: 'a.md' }, { path: 'b.md' }],
      }),
    );
    await undoJournal('01JOURNAL0031');
    expect(lastToast()?.message).toBe(
      'Không hoàn tác được vì “2026-10-18” và 2 ghi chú khác đã được sửa sau đó.',
    );
    expect(conflictMessage('undo', [], 3)).toBe(
      'Không hoàn tác được vì 3 ghi chú đã được sửa sau đó.',
    );
    expect(conflictMessage('complete', ['x/Bài 1.md'])).toBe(
      'Không hoàn tất được vì ghi chú “Bài 1” đã được sửa sau đó.',
    );
  });
});
