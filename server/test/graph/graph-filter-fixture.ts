/** Nodes for the graph filter tests (F24.2), shared with the web parity test. */
import { normalizeGraphTag, type GraphFilterFacts } from '../../src/graph/graph-filter.js';

export const DAY = 86_400_000;
export const NOW = new Date(2026, 9, 22, 15, 0).getTime();

/** NFD spellings, as a Mac or a copy-paste may produce them. */
export const nfd = (s: string) => s.normalize('NFD');

export const FILTER_NODES: GraphFilterFacts[] = [
  {
    id: '1 Projects/Đồ án Giải tích.md',
    group: 'projects',
    kind: 'note',
    tags: ['do-an', 'mon/giai-tich'],
    mtimeMs: NOW - 2 * DAY,
  },
  {
    id: '2 Areas/Giải tích 1.md',
    group: 'areas',
    kind: 'note',
    tags: [normalizeGraphTag('#Môn/Giải-tích')],
    mtimeMs: NOW - 20 * DAY,
  },
  { id: 'Daily/2026-10-22.md', group: 'daily', kind: 'note', tags: [], mtimeMs: NOW - 3600_000 },
  // Copied into the vault today with an old file time: created counts as touched.
  {
    id: '0 Inbox/Bài cũ.md',
    group: 'other',
    kind: 'note',
    tags: [normalizeGraphTag('đồ-án')],
    mtimeMs: NOW - 400 * DAY,
    createdMs: NOW - 3600_000,
  },
  { id: 'Ghi chú gốc.md', group: 'other', kind: 'note', tags: [], mtimeMs: NOW - 40 * DAY },
  { id: '3 Resources/papers/bài 1.pdf', group: 'resources', kind: 'source', tags: [] },
];
