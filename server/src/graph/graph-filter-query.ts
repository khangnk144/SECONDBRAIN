/**
 * `GET /api/graph?folder=&group=&tag=&since=` → a `GraphFilter` (SPEC §9, F24.2). `folder` and
 * `group` repeat or take a comma list; `since` is a calendar date (local midnight) or an ISO
 * instant. No filter parameter at all → null (no `matches` in the answer).
 */
import { isCalendarDate, localMidnight } from '../lib/local-date.js';
import { VaultError } from '../vault/vault-types.js';
import type { GraphFilter, GraphFilterGroup } from './graph-filter.js';

export interface GraphFilterQuery {
  folder?: string[];
  group?: GraphFilterGroup[];
  tag?: string;
  since?: string;
}

const shortText = { type: 'string', maxLength: 500 } as const;
const GROUPS = ['projects', 'areas', 'resources', 'wiki', 'daily', 'other'] as const;

export const graphFilterQuerySchema = {
  type: 'object',
  properties: {
    folder: { type: 'array', items: shortText, maxItems: 50 },
    group: { type: 'array', items: { type: 'string', enum: GROUPS }, maxItems: 6 },
    tag: shortText,
    since: { type: 'string', maxLength: 40 },
  },
} as const;

function sinceInstant(value: string): number {
  const trimmed = value.trim();
  if (isCalendarDate(trimmed)) return localMidnight(trimmed).getTime();
  const instant = /^\d{4}-\d{2}-\d{2}T/.test(trimmed) ? Date.parse(trimmed) : Number.NaN;
  if (Number.isFinite(instant)) return instant;
  throw new VaultError('VALIDATION', 'since must be a date (YYYY-MM-DD) or an ISO instant.', {
    since: value,
  });
}

const list = (values: readonly string[] | undefined) =>
  (values ?? []).flatMap((value) => value.split(',')).map((value) => value.trim());

export function parseGraphFilterQuery(query: GraphFilterQuery): GraphFilter | null {
  const asked =
    query.folder !== undefined ||
    query.group !== undefined ||
    query.tag !== undefined ||
    query.since !== undefined;
  if (!asked) return null;
  const tag = query.tag?.trim() ? query.tag : null;
  return {
    // Empty list items are stray commas (root-level notes are the `other` group).
    folders: list(query.folder).filter((folder) => folder !== ''),
    groups: [...new Set(query.group ?? [])],
    tag,
    since:
      query.since === undefined || query.since.trim() === '' ? null : sinceInstant(query.since),
  };
}
