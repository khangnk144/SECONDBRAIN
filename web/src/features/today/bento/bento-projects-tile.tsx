import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectSummary } from '../../../lib/api/deadlines-types';
import type { VaultPath } from '../../../lib/api/vault-types';
import { useProjectDoneDismissals } from '../project-done-dismissals';
import { useFocusRescue } from '../use-focus-rescue';
import { createCourseProject } from '../use-mark-project-done';
import { BentoProjectOffer } from './bento-project-offer';
import { BentoProjectRing } from './bento-project-ring';
import { useBentoIntro } from './bento-intro';

/** Rings shown before "Xem thêm n đồ án" (design.md §12.3: at most two). */
export const MAX_PROJECT_RINGS = 2;

export interface BentoProjectsTileProps {
  /** Undefined while Today is loading. */
  projects: ProjectSummary[] | undefined;
  onMarkedDone: (path: VaultPath) => void;
  refresh: () => unknown;
}

/**
 * "Đồ án đang làm" (4 columns): up to two progress rings, then "Xem thêm n đồ án" shows the rest
 * in place (focus moves to the first one it revealed). A project whose tasks are all ticked is
 * offered "Đánh dấu dự án xong?" once, as on calm Today. Empty, it invites creating one from the
 * "Course project" template. The rings run to their percentage on the first paint (F35.8).
 */
export function BentoProjectsTile({
  projects: loaded,
  onMarkedDone,
  refresh,
}: BentoProjectsTileProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const creating = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const focusFirstAdded = useRef(false);
  const intro = useBentoIntro('rings', loaded !== undefined);
  const projects = loaded ?? [];
  const { isDismissed, dismiss } = useProjectDoneDismissals();
  useFocusRescue(listRef, () => headingRef.current);
  const shown = expanded ? projects : projects.slice(0, MAX_PROJECT_RINGS);
  const hidden = projects.length - shown.length;
  const offered = shown.find(
    (project) =>
      project.progress !== null &&
      project.progress.total > 0 &&
      project.progress.done === project.progress.total &&
      !isDismissed(project.path),
  );

  // The button that held focus goes away: focus moves to the first ring it revealed.
  useLayoutEffect(() => {
    if (!focusFirstAdded.current) return;
    focusFirstAdded.current = false;
    const ring = listRef.current?.children[MAX_PROJECT_RINGS];
    ring?.querySelector<HTMLElement>('.today-ring__title')?.focus();
  }, [expanded]);

  async function create() {
    if (creating.current) return;
    creating.current = true;
    await createCourseProject(t('today.projects.newTitle'));
    creating.current = false;
  }

  return (
    <section className="tile today-tile today-tile--projects" aria-labelledby={headingId}>
      <h2 id={headingId} ref={headingRef} className="today-tile__title" tabIndex={-1}>
        {t('today.bento.projects.title')}
      </h2>
      {loaded === undefined ? null : projects.length === 0 ? (
        <div className="today-tile__invite">
          <p className="today-tile__empty">{t('today.projects.empty')}</p>
          <button type="button" className="button button--secondary" onClick={() => void create()}>
            {t('today.projects.create')}
          </button>
        </div>
      ) : (
        <ul ref={listRef} className={intro ? 'today-rings is-intro' : 'today-rings'}>
          {shown.map((project, index) => (
            <BentoProjectRing key={project.path} project={project} index={index} />
          ))}
        </ul>
      )}
      {hidden > 0 ? (
        <button
          type="button"
          className="button button--secondary today-tile__more"
          onClick={() => {
            focusFirstAdded.current = true;
            setExpanded(true);
          }}
        >
          {t('today.bento.projects.more', { count: hidden })}
        </button>
      ) : null}
      {offered ? (
        <BentoProjectOffer
          key={offered.path}
          project={offered}
          onDismiss={() => {
            dismiss(offered.path);
            headingRef.current?.focus(); // the buttons that held focus disappear
          }}
          onMarkedDone={() => onMarkedDone(offered.path)}
          refresh={refresh}
        />
      ) : null}
    </section>
  );
}
