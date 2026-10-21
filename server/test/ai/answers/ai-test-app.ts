/**
 * A real vault host and API (temp home with spaces and Vietnamese letters) with the AI routes
 * and a scripted AI runtime. The routes are added unless the app already serves them (once the
 * lead wires them into the vault routes, the wired ones are used).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { LightMyRequestResponse } from 'fastify';
import { registerAiRoutes } from '../../../src/api/ai-routes.js';
import type { AppContext } from '../../../src/app-context/create-app-context.js';
import type { VaultPlugin } from '../../../src/app-context/vault-plugins.js';
import type { AppLogger } from '../../../src/logging/rotating-file-logger.js';
import { createVaultTestApp, type VaultTestApp } from '../../api/vault-test-app.js';
import { makeClock } from '../../index/helpers/index-test-vault.js';
import { createFakeAiRuntime, fakeAiPlugin, type FakeAiRuntime } from './fake-ai-runtime.js';

/** Monday 19/10/2026, 09:00 in the test time zone: the week is 19/10 – 25/10. */
export const MONDAY = new Date(2026, 9, 19, 9, 0, 0);

export interface AiTestApp {
  t: VaultTestApp;
  runtime: FakeAiRuntime;
  clock: ReturnType<typeof makeClock>;
}

export function writeFiles(root: string, files: Record<string, string>): void {
  for (const [vaultPath, content] of Object.entries(files)) {
    const abs = path.join(root, ...vaultPath.split('/'));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}

export async function createAiTestApp(
  port: number,
  options: {
    files?: Record<string, string>;
    runtime?: FakeAiRuntime;
    now?: Date;
    listen?: boolean;
    plugins?: VaultPlugin[];
    logger?: AppLogger;
  } = {},
): Promise<AiTestApp> {
  const runtime = options.runtime ?? createFakeAiRuntime();
  const clock = makeClock(options.now ?? MONDAY);
  const box: { t?: VaultTestApp } = {};
  // The routes read the context per request; `t` exists by then.
  const context = new Proxy({} as AppContext, {
    get: (_target, key) => {
      const value = Reflect.get(box.t!.context, key) as unknown;
      return typeof value === 'function' ? value.bind(box.t!.context) : value;
    },
  });
  const t = await createVaultTestApp(port, {
    now: clock.now,
    listen: options.listen,
    logger: options.logger,
    plugins: options.plugins ?? [fakeAiPlugin(runtime)],
    seed: (root) => writeFiles(root, options.files ?? {}),
    beforeReady: (app) => {
      if (!app.hasRoute({ method: 'POST', url: '/api/ai/chat' })) {
        registerAiRoutes(app, context, { settings: () => box.t!.settings });
      }
    },
  });
  box.t = t;
  return { t, runtime, clock };
}

export interface SseEvent {
  event: string;
  data: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- test payloads
}

export function parseSse(body: string): SseEvent[] {
  return body
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const lines = block.split('\n');
      const event = lines.find((l) => l.startsWith('event: '))!.slice(7);
      const data = lines.find((l) => l.startsWith('data: '))!.slice(6);
      return { event, data: JSON.parse(data) };
    });
}

export interface ChatReply {
  response: LightMyRequestResponse;
  events: SseEvent[];
  done: SseEvent['data'];
  meta: SseEvent['data'];
  streamed: string;
}

export async function ask(t: VaultTestApp, body: unknown): Promise<ChatReply> {
  const response = await t.call('POST', '/api/ai/chat', body);
  const events = response.headers['content-type']?.toString().startsWith('text/event-stream')
    ? parseSse(response.body)
    : [];
  return {
    response,
    events,
    meta: events.find((e) => e.event === 'meta')?.data,
    done: events.find((e) => e.event === 'done')?.data,
    streamed: events
      .filter((e) => e.event === 'delta')
      .map((e) => e.data.text as string)
      .join(''),
  };
}

/** `- …` lines of an answer (one per listed item). */
export const listLines = (answer: string) => answer.split('\n').filter((l) => l.startsWith('- '));
