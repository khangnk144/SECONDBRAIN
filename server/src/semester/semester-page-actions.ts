/**
 * What Settings can do with the "Học kỳ này" page (SPEC F25.1, F25.3):
 * - `enable`: turns it on; the file name follows the UI language unless the app's own page is
 *   still there under its old name; creates the page – never over a file that is not the app's:
 *   a note of hers with that name keeps it, and the page takes the next free name
 *   (`Học kỳ này 2.md`, review M1);
 * - `disable`: turns it off and leaves the file where it is (a plain note from then on; what the
 *   app wrote there until now still never counts as her writing, review L2);
 * - `regenerate` ("Tạo lại"): an edited copy goes to the trash (`generated-replaced`), then a
 *   fresh page is written; a deleted page is created again;
 * - `trash` ("Chuyển trang vào thùng rác"): moves the app's page to the trash (journaled, undoable).
 */
import type { AppContext } from '../app-context/create-app-context.js';
import { linkIdentityKey } from '../markdown/normalize-text.js';
import { VaultError, type VaultPath } from '../vault/vault-types.js';
import type { PageGenerator, SemesterPageStatus } from './semester-page-generator.js';
import { closeSpans, openSpan } from './semester-page-spans.js';
import type { SemesterStateStore } from './semester-page-state.js';

export const SEMESTER_ACTIONS = ['enable', 'disable', 'regenerate', 'trash'] as const;
export type SemesterAction = (typeof SEMESTER_ACTIONS)[number];

export interface SemesterActionResult {
  status: SemesterPageStatus;
  /** `trash`: the journal entry, for the undo toast. */
  journalId?: string;
}

export interface ActionDeps {
  context: Pick<AppContext, 'vault' | 'now' | 'settled'>;
  store: SemesterStateStore;
  generator: PageGenerator;
}

/** The path the page takes when turned on (and whether it is still the previous one). */
async function pathOnEnable(deps: ActionDeps): Promise<VaultPath> {
  const previous = deps.store.get().path;
  if (previous !== null) {
    const current = await deps.generator.readPage(previous);
    if (current !== null && deps.generator.isOurs(current.revision)) return previous;
  }
  return deps.generator.defaultPath();
}

async function enable(deps: ActionDeps): Promise<void> {
  const { store } = deps;
  const path = await pathOnEnable(deps);
  const previous = store.get().path;
  const current = await deps.generator.readPage(path);
  // The app's earlier page counts as its own only while it is still exactly what the app wrote
  // (or gone): edited while the switch was off, it is a note of hers like any other.
  const same =
    previous !== null &&
    linkIdentityKey(previous) === linkIdentityKey(path) &&
    (current === null || deps.generator.isOurs(current.revision));
  await store.update({
    enabled: true,
    path,
    ...(same
      ? {}
      : { lastRevision: null, nextRevision: null, lastGeneratedAt: null, created: null }),
    spans: openSpan(store.get().spans, path, deps.context.now()),
  });
  await deps.generator.regenerate('create');
}

async function disable(deps: ActionDeps): Promise<void> {
  // The generator's last writes reach the event log first, so the span ends after them.
  await deps.context.settled();
  const { store } = deps;
  await store.update({ enabled: false, spans: closeSpans(store.get().spans, deps.context.now()) });
}

async function trash(deps: ActionDeps): Promise<string> {
  const path = deps.store.get().path;
  const current = path === null ? null : await deps.generator.readPage(path);
  if (path === null || current === null) {
    throw new VaultError('NOT_FOUND', 'There is no semester page to move to the trash.', {
      path,
    });
  }
  // A note of hers, or off and edited since (one of her notes now): moved only from the tree.
  const enabled = deps.store.get().enabled;
  const mine = enabled
    ? deps.generator.isAppFile(current)
    : deps.generator.isOurs(current.revision);
  if (!mine) {
    throw new VaultError('VALIDATION', 'This note is no longer the page the app made.', {
      reason: 'not-generated',
    });
  }
  const { journalId } = await deps.context.vault.trash([current.path], [current.revision], 'user');
  return journalId;
}

export async function runSemesterAction(
  action: SemesterAction,
  deps: ActionDeps,
): Promise<SemesterActionResult> {
  let journalId: string | undefined;
  switch (action) {
    case 'enable':
      await enable(deps);
      break;
    case 'disable':
      await disable(deps);
      break;
    case 'regenerate':
      if (!deps.store.get().enabled) {
        throw new VaultError('VALIDATION', 'Turn the semester page on first.', { reason: 'off' });
      }
      await deps.generator.regenerate('replace');
      break;
    case 'trash':
      journalId = await trash(deps);
      break;
  }
  const status = await deps.generator.status();
  return journalId === undefined ? { status } : { status, journalId };
}
