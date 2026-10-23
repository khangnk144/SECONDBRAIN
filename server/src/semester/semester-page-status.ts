/**
 * What Settings and the note banner are told about the "Học kỳ này" page (SPEC F25.1–F25.3): its
 * state from the switch, the state file and the file at the page's path. A note of hers at that
 * path is not the page (review M1): then the page does not exist, it is never "edited".
 */
import type { NoteRead, VaultPath } from '../vault/vault-types.js';
import type { SemesterPageState } from './semester-page-state.js';

/** `off`; `ok` = the app's page; `edited` outside the app; `missing` after a deletion; `pending` = not created yet. */
export type PageStateName = 'off' | 'ok' | 'edited' | 'missing' | 'pending';

export interface SemesterPageStatus {
  available: true;
  enabled: boolean;
  /** Where the page is (or will be when turned on). */
  path: VaultPath;
  state: PageStateName;
  exists: boolean;
  edited: boolean;
  /** The file at `path` is the one the app wrote (offer "Chuyển trang vào thùng rác" when off). */
  ours: boolean;
  lastGeneratedAt: string | null;
}

export function pageStatus(
  state: SemesterPageState,
  path: VaultPath,
  current: NoteRead | null,
  owner: { isAppFile: (page: NoteRead) => boolean; isOurs: (revision: string) => boolean },
): SemesterPageStatus {
  const page = current !== null && owner.isAppFile(current) ? current : null;
  const ours = page !== null && owner.isOurs(page.revision);
  let name: PageStateName = 'off';
  if (state.enabled) {
    if (!page) name = state.lastRevision === null ? 'pending' : 'missing';
    else name = ours ? 'ok' : 'edited';
  }
  return {
    available: true,
    enabled: state.enabled,
    path: page?.path ?? path,
    state: name,
    exists: page !== null,
    edited: name === 'edited',
    ours,
    lastGeneratedAt: state.lastGeneratedAt,
  };
}
