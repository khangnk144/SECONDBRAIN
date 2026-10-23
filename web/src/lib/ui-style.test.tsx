import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { applyUiPrefs } from './apply-ui-prefs';
import { readBootConfig } from './boot-config';
import { withStyle } from './testing/ui-style-test-kit';
import {
  DEFAULT_STYLE,
  DEFAULT_UI_PREFS,
  PRODUCT_DEFAULT_STYLE,
  defaultStyleForMode,
  normalizeUiPrefs,
} from './ui-prefs';
import { applyUiPrefsLive } from './ui-prefs-live';
import { useUiPrefsStore, useUiStyle } from './ui-prefs-store';

const root = () => document.documentElement;

describe('ui.style on the web (F35.1)', () => {
  it('(F35.1) the product default is bento; unit tests default to calm', () => {
    expect(PRODUCT_DEFAULT_STYLE).toBe('bento');
    expect(defaultStyleForMode('production')).toBe('bento');
    expect(defaultStyleForMode('development')).toBe('bento');
    expect(defaultStyleForMode(undefined)).toBe('bento');
    expect(defaultStyleForMode('test')).toBe('calm');
    expect(DEFAULT_STYLE).toBe('calm');
    expect(DEFAULT_UI_PREFS.style).toBe('calm');
  });

  it('(F35.1) normalizes: bento and calm kept, anything else falls back to the default', () => {
    expect(normalizeUiPrefs({ style: 'bento' }).style).toBe('bento');
    expect(normalizeUiPrefs({ style: 'calm' }).style).toBe('calm');
    expect(normalizeUiPrefs({ style: 'neon' }).style).toBe(DEFAULT_STYLE);
    expect(normalizeUiPrefs({}).style).toBe(DEFAULT_STYLE);
  });

  it('(F35.1) the boot config of the served shell carries the style', () => {
    const doc = document.implementation.createHTMLDocument('x');
    const meta = doc.createElement('meta');
    meta.setAttribute('name', 'sb-boot');
    meta.setAttribute('content', JSON.stringify({ ...DEFAULT_UI_PREFS, style: 'bento' }));
    doc.head.append(meta);
    expect(readBootConfig(doc).ui.style).toBe('bento');
  });

  it('(F35.1) applying prefs sets data-style on <html> at once, like theme and palette', () => {
    applyUiPrefs({ ...DEFAULT_UI_PREFS, style: 'bento' });
    expect(root().dataset.style).toBe('bento');
    applyUiPrefsLive({ ...DEFAULT_UI_PREFS, style: 'calm' });
    expect(root().dataset.style).toBe('calm');
    expect(useUiPrefsStore.getState().prefs.style).toBe('calm');
  });

  it('useUiStyle follows a change without a reload', () => {
    function Probe() {
      return <p>{useUiStyle()}</p>;
    }
    render(<Probe />);
    expect(screen.getByText('calm')).toBeInTheDocument();
    act(() => applyUiPrefsLive({ ...useUiPrefsStore.getState().prefs, style: 'bento' }));
    expect(screen.getByText('bento')).toBeInTheDocument();
  });
});

describe('withStyle test helper', () => {
  it('opts a test into bento and gives back the previous style', () => {
    const restore = withStyle('bento');
    expect(root().dataset.style).toBe('bento');
    expect(useUiPrefsStore.getState().prefs.style).toBe('bento');
    restore();
    expect(useUiPrefsStore.getState().prefs.style).toBe('calm');
    withStyle('bento'); // left on: the setup file resets it after this test
  });

  it('the next test is calm again', () => {
    expect(useUiPrefsStore.getState().prefs.style).toBe('calm');
    expect(root().dataset.style).toBe('calm');
  });
});
