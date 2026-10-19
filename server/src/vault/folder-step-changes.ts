/**
 * The changes a folder step reports: one per file (so the index and open tabs follow) and one per
 * folder (so the tree refreshes). They are emitted synchronously right after the directory move:
 * the watcher sees the same move moments later, and its echo is recognised only if the app's own
 * changes were recorded first.
 */
import path from 'node:path';
import { isNotePath } from '../markdown/content-classes.js';
import type { Direction } from './journal-step-state.js';
import type { FolderFile, JournalStep } from './journal-types.js';
import type { VaultCore } from './vault-core.js';
import { readFileState } from './vault-file-state.js';
import type { VaultPath } from './vault-types.js';

/**
 * Revisions of the notes the step carries, read in `dir` before the move (clients keep the
 * revisions of open notes, so these must be current; other files keep the recorded ones).
 */
export async function noteRevisionsIn(
  dir: string,
  files: readonly FolderFile[],
): Promise<Map<string, string>> {
  const revisions = new Map<string, string>();
  for (const file of files) {
    if (!isNotePath(file.path)) continue;
    try {
      const state = await readFileState(path.join(dir, ...file.path.split('/')));
      if (state) revisions.set(file.path, state.revision);
    } catch {
      // Unreadable now: the recorded revision is reported instead.
    }
  }
  return revisions;
}

export function emitFolderChanges(
  core: VaultCore,
  step: JournalStep,
  direction: Direction,
  revisions: ReadonlyMap<string, string>,
): void {
  const origin = 'app' as const;
  const files = step.files ?? [];
  const folders = [...(step.folders ?? [])].sort();
  const under = (base: VaultPath, rel: string) => `${base}/${rel}`;
  const revisionOf = (file: FolderFile) => revisions.get(file.path) ?? file.revision;
  const created = (base: VaultPath) => {
    for (const folder of [base, ...folders.map((f) => under(base, f))]) {
      core.emit({ kind: 'folder-created', path: folder, origin });
    }
  };
  const deleted = (base: VaultPath) => {
    for (const folder of [...folders.map((f) => under(base, f)).reverse(), base]) {
      core.emit({ kind: 'folder-deleted', path: folder, origin });
    }
  };
  if (step.kind === 'folder-rename') {
    const forward = direction === 'forward';
    const [fromBase, toBase] = forward ? [step.path, step.newPath!] : [step.newPath!, step.path];
    created(toBase);
    for (const file of files) {
      const [target, oldPath] = [under(toBase, file.path), under(fromBase, file.path)];
      core.emit({ kind: 'renamed', path: target, oldPath, revision: revisionOf(file), origin });
    }
    deleted(fromBase);
  } else if (direction === 'forward') {
    for (const file of files) {
      core.emit({ kind: 'deleted', path: under(step.path, file.path), origin });
    }
    deleted(step.path);
  } else {
    created(step.path);
    for (const file of files) {
      const target = under(step.path, file.path);
      core.emit({ kind: 'created', path: target, revision: revisionOf(file), origin });
    }
  }
}
