/**
 * Toasts keep the text they were shown with; when the language changes they are re-rendered in
 * the new one (message and action label), so nothing on screen stays in the old language.
 */
import { useToastStore } from '../lib/toast-store';
import { i18n, resources } from './index';
import { retranslateText, type Lang } from './retranslate-text';

function asLang(language: string | undefined): Lang | null {
  return language === 'vi' || language === 'en' ? language : null;
}

function retranslateToasts(from: Lang, to: Lang): void {
  const tree = resources[from].translation;
  const t = (key: string, options: Record<string, unknown>) =>
    String(i18n.t(key, { ...options, lng: to }));
  const { toasts } = useToastStore.getState();
  let changed = false;
  const next = toasts.map((toast) => {
    const message = retranslateText(toast.message, tree, t) ?? toast.message;
    const label = toast.action ? (retranslateText(toast.action.label, tree, t) ?? null) : null;
    if (message === toast.message && (label === null || label === toast.action?.label)) {
      return toast;
    }
    changed = true;
    return {
      ...toast,
      message,
      action: toast.action && label !== null ? { ...toast.action, label } : toast.action,
    };
  });
  if (changed) useToastStore.setState({ toasts: next });
}

/** Starts following language changes; returns the stop function. */
export function startLanguageFollow(): () => void {
  let current = asLang(i18n.language);
  const onChange = (language: string) => {
    const next = asLang(language);
    if (current && next && current !== next) retranslateToasts(current, next);
    current = next;
  };
  i18n.on('languageChanged', onChange);
  return () => i18n.off('languageChanged', onChange);
}
