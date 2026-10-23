/**
 * The semester-page plugin on a real vault test app (vault, index, change router; no watcher):
 * manual timers (a test flushes the debounce or ticks the day check by hand), helpers to edit
 * notes through the vault service and to read the page and its state from disk.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { VaultChange } from '../../src/vault/vault-types.js';
import {
  createSemesterPagePlugin,
  SEMESTER_PLUGIN,
  type PageTimers,
  type SemesterPageService,
} from '../../src/semester/semester-page-plugin.js';
import { SEMESTER_STATE_FILE } from '../../src/semester/semester-page-state.js';
import { createVaultTestApp, type VaultTestApp } from '../api/vault-test-app.js';

export const PAGE = 'Học kỳ này.md';

export interface ManualPageTimers extends PageTimers {
  /** Runs every pending timeout once (the debounce and its max wait). */
  flush(): void;
  /** Runs every interval callback once (as if a minute passed). */
  tick(): void;
  readonly pending: number;
}

export function manualPageTimers(): ManualPageTimers {
  const timeouts = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  let next = 1;
  return {
    setTimeout(callback) {
      timeouts.set(next, callback);
      return next++;
    },
    clearTimeout: (handle) => void timeouts.delete(handle as number),
    setInterval(callback) {
      intervals.set(next, callback);
      return next++;
    },
    clearInterval: (handle) => void intervals.delete(handle as number),
    flush() {
      const due = [...timeouts.entries()];
      timeouts.clear();
      for (const [, callback] of due) callback();
    },
    tick() {
      for (const callback of [...intervals.values()]) callback();
    },
    get pending() {
      return timeouts.size;
    },
  };
}

export interface SemesterHost {
  t: VaultTestApp;
  timers: ManualPageTimers | null;
  service: () => SemesterPageService;
  /** Writes through the vault service (revision-checked) and waits for the index and events. */
  write: (vaultPath: string, content: string) => Promise<void>;
  /** Waits for the change events, runs the debounced rebuild now and waits for it. */
  rebuild: () => Promise<void>;
  /** The page on disk, or null. */
  page: (vaultPath?: string) => string | null;
  /** Writes a file directly on disk (an outside editor). */
  diskWrite: (vaultPath: string, content: string) => void;
  stateFile: () => string;
  /** Changes the app made to `vaultPath` through the vault service. */
  writesTo: (vaultPath: string) => VaultChange[];
}

export async function startSemesterHost(
  port: number,
  options: {
    now?: () => Date;
    seed?: (root: string) => void;
    home?: string;
    /** Real timers with these delays instead of manual ones. */
    realTimers?: { debounceMs?: number; maxWaitMs?: number };
  } = {},
): Promise<SemesterHost> {
  const timers = options.realTimers ? null : manualPageTimers();
  const plugin = createSemesterPagePlugin(timers ? { timers } : { ...options.realTimers });
  const t = await createVaultTestApp(port, {
    now: options.now,
    seed: options.seed,
    home: options.home,
    watcher: false,
    plugins: [plugin],
  });
  const changes: VaultChange[] = [];
  t.context.vault.onChange((change) => changes.push(change));
  const service = () => {
    const running = t.context.plugin<SemesterPageService>(SEMESTER_PLUGIN);
    if (!running) throw new Error('semester plugin not running');
    return running;
  };
  const abs = (p: string) => path.join(t.vaultRoot, ...p.split('/'));
  const settle = async () => {
    await t.context.settled();
    await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    t,
    timers,
    service,
    async write(vaultPath, content) {
      const current = await t.context.vault.read(vaultPath).catch(() => null);
      if (current) await t.context.vault.write(vaultPath, content, current.revision);
      else await t.context.vault.create(vaultPath, content);
      await settle();
    },
    async rebuild() {
      await settle();
      timers?.flush();
      await service().idle();
    },
    page: (vaultPath = PAGE) =>
      existsSync(abs(vaultPath)) ? readFileSync(abs(vaultPath), 'utf8') : null,
    diskWrite(vaultPath, content) {
      mkdirSync(path.dirname(abs(vaultPath)), { recursive: true });
      writeFileSync(abs(vaultPath), content);
    },
    stateFile: () => path.join(t.context.vault.paths.stateDir, SEMESTER_STATE_FILE),
    writesTo: (vaultPath) => changes.filter((change) => change.path === vaultPath),
  };
}

/** Front matter + body, as the app writes notes. */
export const note = (props: Record<string, string>, body = '') =>
  `---\n${Object.entries(props)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')}\n---\n${body}`;

/** The fixture's "today" (a Monday; far from real file mtimes). */
export const FIXTURE_TODAY = '2026-03-02';
const course = (body = '') => note({ type: 'course' }, body);
const lecture = (courseValue: string) => note({ type: 'lecture', course: courseValue });
export const project = (props: Record<string, string>, body = '') =>
  note({ type: 'project', status: 'doing', ...props }, body);

/** Courses, lectures, projects with and without a course; archived, done and template notes. */
export const SEMESTER_FIXTURE: Record<string, string> = {
  '2 Areas/Giải tích 1.md': course('# Giải tích 1\n'),
  '2 Areas/Xác suất thống kê.md': course(),
  '2 Areas/C# cơ bản.md': course(),
  '2 Areas/Giải tích 1/Bài 1.md': lecture('"[[Giải tích 1]]"'),
  '2 Areas/Giải tích 1/Bài 2.md': lecture('Giải tích 1'),
  '2 Areas/Xác suất thống kê/Bài 1.md': lecture('"[[2 Areas/Xác suất thống kê]]"'),
  '4 Archive/Bài cũ.md': lecture('"[[Giải tích 1]]"'),
  '1 Projects/Đồ án Giải tích.md': project(
    { deadline: '2026-03-14', course: '"[[Giải tích 1]]"' },
    '- [x] Một\n- [x] Hai\n- [x] Ba\n- [ ] Bốn\n- [ ] Năm\n',
  ),
  '1 Projects/Giải tích/Báo cáo cuối kỳ.md': project(
    { deadline: FIXTURE_TODAY, course: '"[[Giải tích 1]]"' },
    '- [x] Nộp ✅ 2026-03-01\n',
  ),
  '1 Projects/Xác suất/Báo cáo cuối kỳ.md': project({ course: '"[[Xác suất thống kê]]"' }),
  '1 Projects/Research – Tìm research gap.md': note({
    type: 'research',
    deadline: '2026-02-27',
    course: '"[[Môn không có]]"',
  }),
  '1 Projects/Web bán hàng.md': project({}),
  '1 Projects/Đồ án xong.md': project({ status: 'done', course: '"[[Giải tích 1]]"' }),
  '4 Archive/Đồ án cũ.md': project({ course: '"[[Giải tích 1]]"' }),
  '4 Archive/Môn cũ.md': course(),
  'Templates/Môn học.md': course(),
  '0 Inbox/Ý tưởng.md': '# Ý tưởng\n',
};

/** Writes `files` into a vault folder on disk (the `seed` of the test app). */
export function seedFiles(root: string, files: Record<string, string>): void {
  for (const [vaultPath, content] of Object.entries(files)) {
    const abs = path.join(root, ...vaultPath.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}
