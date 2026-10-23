import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProjectSummary } from '../../lib/api/deadlines-types';
import { createNote } from '../../lib/note-create-operation';
import { showToast } from '../../lib/toast-store';
import { showUndoToast } from '../../lib/undo-toast';
import { setNoteDone } from '../deadline-items/deadline-actions';

export const PROJECTS_FOLDER = '1 Projects';
export const COURSE_PROJECT_TEMPLATE = 'Templates/Course project.md';

/**
 * "Đánh dấu xong" for a project whose tasks are all ticked (SPEC §4.7: offered once, never
 * automatic), shared by the calm card and the Bento ring: sets `status: done`; the toast's undo
 * (10 s) puts `status: doing` back, checked against the revision our own write left, so a note
 * changed elsewhere meanwhile is refused and named, never overwritten.
 */
export function useMarkProjectDone(
  project: ProjectSummary,
  onMarkedDone: () => void,
  refresh: () => unknown,
): { busy: boolean; markDone: () => Promise<void> } {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function markDone() {
    if (busy) return;
    setBusy(true);
    const target = { path: project.path, revision: project.revision, title: project.title };
    const outcome = await setNoteDone(target, true, { refresh });
    setBusy(false);
    if (outcome !== 'done') return;
    onMarkedDone();
    showUndoToast(t('today.projects.markedDone', { title: project.title }), async () => {
      if ((await setNoteDone(target, false, { refresh })) === 'done') {
        showToast({ message: t('operations.undone') });
      }
    });
  }

  return { busy, markDone };
}

/** "Chưa có đồ án nào…" → "Tạo": the usual new-note flow from the "Course project" template. */
export function createCourseProject(title: string): Promise<unknown> {
  return createNote({ folder: PROJECTS_FOLDER, template: COURSE_PROJECT_TEMPLATE, title });
}
