/**
 * A real vault host with the AI plugin and the status routes, a recording fetch (never the
 * network), manual timers and a clock that follows them, and every `ai:status` broadcast.
 */
import type { AiRuntime } from '../../../src/ai/ai-types.js';
import { createAiPlugin } from '../../../src/ai/ai-plugin.js';
import { AI_PLUGIN } from '../../../src/app-context/vault-plugins.js';
import type { AiProvider } from '../../../src/config/settings-sections.js';
import type { ServerEvent } from '../../../src/ws/server-events.js';
import type { HubSocket } from '../../../src/ws/websocket-hub.js';
import {
  createMemoryLogger,
  createVaultTestApp,
  waitUntil,
  type VaultTestApp,
} from '../../api/vault-test-app.js';
import {
  jsonResponse,
  ManualTimers,
  recordingFetch,
  TEST_KEYS,
  type RecordedRequest,
  type Responder,
} from '../providers/provider-test-kit.js';

export const BASE_TIME = new Date('2026-10-21T09:00:00').getTime();

export interface AiTestApp extends VaultTestApp {
  runtime(): AiRuntime;
  recorder: ReturnType<typeof recordingFetch>;
  timers: ManualTimers;
  /** Extra milliseconds added to the plugin clock (jump to next month). */
  clock: { offsetMs: number };
  logger: ReturnType<typeof createMemoryLogger>;
  /** Every `ai:status` broadcast, in order. */
  statusEvents: Extract<ServerEvent, { type: 'ai:status' }>['embeddings'][];
  /** Lets timers fire, then waits (real time) until in-flight work settled. */
  advance(ms: number): Promise<void>;
}

/** A WebSocket stand-in that hands every broadcast to `receive`. */
function recordingSocket(receive: (event: ServerEvent) => void): HubSocket {
  return {
    readyState: 1,
    bufferedAmount: 0,
    send: (data: string) => receive(JSON.parse(data) as ServerEvent),
    terminate: () => undefined,
    on: () => undefined,
  };
}

export async function createAiTestApp(
  port: number,
  options: { seed?: (vaultRoot: string) => void; respond?: Responder } = {},
): Promise<AiTestApp> {
  const timers = new ManualTimers();
  const clock = { offsetMs: 0 };
  const now = () => new Date(BASE_TIME + clock.offsetMs + timers.now);
  const recorder = recordingFetch(options.respond ?? conceptEmbeddingResponder);
  const logger = createMemoryLogger();
  const t = await createVaultTestApp(port, {
    seed: options.seed,
    logger,
    // The AI status routes come with the app (registerVaultRoutes).
    plugins: [createAiPlugin({ fetch: recorder.fetch, timers, now, env: {} })],
  });
  const statusEvents: AiTestApp['statusEvents'] = [];
  t.host.hub.add(
    recordingSocket((event) => {
      if (event.type === 'ai:status') statusEvents.push(event.embeddings);
    }),
  );
  return Object.assign(t, {
    runtime: () => t.context.plugin<AiRuntime>(AI_PLUGIN)!,
    recorder,
    timers,
    clock,
    logger,
    statusEvents,
    async advance(ms: number) {
      timers.advance(ms);
      await new Promise((resolve) => setTimeout(resolve, 30));
    },
  });
}

/** Turns AI on with consent and keys (as the settings route would), then tells the runtime. */
export function configureAi(
  t: AiTestApp,
  options: {
    provider?: AiProvider;
    embeddings?: boolean;
    keys?: boolean;
    consent?: boolean;
    embeddingsConsent?: boolean;
    folders?: string[] | null;
    limit?: number;
  } = {},
): void {
  const ai = t.settings.ai;
  ai.provider = options.provider ?? 'anthropic';
  ai.enabled = true;
  ai.embeddings = options.embeddings ?? false;
  ai.embeddingProvider = 'openai';
  const at = new Date(BASE_TIME).toISOString();
  ai.consent = options.consent === false ? null : { at, provider: ai.provider };
  ai.embeddingsConsent =
    options.embeddingsConsent === false ? null : { at, provider: ai.embeddingProvider };
  ai.apiKeys = options.keys === false ? {} : { ...TEST_KEYS };
  if (options.folders !== undefined) ai.folders = options.folders;
  if (options.limit !== undefined) ai.monthlyTokenLimit = options.limit;
  t.runtime().settingsChanged?.();
}

/** Waits until the embedding jobs reach `state` (real time; timers are not advanced). */
export async function waitForEmbeddings(t: AiTestApp, state: string, timeoutMs = 3000) {
  return waitUntil(() => {
    const status = t.runtime().status().embeddings;
    return status.state === state ? status : undefined;
  }, timeoutMs);
}

/** Every text sent to a provider, for "never sent" checks. */
export function sentTexts(requests: readonly RecordedRequest[]): string {
  return requests.map((request) => request.rawBody).join('\n');
}

/**
 * Deterministic "embedding model": one dimension per concept, so related words land close
 * ("ma trận" and "đại số tuyến tính" share a dimension) without any real model.
 */
export const CONCEPTS: readonly string[][] = [
  ['ma trận', 'đại số tuyến tính', 'định thức', 'vector', 'trị riêng'],
  ['xác suất', 'thống kê', 'biến ngẫu nhiên', 'phân phối'],
  ['nấu', 'món', 'công thức', 'bếp'],
  ['lịch sử', 'triều đại', 'chiến tranh'],
  ['bóng đá', 'thể thao', 'trận đấu'],
  ['giải tích', 'đạo hàm', 'tích phân'],
];

export function conceptVector(text: string, dims: number): number[] {
  const folded = text.normalize('NFC').toLowerCase();
  const vector = new Array<number>(dims).fill(0);
  CONCEPTS.forEach((words, i) => {
    for (const word of words) if (folded.includes(word)) vector[i] = (vector[i] ?? 0) + 1;
  });
  vector[dims - 1] = 0.05; // never a zero vector
  return vector;
}

export const conceptEmbeddingResponder: Responder = (request) => {
  const input = (request.body.input as string[] | undefined) ?? [];
  return jsonResponse({
    data: input.map((text, index) => ({
      index,
      embedding: conceptVector(text, request.body.dimensions as number),
    })),
    usage: { prompt_tokens: input.length * 10, total_tokens: input.length * 10 },
  });
};
