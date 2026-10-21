/**
 * The in-app AI plugin (SPEC F33, route B): one `AiRuntime` per open vault, the only module that
 * talks to AI providers. Start it last (after sources, reminders, history) so the index is ready.
 */
import { AI_PLUGIN, type VaultPlugin, type VaultPluginHost } from '../app-context/vault-plugins.js';
import type { AiRuntime } from './ai-types.js';
import { openUsageStore } from './budget/usage-store.js';
import type { FetchLike, ProviderTimers } from './providers/provider-types.js';
import { createAiRuntime } from './runtime/ai-runtime.js';
import { defaultAiTimers } from './runtime/ai-timers.js';

export interface AiPluginOptions {
  /** HTTP client for the providers; default: the global `fetch`. Tests pass a recording fake. */
  fetch?: FetchLike;
  /** Wall clock (budget month, consent times); default: the context's clock. */
  now?: () => Date;
  /** Quiet-period, retry, timeout and save timers; default: real (unref'd) timers. */
  timers?: ProviderTimers;
  /** Where `ai-usage.json` lives; default: the host's `<home>/.secondbrain`. */
  globalStateDir?: string;
  /** Environment for the provider URL overrides (`SB_AI_*_URL`); default: `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
}

async function startAi(host: VaultPluginHost, options: AiPluginOptions): Promise<AiRuntime> {
  const dir = options.globalStateDir ?? host.globalStateDir;
  if (!dir) throw new Error('The AI plugin needs the global state folder.');
  const now = options.now ?? host.context.now;
  const timers = options.timers ?? defaultAiTimers;
  const usage = await openUsageStore({ dir, timers, logger: host.logger, now });
  return createAiRuntime({
    context: host.context,
    settings: host.settings,
    usage,
    fetch: options.fetch ?? ((url, init) => fetch(url, init)),
    timers,
    now,
    env: options.env ?? process.env,
    logger: host.logger,
  });
}

export function createAiPlugin(options: AiPluginOptions = {}): VaultPlugin<AiRuntime> {
  return { name: AI_PLUGIN, start: (host) => startAi(host, options) };
}
