/** `GET/POST /api/semester-page` (SPEC F25): the generated "Học kỳ này" page. */
import { api } from '../../lib/api';
import type { VaultPath } from '../../lib/api/vault-types';

/**
 * `off`; `ok` = the app's page, kept current; `edited` = changed outside the app, never
 * overwritten; `missing` = deleted after it was made; `pending` = on but not made yet.
 */
export type SemesterPageState = 'off' | 'ok' | 'edited' | 'missing' | 'pending';

export interface SemesterPageStatus {
  /** False when the page's service is not running for this vault. */
  available: boolean;
  enabled: boolean;
  /** Where the page is, or will be when turned on. */
  path: VaultPath;
  state: SemesterPageState;
  exists: boolean;
  edited: boolean;
  /** The file at `path` is the one the app wrote. */
  ours: boolean;
  /** ISO instant of the last write. */
  lastGeneratedAt: string | null;
}

export type SemesterAction = 'enable' | 'disable' | 'regenerate' | 'trash';

export interface SemesterActionResult {
  status: SemesterPageStatus;
  /** `trash`: for the undo toast. */
  journalId?: string;
}

export function getSemesterPage(): Promise<SemesterPageStatus> {
  return api().get<SemesterPageStatus>('/semester-page');
}

export function postSemesterPage(action: SemesterAction): Promise<SemesterActionResult> {
  return api().request<SemesterActionResult>('/semester-page', {
    method: 'POST',
    body: { action },
  });
}
