import { describe, expect, it } from 'vitest';
import { readBootConfig } from './boot-config';
import { DEFAULT_UI_PREFS, normalizeUiPrefs } from './ui-prefs';

function docWith(token: string, boot: string): Document {
  const doc = document.implementation.createHTMLDocument('t');
  const t = doc.createElement('meta');
  t.setAttribute('name', 'sb-token');
  t.setAttribute('content', token);
  const b = doc.createElement('meta');
  b.setAttribute('name', 'sb-boot');
  b.setAttribute('content', boot);
  doc.head.append(t, b);
  return doc;
}

describe('readBootConfig', () => {
  it('falls back to defaults when the placeholders were not replaced', () => {
    const config = readBootConfig(docWith('__SB_TOKEN__', '__SB_BOOT__'));
    expect(config.token).toBeNull();
    expect(config.ui).toEqual(DEFAULT_UI_PREFS);
  });

  it('falls back to defaults when the meta tags are missing', () => {
    const config = readBootConfig(document.implementation.createHTMLDocument('t'));
    expect(config).toEqual({ token: null, ui: DEFAULT_UI_PREFS });
  });

  it('reads the token and the injected settings', () => {
    const boot = JSON.stringify({
      name: 'Lan Anh',
      language: 'en',
      theme: 'light',
      palette: 'oai-huong',
      fontSize: 18,
    });
    const config = readBootConfig(docWith('tok_123', boot));
    expect(config.token).toBe('tok_123');
    expect(config.ui).toEqual({
      name: 'Lan Anh',
      language: 'en',
      theme: 'light',
      palette: 'oai-huong',
      fontSize: 18,
    });
  });

  it('ignores malformed JSON', () => {
    expect(readBootConfig(docWith('tok', '{not json')).ui).toEqual(DEFAULT_UI_PREFS);
  });
});

describe('normalizeUiPrefs', () => {
  it('replaces each invalid field with its default and keeps valid ones', () => {
    expect(
      normalizeUiPrefs({
        name: '  ',
        language: 'fr',
        theme: 'system',
        palette: 'neon',
        fontSize: 13,
      }),
    ).toEqual({ ...DEFAULT_UI_PREFS, theme: 'system' });
  });

  it('accepts a numeric font size given as a string', () => {
    expect(normalizeUiPrefs({ fontSize: '14' }).fontSize).toBe(14);
  });
});
