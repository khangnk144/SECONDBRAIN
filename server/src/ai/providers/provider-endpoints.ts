import type { AiProvider } from '../ai-types.js';

const PUBLIC_BASE_URLS: Readonly<Record<AiProvider, string>> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
  gemini: 'https://generativelanguage.googleapis.com',
};

/**
 * Environment overrides of the base URLs. The end-to-end tests point them at a local mock server
 * (e.g. `SB_AI_OPENAI_URL=http://127.0.0.1:47799`), so the real app code path runs without the
 * internet. Unset or not an http(s) URL → the public endpoint.
 */
export const PROVIDER_URL_ENV: Readonly<Record<AiProvider, string>> = {
  anthropic: 'SB_AI_ANTHROPIC_URL',
  openai: 'SB_AI_OPENAI_URL',
  gemini: 'SB_AI_GEMINI_URL',
};

export function providerBaseUrl(
  provider: AiProvider,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const override = env[PROVIDER_URL_ENV[provider]]?.trim();
  if (override && /^https?:\/\/[^\s]+$/i.test(override)) return override.replace(/\/+$/, '');
  return PUBLIC_BASE_URLS[provider];
}
