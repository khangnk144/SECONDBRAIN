import { Info, Warning } from '@phosphor-icons/react';
import { useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { navigateTo } from '../../lib/app-navigation';
import { showOperationError } from '../../lib/operation-errors';
import { wantsNewTab } from '../backlinks/open-note-at-line';
import type { SemesterPageStatus } from './semester-api';
import { regenerateSemesterPage, SEMESTER_SETTINGS_ROUTE } from './semester-actions';
import './semester.css';

/**
 * Above the generated "Học kỳ này" page (SPEC F25.2, F25.3): it is made by the app, so changes
 * belong in the course and project notes; a link to its switch in Settings. When the file was
 * edited outside the app, the banner says the app stopped updating it and offers "Tạo lại".
 * Same look as the other note banners.
 */
export function GeneratedPageBanner({ status }: { status: SemesterPageStatus }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const edited = status.state === 'edited';
  const Icon = edited ? Warning : Info;

  const openSettings = (event: MouseEvent<HTMLAnchorElement>) => {
    if (wantsNewTab(event) || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateTo(SEMESTER_SETTINGS_ROUTE);
  };
  const regenerate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await regenerateSemesterPage(status);
    } catch (error) {
      showOperationError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="note-banner" data-tone={edited ? 'warning' : 'info'} data-generated-page="">
      <Icon size={18} aria-hidden="true" className="note-banner__icon" />
      <div className="note-banner__content">
        <p>{t(edited ? 'semester.banner.edited' : 'semester.banner.generated')}</p>
        {edited ? (
          <button
            type="button"
            className="button button--secondary"
            aria-disabled={busy || undefined}
            onClick={() => void regenerate()}
          >
            {t('semester.actions.regenerate')}
          </button>
        ) : null}
        <a
          className="generated-page-banner__link"
          href={`#${SEMESTER_SETTINGS_ROUTE}`}
          onClick={openSettings}
        >
          {t('semester.banner.settings')}
        </a>
      </div>
    </div>
  );
}
