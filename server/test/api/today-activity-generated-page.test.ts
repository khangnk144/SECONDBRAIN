import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { IndexEvent } from '../../src/index/event-log.js';
import { makeClock } from '../index/helpers/index-test-vault.js';
import {
  note,
  PAGE,
  project,
  startSemesterHost,
  type SemesterHost,
} from '../semester/semester-test-host.js';

const COURSE = '2 Areas/Giải tích 1.md';
const PROJECT = '1 Projects/Đồ án Giải tích.md';
const projectText = (ticked: boolean) =>
  project(
    { deadline: '2026-03-14', course: '"[[Giải tích 1]]"' },
    ticked ? '- [x] Nộp bài 1 ✅ 2026-03-03\n' : '- [ ] Nộp bài 1\n',
  );

let h: SemesterHost | null = null;
afterEach(async () => {
  await h?.t.close();
  h = null;
});

function pageEvents(host: SemesterHost): IndexEvent[] {
  return readFileSync(host.t.context.vault.paths.eventsFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as IndexEvent)
    .filter((event) => event.path === PAGE);
}

interface Brain {
  notesNew: number;
  notesTouched: number;
  linksAdded: number;
  nodes: { path: string }[];
  edges: { from: string; to: string }[];
}

async function todayActivity(host: SemesterHost) {
  const res = await host.t.call('GET', '/api/today');
  expect(res.statusCode).toBe(200);
  return res.json().activity as { days: { date: string; count: number }[]; brain: Brain };
}

describe('the generated "Học kỳ này" page is the app’s writing, not hers (F25.1, F35.9, F24.4)', () => {
  it('(F35.9)(F24.4) its creation, rebuilds and links count in no Today tile', async () => {
    // Monday 2/3 (local), far from any real file mtime of a test run.
    const clock = makeClock(new Date(2026, 2, 2, 9, 0));
    h = await startSemesterHost(47871, { now: clock.now });
    await h.write(COURSE, note({ type: 'course' }, '# Giải tích 1\n'));
    await h.write(PROJECT, projectText(false));
    await h.service().act('enable');
    await h.rebuild();
    expect(h.page()).not.toBeNull();

    // The log really holds the page's own lines: created today, linking both notes.
    const created = pageEvents(h);
    expect(created.map((e) => e.event)).toContain('note_created');
    expect(created.filter((e) => e.event === 'link_added').map((e) => e.target)).toEqual(
      expect.arrayContaining([COURSE, PROJECT]),
    );

    let activity = await todayActivity(h);
    // Her two notes; the page she did not write is not a third.
    expect(activity.days.at(-1)).toEqual({ date: '2026-03-02', count: 2 });
    expect(activity.brain).toMatchObject({ notesNew: 2, notesTouched: 2, linksAdded: 1 });
    expect(activity.brain.nodes.map((n) => n.path).sort()).toEqual([PROJECT, COURSE]);
    expect(activity.brain.edges).toEqual([{ from: PROJECT, to: COURSE }]);

    // Tuesday: she ticks a task; the generator rewrites the page (a `note_edited` of the page).
    clock.set(new Date(2026, 2, 3, 20, 0));
    await h.write(PROJECT, projectText(true));
    await h.rebuild();
    expect(pageEvents(h).filter((e) => e.event === 'note_edited')).toHaveLength(1);

    activity = await todayActivity(h);
    expect(activity.days.slice(-2)).toEqual([
      { date: '2026-03-02', count: 2 },
      { date: '2026-03-03', count: 1 },
    ]);
    expect(activity.brain).toMatchObject({ notesNew: 0, notesTouched: 1, linksAdded: 0 });
    expect(activity.brain.nodes.map((n) => n.path)).toEqual([PROJECT]);

    // The weekly review reads the same counted notes (F26.1).
    const review = (await h.t.call('GET', '/api/review/week?end=2026-03-08')).json();
    expect(review.notes.items.map((n: { path: string }) => n.path).sort()).toEqual([
      PROJECT,
      COURSE,
    ]);
  });
});
