import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertWithinBudget, estimateChatTokens } from '../../../src/ai/budget/token-budget.js';
import {
  monthKey,
  openUsageStore,
  USAGE_FILE_NAME,
  USAGE_SAVE_DELAY_MS,
} from '../../../src/ai/budget/usage-store.js';
import { createMemoryLogger } from '../../api/vault-test-app.js';
import { makeTempDir, removeDir } from '../../helpers/test-environment.js';
import { ManualTimers } from '../providers/provider-test-kit.js';

/** Local times (the server tests run in Asia/Ho_Chi_Minh). */
const at = (iso: string) => new Date(iso);

describe('monthly AI usage file (F33.5 cost cap)', () => {
  let dir: string;
  let timers: ManualTimers;
  let clock: Date;
  const logger = createMemoryLogger();
  const file = () => path.join(dir, USAGE_FILE_NAME);
  const stored = () => JSON.parse(readFileSync(file(), 'utf8'));
  const open = () => openUsageStore({ dir, timers, logger, now: () => clock });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  beforeEach(() => {
    dir = path.join(makeTempDir('sb usage Ngân sách'), '.secondbrain');
    mkdirSync(dir);
    timers = new ManualTimers();
    clock = at('2026-10-31T23:30:00');
  });
  afterEach(() => removeDir(path.dirname(dir)));

  it('counts by local calendar month and rolls over at local midnight', async () => {
    const store = await open();
    store.record(1000, clock);
    store.record(500.4, clock);
    expect(store.month(clock)).toEqual({ month: '2026-10', tokens: 1500, requests: 2 });
    const november = at('2026-11-01T00:10:00'); // still October 31 in UTC
    expect(monthKey(november)).toBe('2026-11');
    expect(store.month(november)).toEqual({ month: '2026-11', tokens: 0, requests: 0 });
    store.record(42, november);
    await store.close();
    expect(stored()).toEqual({
      version: 1,
      months: {
        '2026-10': { tokens: 1500, requests: 2 },
        '2026-11': { tokens: 42, requests: 1 },
      },
    });
  });

  it('writes at most 1 s after a change, atomically (no temp files left), and reloads', async () => {
    const store = await open();
    store.record(10, clock);
    store.record(20, clock);
    expect(() => readFileSync(file())).toThrow(); // debounced
    timers.advance(USAGE_SAVE_DELAY_MS);
    await settle();
    expect(stored().months['2026-10']).toEqual({ tokens: 30, requests: 2 });
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    await store.close();
    const again = await open();
    expect(again.month(clock).tokens).toBe(30);
    await again.close();
  });

  it('a corrupt file is kept aside as .corrupt-<ts> and counting starts from zero', async () => {
    writeFileSync(file(), '{"version":1,"months":{"2026-10":{"tokens":"many"}}');
    const store = await open();
    expect(store.month(clock).tokens).toBe(0);
    const copies = readdirSync(dir).filter((name) =>
      name.startsWith(`${USAGE_FILE_NAME}.corrupt-`),
    );
    expect(copies).toHaveLength(1);
    expect(logger.lines.join('\n')).toContain('unreadable');
    store.record(7, clock);
    await store.close();
    expect(stored().months).toEqual({ '2026-10': { tokens: 7, requests: 1 } });
  });

  it('keeps the newest 13 months', async () => {
    const months: Record<string, { tokens: number; requests: number }> = {};
    for (let i = 0; i < 20; i += 1) {
      const date = new Date(2025, i, 15);
      months[monthKey(date)] = { tokens: i, requests: 1 };
    }
    writeFileSync(file(), JSON.stringify({ version: 1, months }));
    const store = await open();
    store.record(1, at('2026-09-15T12:00:00'));
    await store.close();
    const kept = Object.keys(stored().months);
    expect(kept).toHaveLength(13);
    expect(kept[0]).toBe('2025-09'); // September 2026 and the 12 months before it
    expect(kept.at(-1)).toBe('2026-09');
  });

  it('estimates and refuses calls that would cross the limit', () => {
    const estimate = estimateChatTokens({
      purpose: 'chat',
      system: 'x'.repeat(400),
      messages: [{ role: 'user', content: 'y'.repeat(399) }],
      maxTokens: 300,
    });
    expect(estimate).toBe(200 + 300);
    expect(() => assertWithinBudget(9_500, 500, 10_000)).not.toThrow();
    expect(() => assertWithinBudget(9_501, 500, 10_000)).toThrow(
      expect.objectContaining({ code: 'AI_BUDGET' }),
    );
    expect(() => assertWithinBudget(10_000, 0, 10_000)).toThrow(
      expect.objectContaining({ code: 'AI_BUDGET' }),
    );
  });
});
