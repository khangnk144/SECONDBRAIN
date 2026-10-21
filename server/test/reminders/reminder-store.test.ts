import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AtomicWriteHooks } from '../../src/fs/atomic-write-file.js';
import { openReminderStore } from '../../src/reminders/reminder-store.js';
import type { ReminderEntry } from '../../src/reminders/reminder-types.js';
import { createMemoryLogger } from '../api/vault-test-app.js';
import { makeClock } from '../index/helpers/index-test-vault.js';
import { makeTempDir, removeDir } from '../helpers/test-environment.js';
import { at } from './helpers/reminder-test-host.js';

let dir: string;
let file: string;
beforeEach(() => {
  dir = path.join(makeTempDir('sb nhắc nhở Đồ án'), 'state');
  mkdirSync(dir);
  file = path.join(dir, 'reminders.json');
});
afterEach(() => removeDir(path.dirname(dir)));

function entry(key: string, firedAt: Date, extra: Partial<ReminderEntry> = {}): ReminderEntry {
  return {
    key,
    itemId: 'note:1 Projects/Đồ án Giải tích.md',
    path: '1 Projects/Đồ án Giải tích.md',
    title: 'Đồ án Giải tích',
    due: '2026-10-24',
    threshold: 3,
    firedAt: firedAt.toISOString(),
    missed: false,
    toast: 'shown',
    dismissed: false,
    ...extra,
  };
}

const open = (now: () => Date, hooks?: AtomicWriteHooks) => {
  const logger = createMemoryLogger();
  return openReminderStore({ stateDir: dir, now, logger, hooks }).then((store) => ({
    store,
    logger,
  }));
};
const onDisk = () => JSON.parse(readFileSync(file, 'utf8'));

describe('reminder dedupe store (state/reminders.json)', () => {
  const clock = makeClock(at(2026, 10, 21, 8));

  it('starts empty without a file and writes version 1 with entries and superseded keys', async () => {
    const { store } = await open(clock.now);
    expect(store.entries()).toEqual([]);
    await store.update((d) => {
      d.entries.push(entry('k3', clock.now()));
      d.superseded.push({ key: 'k-old', recordedAt: clock.now().toISOString() });
    });
    expect(onDisk()).toEqual({
      version: 1,
      entries: [entry('k3', clock.now())],
      superseded: [{ key: 'k-old', recordedAt: clock.now().toISOString() }],
    });
    expect([store.has('k3'), store.has('k-old'), store.has('other')]).toEqual([true, true, false]);
    const reopened = await open(clock.now);
    expect(reopened.store.entries()).toEqual([entry('k3', clock.now())]);
  });

  it.each([
    ['garbage', '{"version": 1, "entries": [ broken'],
    ['an unknown version', JSON.stringify({ version: 2, entries: [] })],
    ['a non-object', '[1, 2, 3]'],
  ])('a store holding %s is kept as a .corrupt copy and starts empty', async (_name, text) => {
    writeFileSync(file, text);
    const { store, logger } = await open(clock.now);
    expect(store.entries()).toEqual([]);
    const copies = readdirSync(dir).filter((n) => n.startsWith('reminders.json.corrupt-'));
    expect(copies).toHaveLength(1);
    expect(readFileSync(path.join(dir, copies[0]!), 'utf8')).toBe(text);
    expect(onDisk()).toEqual({ version: 1, entries: [], superseded: [] });
    expect(logger.lines.join('\n')).not.toContain('broken');
    // Opening again finds a valid file: no second copy.
    await open(clock.now);
    expect(readdirSync(dir).filter((n) => n.includes('.corrupt-'))).toHaveLength(1);
  });

  it('drops malformed or duplicate entries, keeps the rest, and never passes extra fields on', async () => {
    const good = entry('good', clock.now());
    writeFileSync(
      file,
      `\uFEFF${JSON.stringify({
        version: 1,
        entries: [
          { ...good, extra: 'x' },
          { ...good },
          { ...good, key: 'bad-threshold', threshold: 2 },
          { ...good, key: 'bad-date', firedAt: 'yesterday' },
          null,
        ],
      })}`,
    );
    const { store, logger } = await open(clock.now);
    expect(store.entries()).toEqual([good]);
    expect(logger.lines.join('\n')).toContain('4 malformed entries ignored');
  });

  it('prunes entries and superseded keys older than 60 days on the next write', async () => {
    const old = at(2026, 8, 21, 8); // 61 days before
    const recent = at(2026, 8, 23, 8); // 59 days before
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        entries: [entry('old', old), entry('recent', recent)],
        superseded: [
          { key: 's-old', recordedAt: old.toISOString() },
          { key: 's-recent', recordedAt: recent.toISOString() },
        ],
      }),
    );
    const { store } = await open(clock.now);
    expect(store.has('old')).toBe(false);
    expect(store.has('s-old')).toBe(false);
    await store.update(() => undefined);
    expect(onDisk().entries.map((e: ReminderEntry) => e.key)).toEqual(['recent']);
    expect(onDisk().superseded.map((s: { key: string }) => s.key)).toEqual(['s-recent']);
  });

  it('a failed write leaves the old file and the in-memory state untouched', async () => {
    const hooks: AtomicWriteHooks = {};
    const { store } = await open(clock.now, hooks);
    await store.update((d) => d.entries.push(entry('first', clock.now())));
    const before = readFileSync(file, 'utf8');
    hooks.beforeWrite = () => {
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    };
    await expect(store.update((d) => d.entries.push(entry('second', clock.now())))).rejects.toThrow(
      'disk full',
    );
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(store.has('second')).toBe(false);
    expect(readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    hooks.beforeWrite = undefined;
    await store.update((d) => d.entries.push(entry('third', clock.now())));
    expect(store.entries().map((e) => e.key)).toEqual(['first', 'third']);
  });

  it('queued updates never lose each other', async () => {
    const { store } = await open(clock.now);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        store.update((d) => d.entries.push(entry(`k${i}`, clock.now()))),
      ),
    );
    expect(onDisk().entries).toHaveLength(10);
  });

  it('knows a fired task reminder by note, text, date and threshold (its line may move)', async () => {
    const { store } = await open(clock.now);
    const task = entry('t', clock.now(), {
      itemId: 'task:1 Projects/Đồ án Giải tích.md#5',
      title: 'Nộp báo cáo',
      threshold: 1,
    });
    await store.update((d) => d.entries.push(task));
    expect(store.hasTaskTwin(task.path, 'Nộp báo cáo', '2026-10-24', 1)).toBe(true);
    expect(store.hasTaskTwin(task.path, 'Nộp báo cáo'.normalize('NFD'), '2026-10-24', 1)).toBe(
      true,
    );
    expect(store.hasTaskTwin(task.path, 'Nộp báo cáo', '2026-10-24', 0)).toBe(false);
    expect(store.hasTaskTwin(task.path, 'Nộp báo cáo', '2026-10-25', 1)).toBe(false);
  });
});
