/**
 * The notes the tidying dialog lists: the Inbox read fresh when it opens (or the one note asked
 * about), then each note's first line, a few at a time. Reading never changes anything.
 */
import { useCallback, useEffect, useState } from 'react';
import { getNote } from '../../lib/api/notes-api';
import { getTree } from '../../lib/api/tree-api';
import type { VaultPath } from '../../lib/api/vault-types';
import { noteTitleFromPath } from '../../lib/vault-paths';
import { firstLine, inboxNotesOf, type InboxNote } from './inbox-notes';
import type { InboxTidyMode } from './inbox-tidy-store';

export type InboxList =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; notes: InboxNote[] };

const PARALLEL_READS = 3;

export function useInboxList(mode: InboxTidyMode) {
  const [list, setList] = useState<InboxList>({ status: 'loading' });
  const [lines, setLines] = useState<Record<VaultPath, string>>({});
  const [attempt, setAttempt] = useState(0);
  const onePath = mode.kind === 'one' ? mode.path : null;

  useEffect(() => {
    let alive = true;
    setList({ status: 'loading' });
    const load = async (): Promise<InboxNote[]> =>
      onePath !== null
        ? [{ path: onePath, title: noteTitleFromPath(onePath) }]
        : inboxNotesOf(await getTree());
    load().then(
      (notes) => {
        if (!alive) return;
        setList({ status: 'ready', notes });
        void readFirstLines(
          notes,
          () => alive,
          (path, line) => setLines((current) => ({ ...current, [path]: line })),
        );
      },
      () => alive && setList({ status: 'error' }),
    );
    return () => {
      alive = false;
    };
  }, [onePath, attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { list, lines, retry };
}

async function readFirstLines(
  notes: InboxNote[],
  alive: () => boolean,
  found: (path: VaultPath, line: string) => void,
): Promise<void> {
  const queue = [...notes];
  const worker = async () => {
    for (let note = queue.shift(); note && alive(); note = queue.shift()) {
      try {
        const read = await getNote(note.path);
        if (alive()) found(note.path, read.utf8 ? firstLine(read.content, note.title) : '');
      } catch {
        // The title alone still identifies the note.
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL_READS }, worker));
}
