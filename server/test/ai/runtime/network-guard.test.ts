import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatRequest } from '../../../src/ai/ai-types.js';
import { configureAi, createAiTestApp, type AiTestApp } from './ai-test-kit.js';

const PORT = 47731;
const HOUR = 60 * 60_000;
const request: ChatRequest = {
  purpose: 'chat',
  system: 's',
  messages: [{ role: 'user', content: 'Tuần này có gì?' }],
  maxTokens: 50,
};

/** Every runtime entry point (chat ones only when chat must refuse too); all must refuse. */
async function exerciseRuntime(t: AiTestApp, chatToo: boolean): Promise<void> {
  const runtime = t.runtime();
  expect(() => runtime.assertReady('embed')).toThrow();
  expect(runtime.embeddings()).toBeNull();
  expect(runtime.rebuildEmbeddings()).toBe(false);
  if (!chatToo) return;
  expect(() => runtime.assertReady('chat')).toThrow();
  expect(() => runtime.stream(request)).toThrow();
  await expect(runtime.complete(request)).rejects.toBeTruthy();
}

describe('no network without AI on, consent and a key (F33.3)', () => {
  let t: AiTestApp;
  let n = 0;

  beforeAll(async () => {
    t = await createAiTestApp(PORT, {
      seed: (root) => {
        mkdirSync(path.join(root, '1 Projects'), { recursive: true });
        writeFileSync(
          path.join(root, '1 Projects', 'Đại số tuyến tính.md'),
          '# Ma trận\n\nĐịnh thức.\n',
        );
      },
    });
  });
  afterAll(async () => t?.close());

  const scenarios: [string, (t: AiTestApp) => void, boolean][] = [
    ['AI off (defaults)', () => undefined, true],
    [
      'AI off, embeddings flag on, keys stored',
      (app) => {
        configureAi(app, { embeddings: true });
        app.settings.ai.enabled = false;
        app.runtime().settingsChanged?.();
      },
      true,
    ],
    ['AI on without a key', (app) => configureAi(app, { embeddings: true, keys: false }), true],
    [
      'AI on without consent',
      (app) => configureAi(app, { embeddings: true, consent: false, embeddingsConsent: false }),
      true,
    ],
    // Chat may run here; the embedding jobs and queries must still send nothing.
    [
      'AI on, chat consent, embeddings without their consent',
      (app) => configureAi(app, { embeddings: true, embeddingsConsent: false }),
      false,
    ],
    [
      'consent given for another provider',
      (app) => {
        configureAi(app, { embeddings: true });
        app.settings.ai.provider = 'openai';
        app.settings.ai.embeddingProvider = 'gemini';
        app.runtime().settingsChanged?.();
      },
      true,
    ],
  ];

  it.each(scenarios)(
    '%s: runtime, jobs (hours of timers) and status route never fetch',
    async (_name, setup, chatToo) => {
      setup(t);
      await exerciseRuntime(t, chatToo);
      // Notes created and edited many times; timers run for hours (quiet periods, retries).
      n += 1;
      const created = await t.context.vault.create(`0 Inbox/Ghi chú ${n}.md`, '# Ma trận\n');
      let revision = created.revision;
      for (let i = 0; i < 5; i += 1) {
        revision = (await t.context.vault.write(created.path, `# Ma trận ${i}\n`, revision))
          .revision;
        await t.context.settled();
        await t.advance(60_000);
      }
      await t.advance(6 * HOUR);
      const res = await t.call('GET', '/api/ai/status');
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        ready: !chatToo,
        retrieval: 'bm25',
        embeddings: { state: 'off' },
      });
      expect(t.runtime().status().retrieval).toBe('bm25');
      expect(t.runtime().embeddings()).toBeNull();
      const rebuild = await t.call('POST', '/api/ai/embeddings/rebuild');
      expect([409, 429]).toContain(rebuild.statusCode);
      expect(t.recorder.requests).toEqual([]);
    },
  );
});
