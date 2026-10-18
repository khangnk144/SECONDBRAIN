import { describe, expect, it, vi } from 'vitest';
import { applyUiPrefs, resolveTheme } from './apply-ui-prefs';
import { DEFAULT_UI_PREFS } from './ui-prefs';

function fakeWindow(prefersLight: boolean): Window {
  return {
    matchMedia: vi.fn(() => ({ matches: prefersLight })),
  } as unknown as Window;
}

describe('applyUiPrefs', () => {
  it('writes theme, palette, font size and language on <html>', () => {
    applyUiPrefs({
      ...DEFAULT_UI_PREFS,
      theme: 'light',
      palette: 'hoa-dao',
      fontSize: 18,
      language: 'en',
    });
    const root = document.documentElement;
    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.palette).toBe('hoa-dao');
    expect(root.dataset.fontSize).toBe('18');
    expect(root.lang).toBe('en');
  });

  it('defaults to the dark theme', () => {
    applyUiPrefs(DEFAULT_UI_PREFS);
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});

describe('resolveTheme', () => {
  it('follows the OS for the system preference', () => {
    expect(resolveTheme('system', fakeWindow(true))).toBe('light');
    expect(resolveTheme('system', fakeWindow(false))).toBe('dark');
  });

  it('passes explicit themes through', () => {
    expect(resolveTheme('dark', fakeWindow(true))).toBe('dark');
    expect(resolveTheme('light', fakeWindow(false))).toBe('light');
  });
});
