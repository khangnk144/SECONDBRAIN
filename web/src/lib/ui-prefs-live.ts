/**
 * Applies UI preferences in this window without a reload (SPEC F18.1): the <html> attributes the
 * CSS reads (theme, palette, font size, language), the prefs store (Today's greeting name) and
 * the i18next language, whose `languageChanged` re-renders every translated component.
 */
import { i18n } from '../i18n';
import { applyUiPrefs } from './apply-ui-prefs';
import { normalizeUiPrefs, type UiPrefs } from './ui-prefs';
import { useUiPrefsStore } from './ui-prefs-store';

export function applyUiPrefsLive(next: UiPrefs, doc: Document = document): void {
  const prefs = normalizeUiPrefs(next);
  applyUiPrefs(prefs, doc);
  useUiPrefsStore.getState().setPrefs(prefs);
  if (i18n.isInitialized && i18n.language !== prefs.language) {
    void i18n.changeLanguage(prefs.language);
  }
}

/** The prefs this window shows now with `change` merged in. */
export function withUiChange(change: Partial<UiPrefs>): UiPrefs {
  return { ...useUiPrefsStore.getState().prefs, ...change };
}
