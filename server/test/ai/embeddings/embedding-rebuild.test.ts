import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatRequest } from '../../../src/ai/ai-types.js';
import {
  BUDGET_RECHECK_MS,
  QUIET_PERIOD_MS,
} from '../../../src/ai/embeddings/embedding-service.js';
import { waitUntil } from '../../api/vault-test-app.js';
import {
  configureAi,
  createAiTestApp,
  waitForEmbeddings,
  type AiTestApp,
} from '../runtime/ai-test-kit.js';

const PORT = 47733;
const NOTES = 80; // two batches of at most 64 texts

function seed(root: string): void {
  mkdirSync(path.join(root, '2 Areas', 'Môn học'), { recursive: true });
  for (let i = 0; i < NOTES; i += 1)
    writeFileSync(path.join(root, '2 Areas', 'Môn học', `Bài ${i}.md`), `Ma trận số ${i}.\n`);
}

describe('model change, rebuild with progress, budget pause (F33.5)', () => {
  let t: AiTestApp;

  beforeEach(async () => {
    t = await createAiTestApp(PORT, { seed });
    configureAi(t, { embeddings: true, folders: ['2 Areas'] });
    await waitForEmbeddings(t, 'idle', 5000);
  });
  afterEach(async () => t?.close());

  it('the first pass sends batches of at most 64 texts', () => {
    expect(t.recorder.requests.map((r) => r.body.input.length)).toEqual([64, 16]);
    expect(t.runtime().status().embeddings).toMatchObject({ done: NOTES, total: NOTES });
  });

  it('changing the embedding model → stale → full rebuild with progress ending at done = total', async () => {
    t.recorder.requests.length = 0;
    t.statusEvents.length = 0;
    t.settings.ai.embeddingModel = 'text-embedding-3-large';
    t.runtime().settingsChanged?.();
    await waitForEmbeddings(t, 'idle', 5000);
    await t.advance(1_000); // trailing progress events
    const states = t.statusEvents.map((event) => event.state);
    expect(states[0]).toBe('stale');
    expect(states).toContain('running');
    expect(states.at(-1)).toBe('idle');
    const last = t.statusEvents.at(-1)!;
    expect(last).toEqual({ state: 'idle', done: NOTES, total: NOTES });
    const totals = new Set(t.statusEvents.filter((e) => e.state === 'running').map((e) => e.total));
    expect([...totals].every((total) => total === 0 || total === NOTES)).toBe(true);
    expect(t.recorder.requests.every((r) => r.body.model === 'text-embedding-3-large')).toBe(true);
    expect(t.recorder.requests.reduce((sum, r) => sum + r.body.input.length, 0)).toBe(NOTES);
  });

  it('rebuildEmbeddings() re-embeds everything on demand; refused while off', async () => {
    t.recorder.requests.length = 0;
    const res = await t.call('POST', '/api/ai/embeddings/rebuild', {});
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ started: true });
    await waitForEmbeddings(t, 'idle', 5000);
    expect(t.recorder.requests.reduce((sum, r) => sum + r.body.input.length, 0)).toBe(NOTES);
    t.settings.ai.embeddings = false;
    t.runtime().settingsChanged?.();
    expect(t.runtime().rebuildEmbeddings()).toBe(false);
    const off = await t.call('POST', '/api/ai/embeddings/rebuild');
    expect(off.statusCode).toBe(409);
    expect(off.json().error.code).toBe('AI_DISABLED');
  });

  it('budget reached → AI_BUDGET for chat and embeddings, jobs pause, resume next month', async () => {
    // The month is used up (tokens ≥ limit); set directly, below the validator's minimum.
    const used = t.runtime().status().usage.tokens;
    t.settings.ai.monthlyTokenLimit = used;
    t.runtime().settingsChanged?.();
    const chat: ChatRequest = {
      purpose: 'chat',
      system: 's',
      messages: [{ role: 'user', content: 'x' }],
      maxTokens: 10,
    };
    expect(() => t.runtime().stream(chat)).toThrow(expect.objectContaining({ code: 'AI_BUDGET' }));
    expect(() => t.runtime().assertReady('embed')).toThrow(
      expect.objectContaining({ code: 'AI_BUDGET' }),
    );
    expect(t.runtime().embeddings()).toBeNull();
    expect(t.runtime().status()).toMatchObject({
      reason: 'budget',
      usage: { paused: true },
      embeddings: { state: 'off' },
    });
    const first = await t.context.vault.read('2 Areas/Môn học/Bài 0.md');
    await t.context.vault.write(first.path, 'Định thức mới.\n', first.revision);
    await t.context.settled();
    t.recorder.requests.length = 0;
    await t.advance(QUIET_PERIOD_MS + 5 * BUDGET_RECHECK_MS);
    expect(t.recorder.requests).toHaveLength(0);
    // Next local month: the hourly re-check resumes the jobs and embeds the change.
    t.clock.offsetMs = 15 * 24 * 60 * 60_000;
    await t.advance(BUDGET_RECHECK_MS);
    await waitUntil(() => (t.recorder.requests.length === 1 ? true : undefined));
    await waitForEmbeddings(t, 'idle');
    expect(t.recorder.requests[0]!.body.input).toEqual(['Bài 0\n\nĐịnh thức mới.']);
    expect(t.runtime().status().usage).toMatchObject({ month: '2026-11', paused: false });
  });

  it('a batch that would cross the limit holds the jobs until the limit is raised', async () => {
    const used = t.runtime().status().usage.tokens;
    t.settings.ai.monthlyTokenLimit = used + 1; // not reached, but any batch would pass it
    t.runtime().settingsChanged?.();
    const first = await t.context.vault.read('2 Areas/Môn học/Bài 1.md');
    await t.context.vault.write(first.path, 'Trị riêng.\n', first.revision);
    await t.context.settled();
    t.recorder.requests.length = 0;
    await t.advance(QUIET_PERIOD_MS);
    await waitForEmbeddings(t, 'off');
    expect(t.runtime().status().embeddings.lastError).toBe('budget');
    await t.advance(3 * BUDGET_RECHECK_MS);
    expect(t.recorder.requests).toHaveLength(0);
    t.settings.ai.monthlyTokenLimit = used + 100_000;
    t.runtime().settingsChanged?.();
    await waitForEmbeddings(t, 'idle');
    expect(t.recorder.requests).toHaveLength(1);
    expect(t.recorder.requests[0]!.body.input).toEqual(['Bài 1\n\nTrị riêng.']);
  });
});
