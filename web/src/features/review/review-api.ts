/** `GET /api/review/week` (SPEC F26.1): the seven local days ending on `end`. */
import { api } from '../../lib/api';
import { withQuery } from '../../lib/api/query-string';
import type { VaultPath } from '../../lib/api/vault-types';

export interface ReviewNote {
  path: VaultPath;
  title: string;
  /** Top folder ('' at the vault root). */
  folder: string;
  change: 'created' | 'edited';
  /** Last day of the week the note was touched (`YYYY-MM-DD`). */
  day: string;
}

export interface ReviewTask {
  path: VaultPath;
  noteTitle: string;
  /** 1-based file line. */
  line: number;
  text: string;
  completed: string;
}

export interface WeekReview {
  start: string;
  end: string;
  inbox: { count: number };
  /** Lists hold at most 50 rows; counts are complete. */
  notes: { count: number; items: ReviewNote[] };
  tasksDone: { count: number; items: ReviewTask[] };
  /** Open deadline items of the seven days after `end`. */
  upcoming: { count: number; from: string; to: string };
}

export function getWeekReview(end?: string): Promise<WeekReview> {
  return api().get<WeekReview>(withQuery('/review/week', { end }));
}
