import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../../src/config/global-settings.js';
import { applySettingsPatch, parseSettingsPatch } from '../../src/config/settings-patch.js';
import {
  hasChatConsent,
  hasEmbeddingsConsent,
  mcpSettingsOf,
  normalizeAi,
} from '../../src/config/settings-sections.js';

describe('AI and MCP settings sections (F18, F33)', () => {
  it('fills defaults and keeps unknown keys', () => {
    const ai = normalizeAi({ future: { x: 1 }, provider: 'openai' });
    expect(ai).toMatchObject({
      future: { x: 1 },
      provider: 'openai',
      consent: null,
      embeddingsConsent: null,
      embeddingProvider: 'openai',
      monthlyTokenLimit: 2_000_000,
      enabled: false,
      embeddings: false,
    });
    expect(mcpSettingsOf({ mcp: { allowNoteEdits: true, later: 'kept' } })).toEqual({
      allowNoteEdits: true,
      later: 'kept',
    });
    expect(mcpSettingsOf({})).toEqual({ allowNoteEdits: false });
    expect(mcpSettingsOf({ mcp: { allowNoteEdits: 'yes' } }).allowNoteEdits).toBe(false);
  });

  it('drops invalid consents, providers and limits written by hand', () => {
    const ai = normalizeAi({
      consent: { at: 'not a date', provider: 'anthropic' },
      embeddingsConsent: { at: '2026-10-21T00:00:00.000Z', provider: 'anthropic' },
      embeddingProvider: 'anthropic',
      monthlyTokenLimit: 5,
    });
    expect(ai.consent).toBeNull();
    expect(ai.embeddingsConsent).toBeNull(); // Anthropic has no embeddings
    expect(ai.embeddingProvider).toBe('openai');
    expect(ai.monthlyTokenLimit).toBe(2_000_000);
    const kept = normalizeAi({
      consent: { at: '2026-10-21T00:00:00.000Z', provider: 'gemini', extra: 1 },
      monthlyTokenLimit: 10_000,
    });
    expect(kept.consent).toEqual({ at: '2026-10-21T00:00:00.000Z', provider: 'gemini' });
    expect(kept.monthlyTokenLimit).toBe(10_000);
  });

  it('a consent counts only for the provider chosen now', () => {
    const ai = normalizeAi({
      provider: 'anthropic',
      consent: { at: '2026-10-21T00:00:00.000Z', provider: 'anthropic' },
      embeddingProvider: 'gemini',
      embeddingsConsent: { at: '2026-10-21T00:00:00.000Z', provider: 'openai' },
    });
    expect(hasChatConsent(ai)).toBe(true);
    expect(hasEmbeddingsConsent(ai)).toBe(false);
    ai.provider = 'openai';
    expect(hasChatConsent(ai)).toBe(false);
  });

  it('a patch records consent for the provider after the patch; root folder allowed', () => {
    const draft = normalizeSettings({});
    const now = new Date('2026-10-21T01:00:00.000Z');
    applySettingsPatch(
      draft,
      parseSettingsPatch({
        ai: { provider: 'openai', consent: true, enabled: true, folders: [' ', '2 Areas/'] },
        mcp: { allowNoteEdits: true },
      }),
      now,
    );
    expect(draft.ai).toMatchObject({
      provider: 'openai',
      enabled: true,
      consent: { at: '2026-10-21T01:00:00.000Z', provider: 'openai' },
      folders: ['', '2 Areas'],
    });
    expect(draft.mcp).toEqual({ allowNoteEdits: true });
    expect(() =>
      applySettingsPatch(draft, parseSettingsPatch({ ai: { provider: 'gemini', enabled: true } })),
    ).toThrow(
      expect.objectContaining({ details: { field: 'ai.enabled', reason: 'consent-required' } }),
    );
  });
});
