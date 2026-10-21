import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openReminderStore } from '../../src/reminders/reminder-store.js';
import type { ReminderEntry } from '../../src/reminders/reminder-types.js';
import { makeClock } from '../index/helpers/index-test-vault.js';
import {
  createMemoryLogger,
  createVaultTestApp,
  type VaultTestApp,
} from '../api/vault-test-app.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';
import {
  at,
  createNote,
  projectNote,
  startReminders,
  storeFile,
} from './helpers/reminder-test-host.js';

/** How many of the next reads (or copies) of reminders.json fail as if another program held it. */
let failingReads = 0;
let failingCopies = 0;
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    copyFile: (async (...args: Parameters<typeof real.copyFile>) => {
      if (failingCopies > 0 && String(args[0]).endsWith('reminders.json')) {
        failingCopies -= 1;
        throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
      }
      return real.copyFile(...args);
    }) as typeof real.copyFile,
    readFile: (async (...args: Parameters<typeof real.readFile>) => {
      if (failingReads > 0 && String(args[0]).endsWith('reminders.json')) {
        failingReads -= 1;
        throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
      }
      return real.readFile(...args);
    }) as typeof real.readFile,
  };
});

function entry(key: string, dismissed: boolean): ReminderEntry {
  return {
    key,
    itemId: `note:1 Projects/${key}.md`,
    path: `1 Projects/${key}.md`,
    title: key,
    due: '2026-10-24',
    threshold: 3,
    firedAt: at(2026, 10, 21, 8).toISOString(),
    missed: false,
    toast: 'shown',
    dismissed,
  };
}

const keysIn = (file: string) =>
  (JSON.parse(readFileSync(file, 'utf8')) as { entries: ReminderEntry[] }).entries.map(
    (e) => e.key,
  );

afterEach(() => {
  failingReads = 0;
  failingCopies = 0;
});

describe('reminders.json that cannot be read right now is never replaced (F17)', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = path.join(makeTempDir('sb nhắc nhở bận'), 'state');
    mkdirSync(dir);
    file = path.join(dir, 'reminders.json');
  });
  afterEach(() => removeDir(path.dirname(dir)));

  it('refuses writes while unreadable, then reads the real entries and keeps them', async () => {
    const recorded = JSON.stringify({
      version: 1,
      entries: [entry('đã tắt', true), entry('đã nhắc', false)],
      superseded: [],
    });
    writeFileSync(file, recorded);
    const logger = createMemoryLogger();
    const clock = makeClock(at(2026, 10, 21, 9));
    failingReads = 3; // at open, at the retry, and at the retry the first update makes
    const store = await openReminderStore({ stateDir: dir, now: clock.now, logger });
    expect(store.has('đã tắt')).toBe(false);
    expect(await store.ensureLoaded()).toBe(false);
    await expect(store.update((d) => d.entries.push(entry('mới', false)))).rejects.toMatchObject({
      code: 'EBUSY',
    });
    expect(readFileSync(file, 'utf8')).toBe(recorded);
    expect(logger.lines.join('\n')).toContain('EBUSY');
    expect(logger.lines.join('\n')).not.toContain('1 Projects');

    // The file can be read again: the change applies on top of what was recorded.
    await store.update((d) => d.entries.push(entry('mới', false)));
    expect(keysIn(file)).toEqual(['đã tắt', 'đã nhắc', 'mới']);
    expect(store.has('đã tắt')).toBe(true);
  });

  it('a damaged file is replaced only after its .corrupt copy exists', async () => {
    writeFileSync(file, '{"version": 1, "entries": [ hỏng');
    const clock = makeClock(at(2026, 10, 21, 9));
    failingCopies = 2; // at open and at the retry the first update makes
    const store = await openReminderStore({
      stateDir: dir,
      now: clock.now,
      logger: createMemoryLogger(),
    });
    await expect(store.update((d) => d.entries.push(entry('mới', false)))).rejects.toMatchObject({
      code: 'EBUSY',
    });
    expect(readFileSync(file, 'utf8')).toBe('{"version": 1, "entries": [ hỏng');
    await store.update((d) => d.entries.push(entry('mới', false)));
    const copies = readdirSync(dir).filter((n) => n.startsWith('reminders.json.corrupt-'));
    expect(copies.map((n) => readFileSync(path.join(dir, n), 'utf8'))).toEqual([
      '{"version": 1, "entries": [ hỏng',
    ]);
    expect(keysIn(file)).toEqual(['mới']);
  });
});

describe('the reminder scheduler waits for an unreadable reminders.json (F17.2)', () => {
  let t: VaultTestApp | undefined;
  afterEach(async () => {
    await t?.close();
    t = undefined;
  });

  it('no toast fires while the file cannot be read, and none repeats once it can', async () => {
    const clock = makeClock(at(2026, 10, 21, 9));
    t = await createVaultTestApp(47602, { now: clock.now, watcher: false });
    const P = '1 Projects/Đồ án Giải tích.md';
    await createNote(t, P, projectNote('2026-10-24'));
    const key = `${t.context.vault.id}|note:${P}|2026-10-24|3`;
    const recorded = JSON.stringify({
      version: 1,
      entries: [{ ...entry('x', true), key, itemId: `note:${P}`, path: P, title: 'Đồ án' }],
      superseded: [],
    });
    writeFileSync(storeFile(t), recorded);

    failingReads = 2; // at start and on the first tick
    const r = await startReminders(t);
    await r.service.runNow();
    expect(r.deliverer.toasts).toEqual([]);
    r.timers.tick();
    await r.service.runNow();
    expect(r.deliverer.toasts).toEqual([]);
    expect(readFileSync(storeFile(t), 'utf8')).toBe(recorded);
    expect(r.logger.lines.some((line) => line.includes('EBUSY'))).toBe(true);

    // Readable again: the dismissed reminder is known and does not fire again.
    r.timers.tick();
    await r.service.runNow();
    expect(r.deliverer.toasts).toEqual([]);
    expect(keysIn(storeFile(t))).toEqual([key]);
  });
});
