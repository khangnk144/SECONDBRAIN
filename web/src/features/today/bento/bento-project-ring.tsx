import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectSummary } from '../../../lib/api/deadlines-types';
import { useTabsStore } from '../../../lib/tabs-store';
import { noteLinkHandlers } from '../../backlinks/open-note-at-line';
import { dueLabel } from '../../deadline-items/urgency-label';

/** 76 px ring, stroke 8 (design.md §12.3). */
const SIZE = 76;
const STROKE = 8;
const RADIUS = (SIZE - STROKE) / 2 - 4;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const CENTER = SIZE / 2;
/** Ring colours in order: the accent, then the pastels. */
const TONES = 5;

export function progressPercent(progress: { done: number; total: number }): number {
  return Math.round((100 * progress.done) / Math.max(1, progress.total));
}

/**
 * One project of "Đồ án đang làm": a progress ring (`role="img"`, named with title, percentage
 * and "3/5 việc") with the percentage in the middle, the title (opens the note) and the days left;
 * "chưa có việc" in place of the ring when the project has no tasks (F10.5).
 */
export function BentoProjectRing({ project, index }: { project: ProjectSummary; index: number }) {
  const { t } = useTranslation();
  const { progress } = project;
  const percent = progress ? progressPercent(progress) : 0;
  const offset = CIRCUMFERENCE * (1 - percent / 100);
  return (
    <li className="today-ring">
      {progress ? (
        <svg
          className="today-ring__svg"
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          role="img"
          aria-label={t('today.bento.projects.ring', {
            title: project.title,
            percent,
            progress: t('today.projects.progress', { done: progress.done, count: progress.total }),
          })}
        >
          <circle className="today-ring__track" cx={CENTER} cy={CENTER} r={RADIUS} />
          <circle
            className={`today-ring__value today-ring__value--${index % TONES}`}
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            strokeDasharray={CIRCUMFERENCE.toFixed(2)}
            strokeDashoffset={offset.toFixed(2)}
            strokeLinecap={percent > 0 ? 'round' : 'butt'}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
            style={{ '--ring-c': CIRCUMFERENCE.toFixed(2) } as CSSProperties}
          />
          <text className="today-ring__text" x={CENTER} y={CENTER + 5} textAnchor="middle">
            {t('today.projects.percent', { percent })}
          </text>
        </svg>
      ) : (
        <span className="today-ring__none">{t('today.projects.noTasks')}</span>
      )}
      <button
        type="button"
        className="today-ring__title"
        {...noteLinkHandlers((newTab) =>
          useTabsStore.getState().openNote(project.path, { newTab }),
        )}
      >
        {project.title}
      </button>
      <span className="today-ring__due">
        {project.daysLeft === null
          ? t('today.bento.projects.noDeadline')
          : dueLabel(project.daysLeft, t)}
      </span>
    </li>
  );
}
