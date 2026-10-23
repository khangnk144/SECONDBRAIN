// The app never takes over a note it did not write (review M1), and what it wrote never counts as
// her writing, also after the switch is off (review L2). SPEC F25.1–F25.3, F35.9, F26.1.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isManagedPage } from '../../src/semester/generated-page-registry.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';
import { makeClock } from '../index/helpers/index-test-vault.js';
import {
  note,
  PAGE,
  project,
  SEMESTER_FIXTURE,
  seedFiles,
  startSemesterHost,
  type SemesterHost,
} from './semester-test-host.js';

const OWN = '# Học kỳ này\n\nGhi chú riêng của mình về học kỳ.\n';
const PAGE2 = 'Học kỳ này 2.md';
const COURSE = '2 Areas/Giải tích 1.md';
const PROJECT = '1 Projects/Đồ án Giải tích.md';

let h: SemesterHost | null = null;
afterEach(async () => {
  await h?.t.close();
  h = null;
});

const monday = () => makeClock(new Date(2026, 2, 2, 9, 0));

describe('a note of hers named like the page is never taken over (F25.1–F25.3, review M1)', () => {
  it('(F25.2) enabling makes "Học kỳ này 2.md"; her note stays hers: saved, patched, never trashed', async () => {
    h = await startSemesterHost(47831, {
      now: monday().now,
      seed: (root) => seedFiles(root, { ...SEMESTER_FIXTURE, [PAGE]: OWN }),
    });
    const before = (await h.t.call('GET', '/api/semester-page')).json();
    expect(before).toMatchObject({ enabled: false, state: 'off', exists: false, ours: false });

    const enable = await h.t.call('POST', '/api/semester-page', { action: 'enable' });
    expect(enable.statusCode).toBe(200);
    expect(enable.json().status).toMatchObject({
      enabled: true,
      state: 'ok',
      edited: false,
      ours: true,
      path: PAGE2,
    });
    expect(h.page()).toBe(OWN);
    expect(h.page(PAGE2)).toContain('generated: true');

    // Her note is an ordinary note: saves and patches go through.
    const read = await h.t.context.vault.read(PAGE);
    const save = await h.t.call('PUT', '/api/note', {
      path: PAGE,
      content: `${OWN}thêm một dòng\n`,
      expectedRevision: read.revision,
    });
    expect(save.statusCode, save.body).toBe(200);
    const patch = await h.t.call('PATCH', '/api/note/frontmatter', {
      path: PAGE,
      expectedRevision: save.json().revision,
      set: { tags: ['x'] },
    });
    expect(patch.statusCode, patch.body).toBe(200);
    // The page itself is guarded.
    const page = await h.t.context.vault.read(PAGE2);
    const refused = await h.t.call('PUT', '/api/note', {
      path: PAGE2,
      content: 'x\n',
      expectedRevision: page.revision,
    });
    expect(refused.json().error.code).toBe('GENERATED_PAGE');

    // "Tạo lại" works on the app's page, never on hers.
    const regen = await h.t.call('POST', '/api/semester-page', { action: 'regenerate' });
    expect(regen.json().status).toMatchObject({ state: 'ok', path: PAGE2 });
    expect(h.page()).toContain('thêm một dòng');
    expect(h.page()).toContain('tags:');
  });

  it('(F25.1) the English UI names the free one "This semester 2.md"', async () => {
    h = await startSemesterHost(47832, {
      now: monday().now,
      seed: (root) => seedFiles(root, { 'This semester.md': '# Mine\n' }),
    });
    h.t.settings.ui.language = 'en';
    const { status } = await h.service().act('enable');
    expect(status).toMatchObject({ state: 'ok', path: 'This semester 2.md' });
    expect(h.page('This semester.md')).toBe('# Mine\n');
  });

  it('(F25.3) a note of hers made where the deleted page was is hers: not guarded, not "edited", "Tạo lại" uses a free name', async () => {
    h = await startSemesterHost(47833, {
      now: monday().now,
      seed: (root) => seedFiles(root, SEMESTER_FIXTURE),
    });
    await h.service().act('enable');
    expect(isManagedPage(h.t.context.vault, PAGE)).toBe(true);
    // She deletes the page from the tree, then writes her own note with that name.
    const page = await h.t.context.vault.read(PAGE);
    await h.t.context.vault.trash([PAGE], [page.revision], 'user');
    await h.rebuild();
    await h.write(PAGE, OWN);
    await h.rebuild();
    expect(isManagedPage(h.t.context.vault, PAGE)).toBe(false);
    const status = (await h.t.call('GET', '/api/semester-page')).json();
    expect(status).toMatchObject({ state: 'missing', exists: false, edited: false });
    const read = await h.t.context.vault.read(PAGE);
    const save = await h.t.call('PUT', '/api/note', {
      path: PAGE,
      content: `${OWN}sửa\n`,
      expectedRevision: read.revision,
    });
    expect(save.statusCode, save.body).toBe(200);
    // Neither the next rebuild nor "Chuyển trang vào thùng rác" touches it.
    await h.write(PROJECT, SEMESTER_FIXTURE[PROJECT]!.replace('- [ ] Bốn', '- [x] Bốn'));
    await h.rebuild();
    expect(h.page()).toBe(`${OWN}sửa\n`);
    const trash = await h.t.call('POST', '/api/semester-page', { action: 'trash' });
    expect(trash.statusCode).toBe(400);
    expect(h.page()).toBe(`${OWN}sửa\n`);
    // "Tạo lại" creates the page again under a free name.
    const regen = await h.t.call('POST', '/api/semester-page', { action: 'regenerate' });
    expect(regen.json().status).toMatchObject({ state: 'ok', path: PAGE2 });
    expect(h.page()).toBe(`${OWN}sửa\n`);
  });

  it('(F25.3) the old page edited while the switch was off is hers: turning it on again leaves it', async () => {
    h = await startSemesterHost(47838, {
      now: monday().now,
      seed: (root) => seedFiles(root, SEMESTER_FIXTURE),
    });
    await h.service().act('enable');
    await h.service().act('disable');
    const old = await h.t.context.vault.read(PAGE);
    await h.write(PAGE, `${old.content}\nGhi chú của tôi.\n`); // a plain note now: saved in the app
    const { status } = await h.service().act('enable');
    expect(status).toMatchObject({ state: 'ok', path: PAGE2 });
    expect(h.page()).toContain('Ghi chú của tôi.');
    expect(isManagedPage(h.t.context.vault, PAGE)).toBe(false);
  });

  it('(F25.3) the app\'s page edited outside, still marked generated, stays guarded and "edited"', async () => {
    h = await startSemesterHost(47834, {
      now: monday().now,
      seed: (root) => seedFiles(root, SEMESTER_FIXTURE),
    });
    await h.service().act('enable');
    h.diskWrite(PAGE, `${h.page()}\nGhi chú của tôi.\n`);
    await h.t.context.index.updateFile(PAGE);
    await h.rebuild();
    expect((await h.service().status()).state).toBe('edited');
    expect(isManagedPage(h.t.context.vault, PAGE)).toBe(true);
  });
});

describe('what the app wrote never counts as her writing, also after the switch is off (F35.9, F26.1, review L2)', () => {
  it('(F35.9) turning the page off adds nothing to Today or the weekly review', async () => {
    const clock = makeClock(new Date(2026, 2, 2, 9, 0));
    h = await startSemesterHost(47835, { now: clock.now });
    await h.write(COURSE, note({ type: 'course' }, '# Giải tích 1\n'));
    await h.write(PROJECT, project({ deadline: '2026-03-14', course: '"[[Giải tích 1]]"' }));
    clock.set(new Date(2026, 2, 2, 9, 5));
    await h.service().act('enable');
    await h.rebuild();
    const today = async () => (await h!.t.call('GET', '/api/today')).json().activity;
    const on = await today();
    expect(on.days.at(-1)).toEqual({ date: '2026-03-02', count: 2 });

    clock.set(new Date(2026, 2, 2, 9, 10));
    await h.service().act('disable');
    const off = await today();
    expect(off.days.at(-1)).toEqual({ date: '2026-03-02', count: 2 });
    expect(off.brain).toMatchObject({ notesNew: 2, notesTouched: 2, linksAdded: 1 });
    expect(off.brain.nodes.map((n: { path: string }) => n.path)).not.toContain(PAGE);
    const review = (await h.t.call('GET', '/api/review/week?end=2026-03-08')).json();
    expect(review.notes.items.map((n: { path: string }) => n.path)).not.toContain(PAGE);
    const state = JSON.parse(readFileSync(h.stateFile(), 'utf8'));
    expect(state.spans).toEqual([
      {
        path: PAGE,
        from: new Date(2026, 2, 2, 9, 5).toISOString(),
        to: new Date(2026, 2, 2, 9, 10).toISOString(),
      },
    ]);
    expect(JSON.stringify(state)).not.toContain(path.sep === '\\' ? ':\\' : '/tmp');

    // Her own edit of the plain note the next day counts (one `note_edited` per note and day:
    // on the day of the generator's last write the log cannot tell her edit apart).
    clock.set(new Date(2026, 2, 3, 11, 0));
    const current = await h.t.context.vault.read(PAGE);
    await h.write(PAGE, `${current.content}\nGhi chú của tôi.\n`);
    const edited = await today();
    expect(edited.days.at(-1)).toEqual({ date: '2026-03-03', count: 1 });
    expect(edited.brain.nodes.map((n: { path: string }) => n.path)).toContain(PAGE);
  });

  it('a state file from before spans keeps the page out of the counts (created … last rebuild)', async () => {
    const clock = makeClock(new Date(2026, 2, 2, 9, 0));
    const home = makeTempDir('sb semester spans Học kỳ');
    try {
      const first = await startSemesterHost(47836, { now: clock.now, home });
      await first.write(COURSE, note({ type: 'course' }, '# Giải tích 1\n'));
      await first.service().act('enable');
      await first.rebuild();
      await first.service().act('disable');
      const stateFile = first.stateFile();
      const state = JSON.parse(readFileSync(stateFile, 'utf8'));
      delete state.spans;
      await first.t.close();
      writeFileSync(stateFile, JSON.stringify(state));
      h = await startSemesterHost(47837, { now: clock.now, home });
      const activity = (await h.t.call('GET', '/api/today')).json().activity;
      expect(activity.days.at(-1)).toEqual({ date: '2026-03-02', count: 1 });
      await h.t.close();
      h = null;
    } finally {
      removeDir(home);
    }
  });
});
