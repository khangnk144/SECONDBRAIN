import { useTranslation } from 'react-i18next';
import type { SaveState } from './use-setting-save';

/** "Đã lưu" (polite) or the error (assertive) next to the control that saved. */
export function SaveStatus({ state, id }: { state: SaveState; id?: string }) {
  const { t } = useTranslation();
  if (state.kind === 'error') {
    return (
      <p id={id} className="settings-status settings-status--error" role="alert">
        {state.message}
      </p>
    );
  }
  return (
    <span id={id} className="settings-status" role="status">
      {state.kind === 'saved'
        ? t('settings.saved')
        : state.kind === 'saving'
          ? t('settings.saving')
          : ''}
    </span>
  );
}
