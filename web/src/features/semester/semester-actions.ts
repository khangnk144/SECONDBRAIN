/**
 * "Tạo lại" and "Chuyển trang vào thùng rác" (SPEC F25.3), shared by Settings and the note
 * banner. "Tạo lại" over an edited page asks first (that copy goes to the trash); moving the page
 * to the trash offers the usual 10 s undo.
 */
import { i18n } from '../../i18n';
import { confirmDialog } from '../../lib/dialogs/dialog-requests';
import { SETTINGS_ROUTE } from '../../lib/app-navigation';
import { withQuery } from '../../lib/api/query-string';
import { expectRecreate } from '../../lib/tabs-sync';
import { showJournalUndoToast } from '../../lib/undo-toast';
import type { SemesterActionResult, SemesterPageStatus } from './semester-api';
import { useSemesterPageStore } from './semester-page-store';

/** Settings with the "Trang Học kỳ này" row brought into view. */
export const SEMESTER_SETTINGS_ROUTE = withQuery(SETTINGS_ROUTE, { focus: 'semester-page' });

/** Null when she cancelled. */
export async function regenerateSemesterPage(
  status: SemesterPageStatus,
): Promise<SemesterActionResult | null> {
  if (status.state === 'edited') {
    const confirmed = await confirmDialog({
      title: i18n.t('semester.confirm.title'),
      body: i18n.t('semester.confirm.body'),
      confirmLabel: i18n.t('semester.actions.regenerate'),
      cancelLabel: i18n.t('semester.confirm.cancel'),
    });
    if (!confirmed) return null;
    // The edited copy goes to the trash and a fresh page takes its path: an open tab of the
    // page stays and shows the fresh page (E2E D2), instead of closing on the deletion.
    expectRecreate(status.path);
  }
  return useSemesterPageStore.getState().act('regenerate');
}

export async function trashSemesterPage(): Promise<SemesterActionResult> {
  const result = await useSemesterPageStore.getState().act('trash');
  if (result.journalId) {
    showJournalUndoToast(i18n.t('semester.settings.trashed'), result.journalId);
  }
  return result;
}
