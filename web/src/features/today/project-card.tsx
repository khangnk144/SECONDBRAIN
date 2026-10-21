import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { urgencyOf } from '../../editor/local-dates';
import type { ProjectSummary } from '../../lib/api/deadlines-types';
import { useTabsStore } from '../../lib/tabs-store';
import { noteLinkHandlers } from '../backlinks/open-note-at-line';
import { showToast } from '../../lib/toast-store';
import { showUndoToast } from '../../lib/undo-toast';
import { setNoteDone } from '../deadline-items/deadline-actions';
import { dueLabel } from '../deadline-items/urgency-label';

export interface ProjectCardProps {
  project: ProjectSummary;
  /** "Đánh dấu dự án xong?" is still offered for this project. */
  offerDone: boolean;
  onDismissOffer: () => void;
  /** The server confirmed `status: done`. */
  onMarkedDone: () => void;
  refresh: () => unknown;
}

/**
 * One project in progress (the only cards on Today): title (opens the note), days left in the
 * urgency text colour, and progress as a bar with its percentage ("60%"; "3/5 việc" is its value
 * text and tooltip), or "chưa có việc" without tasks (F10.5). When every task is ticked it offers
 * once to mark the project done; "Đánh dấu xong" can be undone from its toast for 10 s.
 */
export function ProjectCard({
  project,
  offerDone,
  onDismissOffer,
  onMarkedDone,
  refresh,
}: ProjectCardProps) {
  const { t } = useTranslation();
  const titleRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const { progress } = project;
  const allDone = progress !== null && progress.total > 0 && progress.done === progress.total;
  const urgency = project.daysLeft === null ? null : urgencyOf(project.daysLeft);
  const progressText = progress ? t('today.projects.progress', progress) : '';
  const percent = progress ? Math.round((100 * progress.done) / Math.max(1, progress.total)) : 0;

  async function markDone() {
    if (busy) return;
    setBusy(true);
    const target = { path: project.path, revision: project.revision, title: project.title };
    const outcome = await setNoteDone(target, true, { refresh });
    setBusy(false);
    if (outcome !== 'done') return;
    onMarkedDone();
    // Undo puts `status: doing` back, checked against the revision our own write left (a note
    // changed elsewhere meanwhile is refused and named, never overwritten).
    showUndoToast(t('today.projects.markedDone', { title: project.title }), async () => {
      if ((await setNoteDone(target, false, { refresh })) === 'done') {
        showToast({ message: t('operations.undone') });
      }
    });
  }

  function later() {
    onDismissOffer();
    titleRef.current?.focus(); // the buttons that held focus disappear
  }

  return (
    <li className="project-card">
      <div className="project-card__head">
        <button
          ref={titleRef}
          type="button"
          className="project-card__title"
          {...noteLinkHandlers((newTab) =>
            useTabsStore.getState().openNote(project.path, { newTab }),
          )}
        >
          {project.title}
        </button>
        {urgency !== null && project.daysLeft !== null ? (
          <span className={`project-card__due project-card__due--${urgency}`}>
            {dueLabel(project.daysLeft, t)}
          </span>
        ) : null}
      </div>
      {progress ? (
        <div className="project-card__progress" title={progressText}>
          <div
            className="project-card__bar"
            role="progressbar"
            aria-label={t('today.projects.progressLabel', { title: project.title })}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
            aria-valuetext={progressText}
          >
            <span className="project-card__fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="project-card__count" aria-hidden="true">
            {t('today.projects.percent', { percent })}
          </span>
        </div>
      ) : (
        <p className="project-card__none">{t('today.projects.noTasks')}</p>
      )}
      {allDone && offerDone ? (
        <div className="project-card__offer">
          <p className="project-card__offer-text">{t('today.projects.donePrompt')}</p>
          <div className="project-card__actions">
            <button
              type="button"
              className="button button--secondary"
              aria-disabled={busy}
              onClick={() => void markDone()}
            >
              {t('today.projects.markDone')}
            </button>
            <button type="button" className="button project-card__later" onClick={later}>
              {t('today.projects.later')}
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
