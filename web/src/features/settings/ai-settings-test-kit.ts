/**
 * Test helpers for Settings AI and MCP: the server's AI rules for `PUT /api/settings` (consent tied
 * to the provider, model reset on a provider change), `GET /api/ai/status` derived from the same
 * settings, and the MCP config and template upgrade routes.
 */
import type { AiStatus } from '../../lib/api/ai-types';
import type { McpConfig } from '../../lib/api/mcp-types';
import type { SettingsPatch, SettingsResponse } from '../../lib/api/settings-types';
import type { TemplateUpgradeItem } from '../../lib/api/templates-types';
import { apiError, type FetchMock, type MockReply } from '../../lib/testing/fetch-mock';

type Ai = SettingsResponse['ai'];

export const CONSENT_AT = '2026-10-21T09:00:00.000Z';
export const SESSION_TOKEN = 'tok-0123456789abcdef0123456789abwxyz';

const CHAT_DEFAULTS = { anthropic: 'claude-haiku-5-5', openai: 'gpt-5-mini', gemini: 'gemini-x' };
const EMBED_DEFAULTS = { openai: 'text-embedding-3-small', gemini: 'gemini-embedding-001' };

/** Applies the AI part of a patch like the server; a refused patch answers 400 and changes nothing. */
export function applyAiPatch(current: Ai, patch: NonNullable<SettingsPatch['ai']>): Ai | MockReply {
  const { apiKey, consent, embeddingsConsent, ...rest } = patch;
  const next: Ai = structuredClone(current);
  if (rest.provider !== undefined && rest.provider !== next.provider) next.chatModel = null;
  if (rest.embeddingProvider !== undefined && rest.embeddingProvider !== next.embeddingProvider)
    next.embeddingModel = null;
  Object.assign(next, rest);
  if (apiKey) {
    next.keys[apiKey.provider] = apiKey.value
      ? { set: true, last4: `…${apiKey.value.slice(-4)}` }
      : { set: false, last4: null };
  }
  if (consent !== undefined)
    next.consent = consent ? { at: CONSENT_AT, provider: next.provider } : null;
  if (embeddingsConsent !== undefined) {
    next.embeddingsConsent = embeddingsConsent
      ? { at: CONSENT_AT, provider: next.embeddingProvider }
      : null;
  }
  if (rest.enabled === true && next.consent?.provider !== next.provider)
    return apiError(400, 'VALIDATION', { field: 'ai.enabled', reason: 'consent-required' });
  if (rest.embeddings === true && next.embeddingsConsent?.provider !== next.embeddingProvider)
    return apiError(400, 'VALIDATION', { field: 'ai.embeddings', reason: 'consent-required' });
  return next;
}

export interface StatusExtras {
  tokens?: number;
  embeddings?: Partial<AiStatus['embeddings']>;
  available?: boolean;
}

/** `GET /api/ai/status` as the server builds it from these settings. */
export function deriveAiStatus(ai: Ai, extras: StatusExtras = {}): AiStatus {
  const available = extras.available ?? true;
  const tokens = extras.tokens ?? 0;
  const paused = tokens >= ai.monthlyTokenLimit;
  const consented = ai.consent?.provider === ai.provider;
  const hasKey = ai.keys[ai.provider].set;
  const reason =
    !available || !ai.enabled
      ? 'disabled'
      : !consented
        ? 'no-consent'
        : !hasKey
          ? 'no-key'
          : paused
            ? 'budget'
            : null;
  const embeddingsOn = ai.enabled && ai.embeddings;
  return {
    available,
    enabled: available && ai.enabled,
    consented,
    provider: ai.provider,
    hasKey,
    chatModel: ai.chatModel ?? CHAT_DEFAULTS[ai.provider],
    ready: reason === null,
    reason,
    retrieval: 'bm25',
    embeddings: {
      enabled: available && ai.embeddings,
      consented: ai.embeddingsConsent?.provider === ai.embeddingProvider,
      provider: ai.embeddingProvider,
      model: ai.embeddingModel ?? EMBED_DEFAULTS[ai.embeddingProvider],
      hasKey: ai.keys[ai.embeddingProvider].set,
      state: embeddingsOn ? 'idle' : 'off',
      done: 0,
      total: 0,
      pending: 0,
      lastError: null,
      ...extras.embeddings,
    },
    usage: { month: '2026-10', tokens, limit: ai.monthlyTokenLimit, paused },
    scope: available ? ['', '0 Inbox', '1 Projects', '2 Areas'] : [],
  };
}

export function mcpConfig(overrides: Partial<McpConfig> = {}): McpConfig {
  const command = 'C:\\Program Files\\nodejs\\node.exe';
  const args = ['D:\\SECONDBRAIN\\app\\server\\dist\\mcp-stdio.js'];
  const url = 'http://localhost:4747/mcp';
  return {
    stdio: { command, args },
    stdioSnippet: JSON.stringify({ mcpServers: { 'second-brain': { command, args } } }, null, 2),
    http: { url },
    httpSnippet: JSON.stringify(
      {
        mcpServers: {
          'second-brain': {
            type: 'http',
            url,
            headers: { Authorization: `Bearer ${SESSION_TOKEN}` },
          },
        },
      },
      null,
      2,
    ),
    bridgeBuilt: true,
    ...overrides,
  };
}

/** Default answers for the AI status, MCP config and template routes (all quiet). */
export function installAiRoutes(
  mock: FetchMock,
  settings: { current: SettingsResponse },
  extras: () => StatusExtras = () => ({}),
): void {
  mock.on('GET /api/ai/status', () => ({ body: deriveAiStatus(settings.current.ai, extras()) }));
  mock.on('GET /api/mcp/config', { body: mcpConfig() });
  const items: TemplateUpgradeItem[] = [
    { path: 'Templates/Paper.md', state: 'current' },
    { path: 'CLAUDE.md', state: 'current' },
  ];
  mock.on('GET /api/templates/upgrades', { body: { items } });
}
