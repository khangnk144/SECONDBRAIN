import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetAppState } from '../lib/testing/reset-app-state';
import { showToast, useToastStore } from '../lib/toast-store';
import { startLanguageFollow } from './follow-language';
import { i18n, resources } from './index';
import { retranslateText } from './retranslate-text';

const toEnglish = (text: string) =>
  retranslateText(text, resources.vi.translation, (key, options) =>
    String(i18n.t(key, { ...options, lng: 'en' })),
  );

describe('text already on screen follows a language switch (F19.2)', () => {
  let stop: () => void;
  beforeEach(async () => {
    await resetAppState();
    stop = startLanguageFollow();
  });
  afterEach(async () => {
    stop();
    await i18n.changeLanguage('vi');
  });

  it('finds the translation behind a text, values included, and renders it in the other language', () => {
    expect(toEnglish(i18n.t('commands.rebuildStarted'))).toBe(
      i18n.t('commands.rebuildStarted', { lng: 'en' }),
    );
    const moved = i18n.t('deadline-items.rescheduled', { title: 'Đồ án Xác suất', date: '24/10' });
    expect(toEnglish(moved)).toBe(
      i18n.t('deadline-items.rescheduled', { title: 'Đồ án Xác suất', date: '24/10', lng: 'en' }),
    );
    // Plural forms are chosen again in the new language.
    expect(toEnglish(i18n.t('settings.vault.templatesDone', { count: 1 }))).toBe(
      '1 template was restored.',
    );
    expect(toEnglish(i18n.t('settings.vault.templatesDone', { count: 3 }))).toBe(
      '3 templates were restored.',
    );
    expect(toEnglish('Một câu không có trong bản dịch')).toBeNull();
  });

  it('toasts already shown switch language, the action label too, and keep working', async () => {
    let undone = 0;
    act(() => {
      showToast({ message: i18n.t('journal.completed') });
      showToast({
        message: i18n.t('deadline-items.rescheduled', { title: 'Thuyết trình', date: '25/10' }),
        action: { label: i18n.t('operations.undo'), run: () => void (undone += 1) },
      });
    });
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    const [plain, withAction] = useToastStore.getState().toasts;
    expect(plain?.message).toBe(i18n.t('journal.completed', { lng: 'en' }));
    expect(withAction?.message).toBe(
      i18n.t('deadline-items.rescheduled', { title: 'Thuyết trình', date: '25/10', lng: 'en' }),
    );
    expect(withAction?.action?.label).toBe(i18n.t('operations.undo', { lng: 'en' }));
    await withAction?.action?.run();
    expect(undone).toBe(1);
  });
});
