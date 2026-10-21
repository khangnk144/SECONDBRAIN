/** Quick capture (F12) and daily notes (F13), mirrored from the server routes. */
import type { VaultPath } from './vault-types';

/** `POST /api/capture` → 201: the new `0 Inbox/<name>.md`. */
export interface CaptureResponse {
  path: VaultPath;
  revision: string;
}

/** `GET /api/daily?date=` (404 NOT_FOUND when missing; never creates). */
export interface DailyNoteResponse {
  path: VaultPath;
  revision: string;
}

/**
 * `POST /api/daily` → 201. `cursor` = UTF-16 offset of `{{cursor}}` in the written file (null when
 * the template has none). 409 EXISTS carries `details.path`.
 */
export interface CreateDailyResponse {
  path: VaultPath;
  revision: string;
  cursor: number | null;
}

/** `GET /api/daily/neighbors?date=`: vault paths (`Daily/YYYY-MM-DD.md`) of the nearest existing daily notes. */
export interface DailyNeighbors {
  previous: string | null;
  next: string | null;
}
