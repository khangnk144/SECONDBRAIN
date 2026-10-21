import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDays } from '../../src/lib/local-date.js';
import {
  FIXTURE_FILES,
  QUIET_FILES,
  visibleItems,
} from '../index/helpers/content-class-expectations.js';
import { makeClock } from '../index/helpers/index-test-vault.js';
import { createVaultTestApp, type VaultTestApp } from '../api/vault-test-app.js';
import {
  at,
  readStore,
  startReminders,
  type StartedReminders,
} from './helpers/reminder-test-host.js';

describe('only user notes are reminded: templates, archive, wiki and sources never (F17.1, F9.4)', () => {
  const clock = makeClock(at(2026, 10, 12, 7, 0));
  let t: VaultTestApp;
  let r: StartedReminders;

  beforeAll(async () => {
    t = await createVaultTestApp(47622, {
      now: clock.now,
      watcher: false,
      seed: (root) => {
        for (const [p, bytes] of Object.entries(FIXTURE_FILES)) {
          mkdirSync(path.dirname(path.join(root, ...p.split('/'))), { recursive: true });
          writeFileSync(path.join(root, ...p.split('/')), bytes);
        }
      },
    });
    r = await startReminders(t);
    // Every day at 08:00 and 20:00 for three weeks covers every threshold of every fixture date.
    for (let day = 0; day < 24; day += 1) {
      const date = addDays('2026-10-12', day).split('-').map(Number) as [number, number, number];
      for (const hour of [8, 20]) {
        clock.set(at(date[0], date[1], date[2], hour));
        await r.service.runNow();
      }
    }
  });
  afterAll(async () => t?.close());

  it('every recorded key belongs to an open item of a user note', () => {
    const store = readStore(t);
    const open = new Set(
      visibleItems(false)
        .filter((row) => !row.done)
        .map((row) => row.id),
    );
    const itemOf = (key: string) => key.split('|')[1]!;
    const recorded = [...store.entries.map((e) => e.key), ...store.superseded.map((s) => s.key)];
    expect(recorded.length).toBeGreaterThan(0);
    for (const key of recorded) expect(open.has(itemOf(key)), key).toBe(true);
    for (const quiet of QUIET_FILES)
      expect(store.entries.some((e) => e.path === quiet)).toBe(false);
    expect(store.entries.some((e) => e.path.startsWith('4 Archive/'))).toBe(false);
  });

  it('each open item due inside the sweep got its reminders, in order, none twice', () => {
    const entries = readStore(t).entries;
    expect(new Set(entries.map((e) => e.key)).size).toBe(entries.length);
    const report = '1 Projects/Đồ án Giải tích.md';
    const thresholds = entries
      .filter((e) => e.path === report && e.itemId === 'note:' + report)
      .map((e) => [e.due, e.threshold]);
    expect(thresholds).toEqual([
      ['2026-11-02', 3],
      ['2026-11-02', 1],
      ['2026-11-02', 0],
    ]);
  });
});
