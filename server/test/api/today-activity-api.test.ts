import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { IndexEvent } from '../../src/index/event-log.js';
import { makeClock } from '../index/helpers/index-test-vault.js';
import { createMemoryLogger, createVaultTestApp, type VaultTestApp } from './vault-test-app.js';

// March 2026, far from the real mtimes of the files a test run writes (the activity service
// counts file mtimes for days before the first `note_edited`), so only the events count.
const clock = makeClock(new Date(2026, 1, 25, 10, 0));
const PORT = 47811;
const A = '2 Areas/Giải tích 1.md';
const B = '1 Projects/Đồ án Giải tích.md';
const C = 'wiki/Ma trận.md';
const D = '0 Inbox/Ý tưởng.md';
const D2 = '2 Areas/Ý tưởng hay.md';
const SECRET = 'nội dung bí mật';

let t: VaultTestApp | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

async function start(logger = createMemoryLogger()) {
  t = await createVaultTestApp(PORT, { now: clock.now, watcher: false, logger });
  return { app: t, logger };
}

/** Writes like an outside editor at `when` (local time) and tells the index. */
async function put(app: VaultTestApp, when: Date, vaultPath: string, content: string) {
  clock.set(when);
  const file = path.join(app.vaultRoot, ...vaultPath.split('/'));
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  await app.context.index.updateFile(vaultPath);
}

async function today(app: VaultTestApp) {
  const response = await app.call('GET', '/api/today');
  expect(response.statusCode).toBe(200);
  return response.json();
}

function events(app: VaultTestApp): IndexEvent[] {
  return readFileSync(app.context.vault.paths.eventsFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as IndexEvent)
    .filter((event) => !event.approx);
}

function ingestManifest(app: VaultTestApp, id: string, runs: [string, Date, string[]][]) {
  const dir = app.context.vault.paths.ingestDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, `${id}.json`),
    JSON.stringify({
      version: 1,
      sourceId: id,
      path: `3 Resources/papers/${id}.pdf`,
      runs: runs.map(([status, finished, outputs], i) => ({
        runId: `${id}.${i}`,
        contentHash: 'h',
        startedAt: finished.toISOString(),
        finishedAt: finished.toISOString(),
        status,
        outputs,
        logLine: null,
        reason: null,
      })),
    }),
  );
}

/** A week of use ending Monday 2 March 2026. */
async function seedWeek(app: VaultTestApp) {
  await put(app, new Date(2026, 1, 25, 10, 0), A, `# Giải tích 1\n${SECRET}\n`);
  await put(
    app,
    new Date(2026, 1, 28, 9, 0),
    B,
    '- [x] Nộp bài ✅ 2026-03-01\n- [x] Đọc chương 3 ✅ 2026-03-01\n- [ ] Viết báo cáo 📅 2026-03-03\n- [x] Việc cũ ✅ 2026-02-27\n',
  );
  await put(app, new Date(2026, 2, 1, 21, 0), A, `# Giải tích 1\n${SECRET}, sửa.\n`);
  await put(
    app,
    new Date(2026, 2, 1, 23, 59),
    B,
    '- [x] Nộp bài ✅ 2026-03-01\n- [x] Đọc chương 3 ✅ 2026-03-01\n- [ ] Viết báo cáo 📅 2026-03-03\n- [x] Việc cũ ✅ 2026-02-27\nThêm.\n',
  );
  // Monday: a new wiki page with three links, an edit adding a link, a created-then-renamed
  // note, a created-then-deleted note and a template (not counted).
  await put(
    app,
    new Date(2026, 2, 2, 0, 0),
    C,
    '[[Giải tích 1]] [[Đồ án Giải tích]] [[Chưa có]]\n',
  );
  await put(app, new Date(2026, 2, 2, 8, 0), A, `# Giải tích 1\n${SECRET}, [[Đồ án Giải tích]].\n`);
  await put(app, new Date(2026, 2, 2, 8, 10), D, 'ý tưởng\n');
  const root = app.vaultRoot;
  mkdirSync(path.join(root, '2 Areas'), { recursive: true });
  renameSync(
    path.join(root, '0 Inbox', 'Ý tưởng.md'),
    path.join(root, '2 Areas', 'Ý tưởng hay.md'),
  );
  clock.set(new Date(2026, 2, 2, 8, 20));
  await app.context.index.renameFile(D, D2);
  await put(app, new Date(2026, 2, 2, 8, 30), '0 Inbox/Xoá.md', 'tạm\n');
  rmSync(path.join(root, '0 Inbox', 'Xoá.md'));
  await app.context.index.removeFile('0 Inbox/Xoá.md');
  await put(app, new Date(2026, 2, 2, 8, 40), 'Templates/Mẫu.md', '- [ ] Việc mẫu\n');
  ingestManifest(app, 'bai-bao-a', [
    ['succeeded', new Date(2026, 2, 1, 23, 0), ['wiki/Cũ.md']],
    ['succeeded', new Date(2026, 2, 2, 8, 50), [C, 'wiki/Khái niệm.md']],
    ['failed', new Date(2026, 2, 2, 8, 55), ['wiki/Hỏng.md']],
  ]);
  clock.set(new Date(2026, 2, 2, 9, 0));
}

describe('GET /api/today activity (F35.9, F24.4)', () => {
  it('(F35.9)(F24.4) counts equal a scan of the fixture events; only titles and paths leave the server', async () => {
    const { app } = await start();
    await seedWeek(app);
    const body = await today(app);
    expect(body.date).toBe('2026-03-02');
    const { activity } = body;
    expect(activity.days).toEqual([
      { date: '2026-02-24', count: 0 },
      { date: '2026-02-25', count: 1 },
      { date: '2026-02-26', count: 0 },
      { date: '2026-02-27', count: 0 },
      { date: '2026-02-28', count: 1 },
      { date: '2026-03-01', count: 2 },
      // Her edit of A and her new note D2; the AI's wiki page C counts only as "AI cập nhật" (L3).
      { date: '2026-03-02', count: 2 },
    ]);
    expect(activity.doneYesterday).toBe(2);
    expect(activity.brain).toMatchObject({
      notesNew: 1,
      notesTouched: 2,
      linksAdded: 1,
      aiTouched: 2,
    });

    // The same numbers straight from events.jsonl (today's lines, the rename followed; her
    // notes only: no template, no deleted note, no wiki page).
    const todays = events(app).filter((e) => e.ts >= new Date(2026, 2, 2).toISOString());
    const alive = (p: string) => (p === D ? D2 : p);
    const counted = (p: string) =>
      !p.startsWith('Templates/') && !p.startsWith('wiki/') && p !== '0 Inbox/Xoá.md';
    const touched = new Set(
      todays
        .filter((e) => e.event === 'note_created' || e.event === 'note_edited')
        .map((e) => alive(e.path))
        .filter(counted),
    );
    expect(activity.brain.notesTouched).toBe(touched.size);
    const pairs = new Set(
      todays
        .filter((e) => e.event === 'link_added' && counted(e.path))
        .map((e) => `${e.path}>${e.target}`),
    );
    expect(activity.brain.linksAdded).toBe(pairs.size);

    // The wiki page is on the map as an AI-touched page (after her edited note on equal links).
    expect(activity.brain.nodes).toEqual([
      { path: A, title: 'Giải tích 1', group: 'areas' },
      { path: C, title: 'Ma trận', group: 'wiki' },
      { path: B, title: 'Đồ án Giải tích', group: 'projects' },
      { path: D2, title: 'Ý tưởng hay', group: 'areas' },
    ]);
    expect(activity.brain.edges).toEqual([
      { from: A, to: B },
      { from: C, to: B },
      { from: C, to: A },
    ]);
    expect(JSON.stringify(activity)).not.toMatch(/bí mật|Việc mẫu|Viết báo cáo/);
    expect(Object.keys(activity.brain.nodes[0]).sort()).toEqual(['group', 'path', 'title']);
  });

  it('(F35.9) midnight moves the week and "yesterday" without any file change (Sunday → Monday)', async () => {
    const { app } = await start();
    await seedWeek(app);
    clock.set(new Date(2026, 2, 1, 23, 59, 30)); // Sunday, before Monday's changes are "now"
    const sunday = (await today(app)).activity;
    expect(sunday.days.map((d: { date: string }) => d.date)).toEqual([
      '2026-02-23',
      '2026-02-24',
      '2026-02-25',
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ]);
    expect(sunday.days.at(-1).count).toBe(2);
    expect(sunday.doneYesterday).toBe(0); // nothing was ticked on Saturday
    expect(sunday.brain).toMatchObject({ notesNew: 0, notesTouched: 2, aiTouched: 1 });

    clock.set(new Date(2026, 2, 2, 0, 0));
    const monday = (await today(app)).activity;
    expect(monday.days.at(-1)).toEqual({ date: '2026-03-02', count: 2 });
    expect(monday.days.at(-2)).toEqual({ date: '2026-03-01', count: 2 });
    expect(monday.doneYesterday).toBe(2);
  });

  it('(F35.9) the next request after a change counts it (cached facts follow the log and the notes)', async () => {
    const { app } = await start();
    await seedWeek(app);
    const before = (await today(app)).activity;
    expect((await today(app)).activity).toEqual(before);
    await put(app, new Date(2026, 2, 2, 9, 30), '0 Inbox/Mới tinh.md', 'mới\n');
    const after = (await today(app)).activity;
    expect(after.days.at(-1).count).toBe(before.days.at(-1).count + 1);
    expect(after.brain.notesNew).toBe(before.brain.notesNew + 1);
    expect(after.brain.nodes.map((n: { path: string }) => n.path)).toContain('0 Inbox/Mới tinh.md');
  });

  it('activity it cannot read is null; the deadlines are still answered and the reason is logged', async () => {
    const { app, logger } = await start();
    await put(app, new Date(2026, 2, 2, 8, 0), B, '- [ ] Viết báo cáo 📅 2026-03-03\n');
    const ingest = app.context.vault.paths.ingestDir;
    rmSync(ingest, { recursive: true, force: true });
    writeFileSync(ingest, 'not a folder');
    const body = await today(app);
    expect(body.activity).toBeNull();
    expect(body.strip.days[1].items.map((i: { title: string }) => i.title)).toEqual([
      'Viết báo cáo',
    ]);
    expect(logger.lines.join('\n')).toMatch(/Today activity unavailable \(ENOTDIR\)/);
  });
});
