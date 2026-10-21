// An app server of its own whose AI providers are the local mock (mock-ai-provider.ts), plus the
// settings patches that turn AI on through the API for specs that are not about consent. App on
// port 47698, mock on 47699 (both in the e2e range; specs run one at a time).
import { rmSync } from 'node:fs';
import type { AppApi } from './app-api.js';
import { aiEnv, startMockAiProvider, type MockAiProvider } from './mock-ai-provider.js';
import { makeTempHome, ownServer, type OwnServer } from './own-server.js';

export const AI_APP_PORT = 47698;
export const MOCK_AI_PORT = 47699;
/** Fake keys: printable ASCII ≥ 16 characters (the server's format check), never real. */
export const FAKE_ANTHROPIC_KEY = 'sk-ant-e2e-fake-key-0000-ABCD';
export const FAKE_OPENAI_KEY = 'sk-e2e-openai-fake-key-0000-WXYZ';

export interface AiApp {
  server: OwnServer;
  mock: MockAiProvider;
  dispose(): Promise<void>;
}

export interface AiAppOptions {
  /** Writes files into the fresh home before the server starts (e.g. `.secondbrain/…`). */
  seedHome?: (home: string) => void;
}

export async function startAiApp(options: AiAppOptions = {}): Promise<AiApp> {
  const mock = await startMockAiProvider(MOCK_AI_PORT);
  const home = makeTempHome(`ai ${AI_APP_PORT}`);
  options.seedHome?.(home);
  const server = ownServer(AI_APP_PORT, { env: aiEnv(mock), home });
  const dispose = async () => {
    await server.dispose();
    await mock.close();
    rmSync(home, { recursive: true, force: true });
  };
  try {
    await server.start();
  } catch (error) {
    await dispose();
    throw error;
  }
  return { server, mock, dispose };
}

/** AI on with Anthropic, consent recorded and the fake key saved (what the Settings flow does). */
export async function enableAiByApi(api: AppApi): Promise<void> {
  await api.send('PUT', '/api/settings', {
    ai: { apiKey: { provider: 'anthropic', value: FAKE_ANTHROPIC_KEY } },
  });
  await api.send('PUT', '/api/settings', {
    ai: { provider: 'anthropic', enabled: true, consent: true },
  });
}

/** "Tìm theo nghĩa" on with OpenAI embeddings (separate consent and key). */
export async function enableEmbeddingsByApi(api: AppApi): Promise<void> {
  await api.send('PUT', '/api/settings', {
    ai: { apiKey: { provider: 'openai', value: FAKE_OPENAI_KEY } },
  });
  await api.send('PUT', '/api/settings', {
    ai: { embeddingProvider: 'openai', embeddings: true, embeddingsConsent: true },
  });
}

export interface AiStatusView {
  ready: boolean;
  reason: string | null;
  retrieval: 'bm25' | 'hybrid';
  embeddings: { state: string; done: number; total: number; lastError: string | null };
}

export const aiStatus = (api: AppApi) => api.get<AiStatusView>('/api/ai/status');
