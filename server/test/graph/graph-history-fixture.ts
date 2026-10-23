/**
 * A 6-week event log (SPEC §4.15) and the live index it ends in, for the graph history tests
 * (F24.1) on the server and on the web. Times are local (the suites pin Asia/Ho_Chi_Minh); weeks
 * start on Monday: W1 2026-09-14 … W6 2026-10-19 (the current week, "now" = Thu 2026-10-22).
 */
import type { GraphRows } from '../../src/index/view-row-queries.js';

/** Local instant `YYYY-MM-DD HH:mm` as an ISO string (what the indexer writes). */
export function at(local: string): string {
  const [date = '', time = '00:00'] = local.split(' ');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0).toISOString();
}

export const IDEA = '1 Projects/Ý tưởng hay.md';
export const IDEA_OLD = '0 Inbox/Ý tưởng.md';
export const COURSE = '2 Areas/Giải tích 1.md';
export const CONCEPT = 'wiki/Đạo hàm.md';
export const PROJECT = '1 Projects/Đồ án Giải tích.md';
export const PDF = '3 Resources/papers/bài giảng 1.pdf';
export const DAILY = 'Daily/2026-10-06.md';
export const TEMPLATE = 'Templates/Mẫu.md';

export const NOW = new Date(2026, 9, 22, 15, 0);
export const WEEKS = [
  '2026-09-14',
  '2026-09-21',
  '2026-09-28',
  '2026-10-05',
  '2026-10-12',
  '2026-10-19',
];

const line = (value: Record<string, unknown>) => JSON.stringify(value);

export const FIXTURE_LOG: string[] = [
  // The first index reconstructed these (dates from `created`).
  line({ ts: at('2026-09-14'), event: 'note_created', path: CONCEPT, approx: true }),
  line({ ts: at('2026-09-15'), event: 'note_created', path: IDEA_OLD, approx: true }),
  line({ ts: at('2026-09-16'), event: 'note_created', path: COURSE, approx: true }),
  // W2: exact history begins.
  line({ ts: at('2026-09-22 10:00'), event: 'note_created', path: PROJECT }),
  line({ ts: at('2026-09-22 10:00'), event: 'link_added', path: PROJECT, target: COURSE }),
  line({ ts: at('2026-09-23 09:00'), event: 'link_added', path: IDEA_OLD, target: 'Ghost' }),
  // W3: a rename keeps the identity; a link to a PDF makes it a source node.
  line({ ts: at('2026-09-29 08:00'), event: 'note_renamed', path: IDEA, oldPath: IDEA_OLD }),
  line({ ts: at('2026-09-30 08:00'), event: 'link_added', path: IDEA, target: PDF }),
  '{"ts": "2026-09-30T05:00:00.000Z", "event": "note_created", "path": ',
  line({ ts: at('2026-09-30 09:00'), event: 'note_edited', path: IDEA }),
  '',
  line({ event: 'note_created', path: '0 Inbox/Không có giờ.md' }),
  line({ ts: 'not a date', event: 'note_created', path: '0 Inbox/Giờ sai.md' }),
  // W4: a daily note links the project; a template is never drawn; two links end.
  line({ ts: at('2026-10-06 07:00'), event: 'note_created', path: DAILY }),
  line({ ts: at('2026-10-06 07:00'), event: 'link_added', path: DAILY, target: PROJECT }),
  line({ ts: at('2026-10-07 07:00'), event: 'note_created', path: TEMPLATE }),
  line({ ts: at('2026-10-07 07:00'), event: 'link_added', path: TEMPLATE, target: COURSE }),
  line({ ts: at('2026-10-08 20:00'), event: 'link_removed', path: PROJECT, target: COURSE }),
  // Present since the first index (never logged as added), removed now.
  line({ ts: at('2026-10-09 20:00'), event: 'link_removed', path: COURSE, target: CONCEPT }),
  // W5: the daily note goes to the trash; the project links the course again; the PDF link ends.
  line({ ts: at('2026-10-13 12:00'), event: 'note_deleted', path: DAILY }),
  line({ ts: at('2026-10-14 12:00'), event: 'link_added', path: PROJECT, target: COURSE }),
  line({ ts: at('2026-10-15 12:00'), event: 'link_removed', path: IDEA, target: PDF }),
  // W6: restored from the trash (same identity, a second lifetime) with its link.
  line({ ts: at('2026-10-20 09:00'), event: 'note_created', path: DAILY }),
  line({ ts: at('2026-10-20 09:00'), event: 'link_added', path: DAILY, target: PROJECT }),
];

/** The index at `NOW`. The idea → concept link was there at the first index (never logged). */
export const LIVE_ROWS: GraphRows = {
  notes: [
    { path: IDEA, title: 'Ý tưởng hay', class: 'user' },
    { path: COURSE, title: 'Giải tích 1', class: 'user' },
    { path: CONCEPT, title: 'Đạo hàm', class: 'wiki' },
    { path: PROJECT, title: 'Đồ án Giải tích', class: 'user' },
    { path: DAILY, title: '2026-10-06', class: 'user' },
    { path: TEMPLATE, title: 'Mẫu', class: 'template' },
  ],
  files: [PDF],
  links: [
    { from: IDEA, to: CONCEPT },
    { from: PROJECT, to: COURSE },
    { from: DAILY, to: PROJECT },
    { from: TEMPLATE, to: COURSE },
  ],
};

const pair = (a: string, b: string) => (a < b ? `${a} — ${b}` : `${b} — ${a}`);

/** What existed at the end of each week (sorted ids, sorted "a — b" pairs). */
export const EXPECTED_WEEKS: { nodes: string[]; edges: string[] }[] = [
  { nodes: [COURSE, IDEA, CONCEPT], edges: [pair(COURSE, CONCEPT), pair(IDEA, CONCEPT)] },
  {
    nodes: [IDEA, PROJECT, COURSE, CONCEPT],
    edges: [pair(COURSE, CONCEPT), pair(IDEA, CONCEPT), pair(PROJECT, COURSE)],
  },
  {
    nodes: [IDEA, PROJECT, COURSE, PDF, CONCEPT],
    edges: [pair(COURSE, CONCEPT), pair(IDEA, CONCEPT), pair(PROJECT, COURSE), pair(IDEA, PDF)],
  },
  {
    nodes: [IDEA, PROJECT, COURSE, PDF, DAILY, CONCEPT],
    edges: [pair(IDEA, CONCEPT), pair(IDEA, PDF), pair(DAILY, PROJECT)],
  },
  { nodes: [IDEA, PROJECT, COURSE, CONCEPT], edges: [pair(IDEA, CONCEPT), pair(PROJECT, COURSE)] },
  {
    nodes: [IDEA, PROJECT, COURSE, DAILY, CONCEPT],
    edges: [pair(IDEA, CONCEPT), pair(PROJECT, COURSE), pair(DAILY, PROJECT)],
  },
].map(({ nodes, edges }) => ({ nodes: [...nodes].sort(), edges: [...edges].sort() }));

export { pair as edgeKey };
