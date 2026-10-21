/**
 * The `AiRuntime` of one open vault: readiness, chat calls, scope, status and the embedding jobs.
 * Settings are read live on every call (PUT /settings changes them in place).
 */
import type { AppContext } from '../../app-context/create-app-context.js';
import type { GlobalSettings } from '../../config/global-settings.js';
import type { AppLogger } from '../../logging/rotating-file-logger.js';
import type { ServerEvent } from '../../ws/server-events.js';
import type { AiRuntime } from '../ai-types.js';
import type { UsageStore } from '../budget/usage-store.js';
import { createEmbeddingService } from '../embeddings/embedding-service.js';
import type { FetchLike, ProviderTimers } from '../providers/provider-types.js';
import { blockFor, readinessError } from './ai-readiness.js';
import { effectiveScope, listTopFolders, pathInScope } from './ai-scope.js';
import { buildAiStatus, type EmbeddingsSnapshot } from './ai-status.js';
import { completeChat, streamChat, type ChatCallDeps } from './chat-calls.js';

export interface AiRuntimeDeps {
  context: AppContext;
  settings: () => GlobalSettings;
  usage: UsageStore;
  fetch: FetchLike;
  timers: ProviderTimers;
  now: () => Date;
  env: Readonly<Record<string, string | undefined>>;
  logger: AppLogger;
}

export function createAiRuntime(deps: AiRuntimeDeps): AiRuntime {
  const { context, settings, usage, now } = deps;
  const isPaused = () => usage.month(now()).tokens >= settings().ai.monthlyTokenLimit;
  let wasPaused = isPaused();

  const broadcast = (snapshot: EmbeddingsSnapshot) =>
    context.hub.broadcast({
      type: 'ai:status',
      embeddings: { state: snapshot.state, done: snapshot.done, total: snapshot.total },
    });
  const inScope = (path: string) => pathInScope(path, settings().ai.folders);

  /** A request just crossed the monthly limit: clients show the pause at once. */
  const onUsage = () => {
    const pausedNow = isPaused();
    if (pausedNow === wasPaused) return;
    wasPaused = pausedNow;
    embeddings.settingsChanged();
  };

  const embeddings = createEmbeddingService({ ...deps, inScope, onUsage, broadcast });
  const chatDeps: ChatCallDeps = { ...deps, onUsage };
  const unsubscribe = context.onEvent((event: ServerEvent) => embeddings.handleEvent(event));

  return {
    status() {
      return buildAiStatus(
        settings(),
        usage.month(now()),
        embeddings.snapshot(),
        effectiveScope(settings().ai.folders, listTopFolders(context.vault.root)),
      );
    },
    assertReady(purpose) {
      const { ai } = settings();
      const block = blockFor(purpose, ai, isPaused());
      if (block) throw readinessError(block, purpose);
    },
    stream: (request) => streamChat(chatDeps, request),
    complete: (request) => completeChat(chatDeps, request),
    inScope,
    embeddings: () => embeddings.index(),
    rebuildEmbeddings: () => embeddings.rebuild(),
    settingsChanged() {
      wasPaused = isPaused();
      embeddings.settingsChanged();
    },
    async close() {
      unsubscribe();
      await embeddings.close();
      await usage.close();
    },
  };
}
