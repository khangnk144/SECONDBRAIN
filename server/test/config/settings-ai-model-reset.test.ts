import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../../src/config/global-settings.js';
import { applySettingsPatch, parseSettingsPatch } from '../../src/config/settings-patch.js';
import { pathInScope } from '../../src/ai/runtime/ai-scope.js';

describe('a model name belongs to one provider (F33)', () => {
  it('switching the chat provider without a model goes back to its default', () => {
    const draft = normalizeSettings({ ai: { provider: 'anthropic', chatModel: 'claude-x' } });
    applySettingsPatch(draft, parseSettingsPatch({ ai: { provider: 'openai' } }));
    expect(draft.ai).toMatchObject({ provider: 'openai', chatModel: null });
  });

  it('a model named in the same patch is kept, and choosing the same provider keeps the model', () => {
    const draft = normalizeSettings({ ai: { provider: 'anthropic', chatModel: 'claude-x' } });
    applySettingsPatch(draft, parseSettingsPatch({ ai: { provider: 'anthropic' } }));
    expect(draft.ai.chatModel).toBe('claude-x');
    applySettingsPatch(draft, parseSettingsPatch({ ai: { provider: 'gemini', chatModel: 'g-1' } }));
    expect(draft.ai).toMatchObject({ provider: 'gemini', chatModel: 'g-1' });
  });

  it('switching the embedding provider resets the embedding model', () => {
    const draft = normalizeSettings({
      ai: { embeddingProvider: 'openai', embeddingModel: 'text-embedding-3-large' },
    });
    applySettingsPatch(draft, parseSettingsPatch({ ai: { embeddingProvider: 'gemini' } }));
    expect(draft.ai).toMatchObject({ embeddingProvider: 'gemini', embeddingModel: null });
  });
});

describe('control docs and the AI scope (F33)', () => {
  it('CLAUDE.md and wiki/log.md are never sent; the wiki catalog is', () => {
    expect(pathInScope('CLAUDE.md', null)).toBe(false);
    expect(pathInScope('wiki/log.md', null)).toBe(false);
    expect(pathInScope('wiki/index.md', null)).toBe(true);
    expect(pathInScope('wiki/concepts/Định lý Bayes.md', null)).toBe(true);
    expect(pathInScope('Ghi chú gốc.md', null)).toBe(true);
  });
});
