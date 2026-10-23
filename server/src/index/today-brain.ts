/**
 * "Não hôm nay" (SPEC F24.4): the small constellation of what today touched – notes created or
 * edited today, the notes today's new links point to, and the pages the AI wrote today (F34) –
 * with the links among them. At most 24 nodes, the most connected first. Only titles and paths
 * leave the server, never content.
 */
import { groupOf } from '../graph/vault-graph.js';
import type { VaultPath } from '../vault/vault-types.js';
import type { AddedLink } from './activity-service.js';
import type { ActivityNoteRow } from './activity-rows.js';
import type { IndexService, TodayBrain, TodayBrainEdge } from './index-types.js';

export const MAX_BRAIN_NODES = 24;
/**
 * Notes whose links are looked up, in order of why they are on the map: a day on which a sync
 * tool touched every note stays a few dozen index reads.
 */
export const MAX_BRAIN_CANDIDATES = 120;

/** Why a note is on today's map; lower comes first when the candidates are cut. */
const REASON = { created: 0, edited: 1, aiWritten: 2, linked: 3 } as const;
type Reason = (typeof REASON)[keyof typeof REASON];

export interface TodayBrainInput {
  /**
   * Notes the map may show (user, archived, wiki): titles, and the filter of every path. Only her
   * own notes are in `created`, `touched` and `links`; wiki pages come in as `aiPages` (L3).
   */
  notes: readonly ActivityNoteRow[];
  /** Created today (subset of `touched`). */
  created: ReadonlySet<VaultPath>;
  /** Created or edited today. */
  touched: ReadonlySet<VaultPath>;
  /** Today's added links (unique pairs). */
  links: readonly AddedLink[];
  /** Outputs of today's AI ingest runs, as recorded (unique). */
  aiPages: readonly VaultPath[];
  index: Pick<IndexService, 'outlinks' | 'linkingNotes'>;
}

const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function candidatesOf(input: TodayBrainInput, titles: ReadonlyMap<VaultPath, string>): VaultPath[] {
  const reason = new Map<VaultPath, Reason>();
  const add = (path: VaultPath, why: Reason) => {
    if (!titles.has(path)) return; // deleted since, or not a counted note (template, source)
    const known = reason.get(path);
    if (known === undefined || why < known) reason.set(path, why);
  };
  for (const path of input.created) add(path, REASON.created);
  for (const path of input.touched) add(path, REASON.edited);
  for (const path of input.aiPages) add(path, REASON.aiWritten);
  for (const link of input.links) {
    add(link.from, REASON.linked);
    if (link.resolved) add(link.to, REASON.linked);
  }
  return [...reason]
    .sort((a, b) => a[1] - b[1] || byPath(a[0], b[0]))
    .slice(0, MAX_BRAIN_CANDIDATES)
    .map(([path]) => path);
}

export function buildTodayBrain(input: TodayBrainInput): TodayBrain {
  const titles = new Map(input.notes.map((note) => [note.path, note.title]));
  const candidates = candidatesOf(input, titles);
  // Resolved neighbours of each candidate (both directions) and which ones it links to itself.
  const outgoing = new Map<VaultPath, Set<VaultPath>>();
  const neighbours = new Map<VaultPath, Set<VaultPath>>();
  for (const path of candidates) {
    const out = new Set<VaultPath>();
    for (const link of input.index.outlinks(path)) {
      if (link.toPath !== null && !link.ambiguous && link.toPath !== path) out.add(link.toPath);
    }
    const all = new Set(out);
    for (const from of input.index.linkingNotes(path)) if (from !== path) all.add(from);
    outgoing.set(path, out);
    neighbours.set(path, all);
  }
  const order = new Map(candidates.map((path, index) => [path, index]));
  const chosen = [...candidates]
    .sort(
      (a, b) =>
        (neighbours.get(b)?.size ?? 0) - (neighbours.get(a)?.size ?? 0) ||
        (order.get(a) ?? 0) - (order.get(b) ?? 0),
    )
    .slice(0, MAX_BRAIN_NODES);
  const shown = new Set(chosen);
  const edges = new Map<string, TodayBrainEdge>();
  for (const from of chosen) {
    for (const to of outgoing.get(from) ?? []) {
      if (!shown.has(to)) continue;
      const key = from < to ? `${from}\n${to}` : `${to}\n${from}`;
      // Two notes linking each other: one edge, from the smaller path (as the brain map does).
      const existing = edges.get(key);
      if (!existing || (existing.from !== from && from < to)) edges.set(key, { from, to });
    }
  }
  return {
    notesNew: input.created.size,
    notesTouched: input.touched.size,
    linksAdded: input.links.length,
    aiTouched: new Set(input.aiPages).size,
    nodes: chosen.map((path) => ({ path, title: titles.get(path) ?? path, group: groupOf(path) })),
    edges: [...edges.values()].sort((a, b) => byPath(a.from, b.from) || byPath(a.to, b.to)),
  };
}
