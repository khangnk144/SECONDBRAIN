/**
 * Sources plugin on a real vault test app (temp home with spaces and Vietnamese letters), plus a
 * scriptable fake PDF extractor that counts its calls. The fake reads a "PDF" as UTF-8 text with
 * pages separated by form feeds, so tests can write PDFs as plain strings.
 */
import { SOURCES_PLUGIN } from '../../../src/app-context/vault-plugins.js';
import type { PdfExtraction } from '../../../src/sources/pdf-text-extraction.js';
import type { PdfExtractor } from '../../../src/sources/pdf-worker-extractor.js';
import {
  createSourcesPlugin,
  type SourcesPluginOptions,
  type SourcesPluginService,
} from '../../../src/sources/sources-plugin.js';
import type { ServerEvent } from '../../../src/ws/server-events.js';
import { createVaultTestApp, type VaultTestApp } from '../../api/vault-test-app.js';

export interface FakeExtractor extends PdfExtractor {
  calls: number;
  resets: number;
  /** `hang` = never answers until reset (timeout tests); `crash` = rejects like a dead worker. */
  mode: 'text' | 'hang' | 'crash';
}

export function fakeExtractor(): FakeExtractor {
  let abandon: ((error: Error) => void) | null = null;
  const fake: FakeExtractor = {
    calls: 0,
    resets: 0,
    mode: 'text',
    extract(bytes, limits) {
      fake.calls += 1;
      if (fake.mode === 'hang') return new Promise((_, reject) => (abandon = reject));
      if (fake.mode === 'crash') return Promise.reject(new Error('worker died'));
      const pages = Buffer.from(bytes).toString('utf8').split('\f');
      const result: PdfExtraction = {
        kind: 'ok',
        pages: pages.slice(0, limits.maxPages).map((page) => page.slice(0, limits.maxPageChars)),
        title: null,
        truncated: pages.length > limits.maxPages,
      };
      return Promise.resolve(result);
    },
    async reset() {
      fake.resets += 1;
      abandon?.(new Error('reset'));
      abandon = null;
    },
    async close() {
      await fake.reset();
    },
  };
  return fake;
}

export interface SourcesTestApp extends VaultTestApp {
  sources: SourcesPluginService;
  events: ServerEvent[];
}

/** Collects every event broadcast to WebSocket clients. */
export function captureHubEvents(t: VaultTestApp): ServerEvent[] {
  const events: ServerEvent[] = [];
  t.context.hub.add({
    readyState: 1,
    bufferedAmount: 0,
    send: (data) => events.push(JSON.parse(data) as ServerEvent),
    terminate: () => undefined,
    on: () => undefined,
  });
  return events;
}

export async function createSourcesTestApp(
  port: number,
  options: SourcesPluginOptions & {
    seed?: (vaultRoot: string) => void;
    home?: string;
    plugin?: boolean;
  } = {},
): Promise<SourcesTestApp> {
  const { seed, home, plugin = true, ...pluginOptions } = options;
  const t = await createVaultTestApp(port, {
    seed,
    home,
    plugins: plugin ? [createSourcesPlugin({ debounceMs: 30, ...pluginOptions })] : [],
  });
  const sources = t.context.plugin<SourcesPluginService>(SOURCES_PLUGIN);
  if (plugin && !sources) throw new Error('The sources plugin did not start.');
  return Object.assign(t, { sources: sources!, events: captureHubEvents(t) });
}

/** Polls `check` until it returns a truthy value (background work, debounced events). */
export async function waitFor<T>(check: () => T | Promise<T>, timeoutMs = 10_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > until) throw new Error('Timed out waiting for a condition.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

export const pdfOf = (...pages: string[]) => Buffer.from(pages.join('\f'), 'utf8');
