import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';
import { makeClock } from '../index/helpers/index-test-vault.js';
import { isManagedPage } from '../../src/semester/generated-page-registry.js';
import {
  FIXTURE_TODAY,
  note,
  PAGE,
  project,
  SEMESTER_FIXTURE,
  seedFiles,
  startSemesterHost,
  type SemesterHost,
} from './semester-test-host.js';

const PROJECT = '1 Projects/Đồ án Giải tích.md';
let h: SemesterHost | null = null;
afterEach(async () => {
  await h?.t.close();
  h = null;
});

const monday = () => makeClock(new Date(2026, 2, 2, 9, 0));
const seedFixture = (root: string) => seedFiles(root, SEMESTER_FIXTURE);

async function enabled(port: number, clock = monday()) {
  h = await startSemesterHost(port, { now: clock.now, seed: seedFixture });
  const result = await h.service().act('enable');
  return { h, clock, result };
}

const trashMetas = (h: SemesterHost) => {
  const dir = h.t.context.vault.paths.trashDir;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).map((id) => ({
    id,
    meta: JSON.parse(readFileSync(path.join(dir, id, 'meta.json'), 'utf8')) as {
      reason: string;
      originalPaths: string[];
    },
  }));
};

describe('semester page plugin (F25.1, F25.3)', () => {
  it('(F25.1) is off by default: an empty vault gets no page and no state file (F1.1)', async () => {
    h = await startSemesterHost(47801, { now: monday().now });
    await h.rebuild();
    const status = await h.service().status();
    expect(status).toMatchObject({ enabled: false, state: 'off', path: PAGE, exists: false });
    expect(h.page()).toBeNull();
    expect(existsSync(h.stateFile())).toBe(false);
    // Edits do nothing while it is off.
    await h.write('2 Areas/Môn.md', note({ type: 'course' }));
    await h.rebuild();
    expect(h.page()).toBeNull();
    expect(existsSync(h.stateFile())).toBe(false);
  });

  it('(F25.1) turning it on creates the page at the vault root with generated: true', async () => {
    const { h, result } = await enabled(47802);
    expect(result.status).toMatchObject({ enabled: true, state: 'ok', path: PAGE, ours: true });
    const page = h.page()!;
    expect(
      page.startsWith(`---\ntype: note\ngenerated: true\ncreated: ${FIXTURE_TODAY}\n---\n`),
    ).toBe(true);
    expect(page).toContain('- [[Đồ án Giải tích]]: hạn 14/03/2026, còn 12 ngày, xong 3/5 việc');
    const state = JSON.parse(readFileSync(h.stateFile(), 'utf8'));
    expect(state).toMatchObject({ enabled: true, path: PAGE, nextRevision: null });
    expect(state.lastRevision).toBe((await h.t.context.vault.read(PAGE)).revision);
    expect(isManagedPage(h.t.context.vault, 'HỌC KỲ NÀY.md'.normalize('NFD'))).toBe(true);
  });

  it('(F25.1) the English UI names it "This semester.md"', async () => {
    h = await startSemesterHost(47803, { now: monday().now, seed: seedFixture });
    h.t.settings.ui.language = 'en';
    const { status } = await h.service().act('enable');
    expect(status.path).toBe('This semester.md');
    expect(h.page('This semester.md')).toContain('## Projects');
  });

  it('(F25.1) regenerates after a relevant change, and never writes bytes that would not change', async () => {
    const { h } = await enabled(47804);
    const writes = () => h.writesTo(PAGE).length;
    expect(writes()).toBe(1);
    const mtime = statSync(path.join(h.t.vaultRoot, PAGE)).mtimeMs;
    // A body edit of a project (same tasks) rebuilds the page but changes no byte: no write.
    await h.write(PROJECT, `${SEMESTER_FIXTURE[PROJECT]}\nGhi chú thêm.\n`);
    await h.rebuild();
    // An unrelated note: nothing to do either.
    await h.write('0 Inbox/Ý tưởng.md', '# Ý tưởng mới\n');
    await h.rebuild();
    expect(writes()).toBe(1);
    expect(statSync(path.join(h.t.vaultRoot, PAGE)).mtimeMs).toBe(mtime);
    // Ticking a task changes the progress.
    await h.write(PROJECT, SEMESTER_FIXTURE[PROJECT]!.replace('- [ ] Bốn', '- [x] Bốn'));
    await h.rebuild();
    expect(writes()).toBe(2);
    expect(h.page()).toContain('xong 4/5 việc');
    // A new note with a course's title makes it ambiguous: the page switches to the path form
    // (and `course: "[[Giải tích 1]]"` links are ambiguous now, so they name no course, §4.4).
    await h.write('0 Inbox/Giải tích 1.md', '# trùng tên\n');
    await h.rebuild();
    expect(h.page()).toContain('- [[2 Areas/Giải tích 1]]: chưa có bài giảng\n');
    expect(h.page()).not.toContain('- [[Giải tích 1]]');
  });

  it('(F25.1) many changes in a row give one rebuild (debounced, with a max wait)', async () => {
    const { h } = await enabled(47805);
    for (let i = 1; i <= 5; i += 1) {
      await h.write(PROJECT, project({ deadline: `2026-03-1${i}`, course: '"[[Giải tích 1]]"' }));
    }
    // One debounce and one max-wait timer, whatever the number of changes.
    expect(h.timers!.pending).toBe(2);
    await h.rebuild();
    expect(h.writesTo(PAGE)).toHaveLength(2);
    expect(h.page()).toContain('hạn 15/03/2026');
  });

  it('(F25.1) with the real timers the page is current within 2 s of a change', async () => {
    const clock = monday();
    h = await startSemesterHost(47806, { now: clock.now, seed: seedFixture, realTimers: {} });
    await h.service().act('enable');
    const started = Date.now();
    await h.write(PROJECT, project({ deadline: '2026-03-20', course: '"[[Giải tích 1]]"' }));
    while (!h.page()!.includes('hạn 20/03/2026')) {
      expect(Date.now() - started).toBeLessThan(2000);
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  });

  it('(F25.1) a new day updates "còn n ngày"', async () => {
    const { h, clock } = await enabled(47807);
    clock.set(new Date(2026, 2, 3, 0, 1));
    h.timers!.tick();
    await h.rebuild();
    expect(h.page()).toContain('hạn 14/03/2026, còn 11 ngày');
  });

  it('(F25.3) a page edited outside the app is never overwritten; "Tạo lại" trashes that copy first', async () => {
    const { h } = await enabled(47808);
    const edited = `${h.page()}\nGhi chú của tôi.\n`;
    h.diskWrite(PAGE, edited);
    await h.write(PROJECT, SEMESTER_FIXTURE[PROJECT]!.replace('- [ ] Bốn', '- [x] Bốn'));
    await h.rebuild();
    expect(h.page()).toBe(edited);
    expect(await h.service().status()).toMatchObject({
      state: 'edited',
      edited: true,
      ours: false,
    });

    const { status } = await h.service().act('regenerate');
    expect(status).toMatchObject({ state: 'ok', edited: false });
    expect(h.page()).toContain('xong 4/5 việc');
    const kept = trashMetas(h).filter((entry) => entry.meta.reason === 'generated-replaced');
    expect(kept).toHaveLength(1);
    expect(kept[0]!.meta.originalPaths).toEqual([PAGE]);
    const copy = path.join(h.t.context.vault.paths.trashDir, kept[0]!.id, 'files', PAGE);
    expect(readFileSync(copy, 'utf8')).toBe(edited);
  });

  it('(F25.3) a file of hers with that name is never replaced when the page is turned on', async () => {
    h = await startSemesterHost(47809, {
      now: monday().now,
      seed: (root) => seedFiles(root, { [PAGE]: '# Ghi chú riêng của tôi\n' }),
    });
    const { status } = await h.service().act('enable');
    // Review M1: her note keeps its name; the page takes the next free one.
    expect(status).toMatchObject({ state: 'ok', ours: true, path: 'Học kỳ này 2.md' });
    expect(h.page()).toBe('# Ghi chú riêng của tôi\n');
    expect(h.page('Học kỳ này 2.md')).toContain('generated: true');
    expect(isManagedPage(h.t.context.vault, PAGE)).toBe(false);
    expect(isManagedPage(h.t.context.vault, 'Học kỳ này 2.md')).toBe(true);
  });

  it('(F25.3) turning it off leaves the file; "Chuyển trang vào thùng rác" moves it to the trash', async () => {
    const { h } = await enabled(47810);
    const page = h.page();
    const off = await h.service().act('disable');
    expect(off.status).toMatchObject({ enabled: false, state: 'off', exists: true, ours: true });
    expect(h.page()).toBe(page);
    expect(isManagedPage(h.t.context.vault, PAGE)).toBe(false);
    // Off: changes no longer touch it.
    await h.write(PROJECT, SEMESTER_FIXTURE[PROJECT]!.replace('- [ ] Bốn', '- [x] Bốn'));
    await h.rebuild();
    expect(h.page()).toBe(page);

    const trashed = await h.service().act('trash');
    expect(trashed.journalId).toEqual(expect.any(String));
    expect(trashed.status).toMatchObject({ exists: false, state: 'off' });
    expect(h.page()).toBeNull();
    expect(trashMetas(h).map((entry) => entry.meta.reason)).toEqual(['user']);
  });

  it('(F25.3) a page she deleted is not brought back by itself; "Tạo lại" creates it', async () => {
    const { h } = await enabled(47811);
    rmSync(path.join(h.t.vaultRoot, PAGE));
    await h.write(PROJECT, SEMESTER_FIXTURE[PROJECT]!.replace('- [ ] Bốn', '- [x] Bốn'));
    await h.rebuild();
    expect(h.page()).toBeNull();
    expect((await h.service().status()).state).toBe('missing');
    await h.service().act('regenerate');
    expect(h.page()).toContain('xong 4/5 việc');
  });

  it('a course rename never relinks the page (its generator rewrites it) and stays undoable', async () => {
    const { h } = await enabled(47812);
    const { vault } = h.t.context;
    const course = await vault.read('2 Areas/Xác suất thống kê.md');
    const preview = await vault.previewRename(
      '2 Areas/Xác suất thống kê.md',
      '2 Areas/Thống kê.md',
      {
        expectedRevision: course.revision,
        relink: true,
      },
    );
    expect(JSON.stringify(preview)).not.toContain(PAGE);
    const renamed = await vault.rename('2 Areas/Xác suất thống kê.md', '2 Areas/Thống kê.md', {
      expectedRevision: course.revision,
      relink: true,
    });
    expect(renamed.affected).not.toContain(PAGE);
    await h.rebuild();
    expect(h.page()).toContain('- [[Thống kê]]: 1 bài giảng');
    await vault.undoJournal(renamed.journalId);
    await h.rebuild();
    expect(h.page()).toContain('- [[Xác suất thống kê]]: 1 bài giảng');
    expect((await h.service().status()).state).toBe('ok');
  });

  it('after a restart the page is still on, and a write the state did not record is adopted', async () => {
    const home = makeTempDir('sb semester restart Học kỳ');
    try {
      const first = await startSemesterHost(47813, { now: monday().now, seed: seedFixture, home });
      await first.service().act('enable');
      const stateFile = first.stateFile();
      const state = JSON.parse(readFileSync(stateFile, 'utf8'));
      // As if the app stopped right after writing the page, before recording its revision.
      const current = await first.t.context.vault.read(PAGE);
      await first.t.context.vault.write(PAGE, `${current.content}\n`, current.revision);
      const written = createHash('sha256')
        .update(readFileSync(path.join(first.t.vaultRoot, PAGE)))
        .digest('hex');
      await first.t.close();
      writeFileSync(stateFile, JSON.stringify({ ...state, nextRevision: written }));

      h = await startSemesterHost(47814, { now: monday().now, home });
      expect(isManagedPage(h.t.context.vault, PAGE)).toBe(true);
      await h.rebuild();
      expect(await h.service().status()).toMatchObject({ enabled: true, state: 'ok' });
      // The extra blank line is gone again: the page is the app's own.
      expect(h.page()!.endsWith('chưa có việc\n')).toBe(true);
      await h.t.close();
      h = null;
    } finally {
      removeDir(home);
    }
  });
});
