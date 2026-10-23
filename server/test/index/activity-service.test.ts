import { describe, expect, it } from 'vitest';
import type { ActivityNoteRow } from '../../src/index/activity-rows.js';
import { computeLinksAdded, computeTouchedByDay } from '../../src/index/activity-service.js';
import type { IndexEvent } from '../../src/index/event-log.js';

/** Local wall-clock instant (the server tests pin Asia/Ho_Chi_Minh). */
const at = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute).toISOString();
const mtime = (day: number) => new Date(2026, 9, day, 12, 0).getTime();

const GT = '2 Areas/Giải tích.md';
const RENAMED_GT = '2 Areas/Đổi tên.md';
const B_OLD = '0 Inbox/B.md';
const B = '1 Projects/B.md';

/** A week of history: approximate first index, create, edit, renames, delete and re-create. */
const LOG: IndexEvent[] = [
  // The first index wrote these last, dated in the past (file order is not time order).
  { ts: at(20, 10), event: 'note_created', path: B_OLD },
  { ts: at(20, 11), event: 'link_added', path: B_OLD, target: GT },
  { ts: at(15, 0), event: 'note_created', path: 'A.md', approx: true },
  { ts: at(19, 0), event: 'note_created', path: GT, approx: true },
  { ts: at(21, 9), event: 'note_edited', path: GT },
  { ts: at(21, 9, 5), event: 'note_renamed', path: B, oldPath: B_OLD },
  { ts: at(21, 10), event: 'note_created', path: 'C.md' },
  { ts: at(21, 10, 30), event: 'link_added', path: 'C.md', target: 'Ma' },
  { ts: at(22, 8), event: 'note_deleted', path: 'C.md' },
  { ts: at(22, 9), event: 'note_created', path: 'C.md' },
  { ts: at(22, 9, 10), event: 'link_added', path: 'C.md', target: 'Ma' },
  { ts: at(22, 9, 10), event: 'link_added', path: 'C.md', target: B },
  { ts: at(22, 9, 20), event: 'link_removed', path: 'C.md', target: B },
  { ts: at(22, 9, 25), event: 'link_added', path: 'C.md', target: B },
  { ts: at(22, 9, 30), event: 'note_edited', path: 'Templates/Note.md' },
  { ts: at(23, 7), event: 'note_renamed', path: RENAMED_GT, oldPath: GT },
];

/** What the index holds now (templates are not activity notes, so they are not listed). */
const NOTES: ActivityNoteRow[] = [
  { path: 'A.md', title: 'A', class: 'user', mtimeMs: mtime(18) },
  { path: B, title: 'B', class: 'user', mtimeMs: mtime(20) },
  { path: 'C.md', title: 'C', class: 'user', mtimeMs: mtime(22) },
  { path: RENAMED_GT, title: 'Đổi tên', class: 'user', mtimeMs: mtime(21) },
  { path: 'wiki/Khái niệm.md', title: 'Khái niệm', class: 'wiki', mtimeMs: mtime(19) },
  { path: '4 Archive/Cũ.md', title: 'Cũ', class: 'archived', mtimeMs: mtime(25) },
];

const asObject = (map: Map<string, Set<string>>) =>
  Object.fromEntries([...map].map(([day, paths]) => [day, [...paths].sort()]));

describe('activity: touched notes per day (F35.9)', () => {
  it('(F35.9) follows renames, drops deleted notes, keeps classes, falls back to mtime before note_edited', () => {
    const touched = computeTouchedByDay(LOG, NOTES, '2026-10-19', '2026-10-25');
    expect(asObject(touched)).toEqual({
      // Approximate history (renamed later); the wiki page's mtime is the AI's, not hers (L3).
      '2026-10-19': [RENAMED_GT],
      '2026-10-20': [B],
      // The first note_edited day still counts mtimes; the deleted first C.md is gone.
      '2026-10-21': [RENAMED_GT],
      // The re-created C.md is a new note; the template edit does not count.
      '2026-10-22': ['C.md'],
      '2026-10-23': [], // a rename is not an edit
      '2026-10-24': [],
      '2026-10-25': [], // after the log knew note_edited, mtime alone no longer counts
    });
  });

  it('without any note_edited line every day also counts file mtimes', () => {
    const noEdits = LOG.filter((e) => e.event !== 'note_edited');
    const touched = computeTouchedByDay(noEdits, NOTES, '2026-10-18', '2026-10-25');
    expect([...(touched.get('2026-10-18') ?? [])]).toEqual(['A.md']);
    expect([...(touched.get('2026-10-25') ?? [])]).toEqual(['4 Archive/Cũ.md']);
  });

  it('answers one entry per day and refuses bad ranges', () => {
    expect([...computeTouchedByDay([], [], '2026-10-19', '2026-10-25').keys()]).toHaveLength(7);
    expect(() => computeTouchedByDay([], [], '2026-10-25', '2026-10-19')).toThrow(RangeError);
    expect(() => computeTouchedByDay([], [], '2026-02-30', '2026-03-01')).toThrow(RangeError);
    expect(() => computeTouchedByDay([], [], '2024-01-01', '2026-01-01')).toThrow(RangeError);
  });
});

describe('activity: links added on a day (F24.4 counts)', () => {
  it('unique pairs under current paths; links of a deleted note are dropped', () => {
    expect(computeLinksAdded(LOG, NOTES, '2026-10-20')).toEqual([
      { from: B, to: RENAMED_GT, resolved: true },
    ]);
    expect(computeLinksAdded(LOG, NOTES, '2026-10-21')).toEqual([]);
    expect(computeLinksAdded(LOG, NOTES, '2026-10-22')).toEqual([
      { from: 'C.md', to: 'Ma', resolved: false },
      { from: 'C.md', to: B, resolved: true },
    ]);
  });
});

describe('only her own writing counts (review L3, L2)', () => {
  const WIKI = 'wiki/Khái niệm.md';
  const log: IndexEvent[] = [
    { ts: at(21, 8), event: 'note_edited', path: 'A.md' },
    { ts: at(22, 8), event: 'note_created', path: WIKI },
    { ts: at(22, 8, 1), event: 'link_added', path: WIKI, target: 'A.md' },
    { ts: at(22, 9), event: 'link_added', path: 'A.md', target: WIKI },
    { ts: at(22, 9, 30), event: 'note_edited', path: 'A.md' },
  ];

  it("(F35.9) wiki pages (the AI's) count nowhere; a link of hers to one is a link between notes", () => {
    const touched = computeTouchedByDay(log, NOTES, '2026-10-22', '2026-10-22');
    expect([...(touched.get('2026-10-22') ?? [])]).toEqual(['A.md']);
    expect(computeLinksAdded(log, NOTES, '2026-10-22')).toEqual([
      { from: 'A.md', to: WIKI, resolved: true },
    ]);
  });

  it('(F35.9) events the generator wrote are left out, before and after the page was turned off', () => {
    const page = 'Học kỳ này.md';
    const notes: ActivityNoteRow[] = [
      ...NOTES,
      { path: page, title: 'Học kỳ này', class: 'user', mtimeMs: mtime(22) },
    ];
    const pageLog: IndexEvent[] = [
      ...log,
      { ts: at(22, 10), event: 'note_created', path: page },
      { ts: at(22, 10), event: 'link_added', path: page, target: 'A.md' },
      { ts: at(23, 10), event: 'note_edited', path: page }, // after it was turned off: hers
    ];
    const span = { from: at(22, 9, 59), to: at(22, 12) };
    const generated = (path: string, ts: string) =>
      path === page && ts >= span.from && ts <= span.to;
    const touched = computeTouchedByDay(pageLog, notes, '2026-10-22', '2026-10-23', generated);
    expect([...(touched.get('2026-10-22') ?? [])]).toEqual(['A.md']);
    expect([...(touched.get('2026-10-23') ?? [])]).toEqual([page]);
    expect(computeLinksAdded(pageLog, notes, '2026-10-22', generated)).toEqual([
      { from: 'A.md', to: WIKI, resolved: true },
    ]);
  });
});
