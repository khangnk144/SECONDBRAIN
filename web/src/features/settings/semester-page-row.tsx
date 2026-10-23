import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useTabsStore } from '../../lib/tabs-store';
import { noteTitleFromPath } from '../../lib/vault-paths';
import type { SemesterAction, SemesterPageStatus } from '../semester/semester-api';
import { regenerateSemesterPage, trashSemesterPage } from '../semester/semester-actions';
import { useSemesterPageStatus, useSemesterPageStore } from '../semester/semester-page-store';
import { formatGeneratedAt } from '../semester/semester-format';
import '../semester/semester.css';
import { ActionMessage } from './action-message';
import { settingsSaveError } from './settings-errors';
import { useActionStatus } from './use-action-status';

const STATE_ID = 'semester-page-state';
const HINT_ID = 'semester-page-hint';

/** The sentence under the switch, or null when there is nothing to say (off, no file). */
function stateKey(status: SemesterPageStatus): string | null {
  if (!status.enabled) return status.exists && status.ours ? 'semester.state.offKept' : null;
  return `semester.state.${status.state}`;
}

/**
 * "Trang Học kỳ này" (SPEC F25.1–F25.3), last row of Settings → Kho ghi chú: a switch (real
 * checkbox announced as a switch), what the page is, its state, and the actions that fit it –
 * "Mở trang", "Tạo lại" (edited, deleted or not made yet), "Chuyển trang vào thùng rác" (off and
 * still the app's page). `#/settings?focus=semester-page` brings the row into view.
 */
export function SemesterPageRow() {
  const { t, i18n } = useTranslation();
  const status = useSemesterPageStatus();
  const { state, run } = useActionStatus();
  const [wanted, setWanted] = useState<boolean | null>(null);
  const switchRef = useRef<HTMLInputElement>(null);
  const [params] = useSearchParams();
  const focusRequested = params.get('focus') === 'semester-page';
  const shown = status?.available === true;

  // Once, when the row first appears: the switch the banner's "Cài đặt" link points to.
  useEffect(() => {
    if (!focusRequested || !shown) return;
    switchRef.current?.scrollIntoView?.({ block: 'center' });
    switchRef.current?.focus({ preventScroll: true });
  }, [focusRequested, shown]);

  if (!status || !status.available) return null;
  const name = noteTitleFromPath(status.path);
  const key = stateKey(status);
  const notice = status.enabled && status.state !== 'ok';

  const act = (action: SemesterAction) =>
    run(async () => {
      let result;
      if (action === 'regenerate') {
        result = await regenerateSemesterPage(status);
        if (result === null) return null;
      } else if (action === 'trash') {
        // The undo toast says it (and offers "Hoàn tác" for 10 s).
        await trashSemesterPage();
        return null;
      } else {
        result = await useSemesterPageStore.getState().act(action);
      }
      // The page may have a new name now (a note of hers kept the old one, review M1).
      return t(`semester.done.${action}`, { name: noteTitleFromPath(result.status.path) });
    }, settingsSaveError);

  const toggle = async (on: boolean) => {
    setWanted(on);
    await act(on ? 'enable' : 'disable');
    setWanted(null);
  };

  return (
    <div className="settings-field semester-page-row">
      <label className="settings-switch">
        <input
          ref={switchRef}
          type="checkbox"
          role="switch"
          checked={wanted ?? status.enabled}
          aria-describedby={key ? `${HINT_ID} ${STATE_ID}` : HINT_ID}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span>{t('semester.settings.label')}</span>
      </label>
      <p id={HINT_ID} className="settings-field__hint">
        {t('semester.settings.hint', { name })}
      </p>
      {key ? (
        <p id={STATE_ID} className={notice ? 'settings-field__notice' : 'settings-field__hint'}>
          {t(key, {
            name,
            time: status.lastGeneratedAt
              ? formatGeneratedAt(status.lastGeneratedAt, i18n.language)
              : '',
          })}
        </p>
      ) : null}
      <div className="settings-field__control semester-page-row__actions">
        {status.exists ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => useTabsStore.getState().openNote(status.path)}
          >
            {t('semester.actions.open')}
          </button>
        ) : null}
        {status.enabled && status.state !== 'ok' ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void act('regenerate')}
          >
            {t('semester.actions.regenerate')}
          </button>
        ) : null}
        {!status.enabled && status.exists && status.ours ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => void act('trash')}
          >
            {t('semester.actions.trash')}
          </button>
        ) : null}
      </div>
      <ActionMessage state={state} />
    </div>
  );
}
