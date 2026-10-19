/**
 * The `due:` search filter: notes owning an OPEN deadline item in the requested range of local
 * calendar days, computed with the same rules as Today and the Calendar.
 */
import { diffDays } from '../lib/local-date.js';
import type { VaultPath } from '../vault/vault-types.js';
import { collectItems } from './deadline-rules.js';
import { loadDeadlineSources } from './deadline-service.js';
import type { IndexService } from './index-types.js';
import type { DueFilter } from './search-query-parser.js';

const IN_RANGE: Record<DueFilter, (daysLeft: number) => boolean> = {
  '7d': (d) => d >= 0 && d <= 7,
  '30d': (d) => d >= 0 && d <= 30,
  overdue: (d) => d < 0,
};

export function notesWithOpenItems(
  index: Pick<IndexService, 'listNotes' | 'allTasks' | 'deadlineRows'>,
  today: string,
  due: DueFilter,
  includeArchive: boolean,
): VaultPath[] {
  const inRange = IN_RANGE[due];
  const paths = new Set<VaultPath>();
  for (const item of collectItems(loadDeadlineSources(index), today, includeArchive))
    if (!item.done && inRange(diffDays(today, item.date))) paths.add(item.path);
  return [...paths];
}
