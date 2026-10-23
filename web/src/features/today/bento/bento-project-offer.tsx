import { useTranslation } from 'react-i18next';
import type { ProjectSummary } from '../../../lib/api/deadlines-types';
import { useMarkProjectDone } from '../use-mark-project-done';

export interface BentoProjectOfferProps {
  project: ProjectSummary;
  onDismiss: () => void;
  onMarkedDone: () => void;
  refresh: () => unknown;
}

/** "“Đồ án X” xong hết việc rồi. Đánh dấu dự án xong?" with "Đánh dấu xong" and "Để sau". */
export function BentoProjectOffer({
  project,
  onDismiss,
  onMarkedDone,
  refresh,
}: BentoProjectOfferProps) {
  const { t } = useTranslation();
  const { busy, markDone } = useMarkProjectDone(project, onMarkedDone, refresh);
  return (
    <div className="today-project-offer">
      <p className="today-project-offer__text">
        {t('today.bento.projects.donePrompt', { title: project.title })}
      </p>
      <div className="today-project-offer__actions">
        <button
          type="button"
          className="button button--secondary"
          aria-disabled={busy}
          onClick={() => void markDone()}
        >
          {t('today.projects.markDone')}
        </button>
        <button type="button" className="button today-project-offer__later" onClick={onDismiss}>
          {t('today.projects.later')}
        </button>
      </div>
    </div>
  );
}
