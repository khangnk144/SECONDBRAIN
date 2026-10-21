import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectSummary } from '../../lib/api/deadlines-types';
import type { VaultPath } from '../../lib/api/vault-types';
import { createNote } from '../../lib/note-create-operation';
import { ProjectCard } from './project-card';
import { useProjectDoneDismissals } from './project-done-dismissals';
import { useFocusRescue } from './use-focus-rescue';

/** Cards shown before "Xem thêm n đồ án" (the dashboard stays calm; the rest expands inline). */
export const MAX_PROJECT_CARDS = 6;
export const PROJECTS_FOLDER = '1 Projects';
export const COURSE_PROJECT_TEMPLATE = 'Templates/Course project.md';

export interface ProjectsSectionProps {
  projects: ProjectSummary[];
  onMarkedDone: (path: VaultPath) => void;
  refresh: () => unknown;
}

/**
 * "Đồ án đang làm": `type: project`, `status: doing` notes with their progress, six at first,
 * then "Xem thêm n đồ án" shows the rest in place. Empty, it invites creating one from the
 * "Course project" template (the usual new-note flow: opens the note and offers undo).
 */
export function ProjectsSection({ projects, onMarkedDone, refresh }: ProjectsSectionProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const creating = useRef(false);
  const [, setCreatingState] = useState(false);
  const { isDismissed, dismiss } = useProjectDoneDismissals();
  useFocusRescue(listRef, () => headingRef.current);
  const [expanded, setExpanded] = useState(false);
  const focusFirstAdded = useRef(false);
  const shown = expanded ? projects : projects.slice(0, MAX_PROJECT_CARDS);
  const hidden = projects.length - shown.length;

  // The button that held focus goes away: focus moves to the first card it revealed.
  useLayoutEffect(() => {
    if (!focusFirstAdded.current) return;
    focusFirstAdded.current = false;
    const card = listRef.current?.children[MAX_PROJECT_CARDS];
    card?.querySelector<HTMLElement>('.project-card__title')?.focus();
  }, [expanded]);

  function showAll() {
    focusFirstAdded.current = true;
    setExpanded(true);
  }

  async function create() {
    if (creating.current) return;
    creating.current = true;
    setCreatingState(true);
    await createNote({
      folder: PROJECTS_FOLDER,
      template: COURSE_PROJECT_TEMPLATE,
      title: t('today.projects.newTitle'),
    });
    creating.current = false;
    setCreatingState(false);
  }

  return (
    <section className="today__section today__projects" aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} className="today__section-title" tabIndex={-1}>
        {t('today.projects.title')}
      </h2>
      {projects.length === 0 ? (
        <div className="today__invite">
          <p className="today__empty">{t('today.projects.empty')}</p>
          <button type="button" className="button button--secondary" onClick={() => void create()}>
            {t('today.projects.create')}
          </button>
        </div>
      ) : (
        <ul ref={listRef} className="project-cards">
          {shown.map((project) => (
            <ProjectCard
              key={project.path}
              project={project}
              offerDone={!isDismissed(project.path)}
              onDismissOffer={() => dismiss(project.path)}
              onMarkedDone={() => onMarkedDone(project.path)}
              refresh={refresh}
            />
          ))}
        </ul>
      )}
      {hidden > 0 ? (
        <button
          type="button"
          className="button button--secondary today__show-more"
          onClick={showAll}
        >
          {t('today.projects.showMore', { count: hidden })}
        </button>
      ) : null}
    </section>
  );
}
