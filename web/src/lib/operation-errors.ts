/** Turns API failures into the friendly messages of design.md §7 (what happened, what to do). */
import { i18n } from '../i18n';
import { ApiError } from './api-client';
import { MAX_NAME_LENGTH, type NameProblem } from './name-validation';
import { showToast } from './toast-store';

export type OperationSubject = 'note' | 'folder';

export function operationErrorMessage(error: unknown, subject: OperationSubject = 'note'): string {
  if (!(error instanceof ApiError)) {
    // fetch() rejects with a TypeError when the server cannot be reached.
    return i18n.t(
      error instanceof TypeError ? 'operations.errors.offline' : 'operations.errors.generic',
    );
  }
  switch (error.code) {
    case 'EXISTS':
      return i18n.t(
        subject === 'folder' ? 'operations.errors.folderExists' : 'operations.errors.exists',
      );
    case 'INVALID_PATH':
      return i18n.t('operations.errors.invalidPath');
    case 'FORBIDDEN':
      return i18n.t('operations.errors.forbidden');
    case 'WRITE_FAILED':
      return i18n.t('operations.errors.writeFailed');
    case 'CONFLICT':
      return i18n.t('operations.errors.conflict');
    case 'NOT_FOUND':
      return i18n.t(
        subject === 'folder' ? 'operations.errors.folderNotFound' : 'operations.errors.notFound',
      );
    // The "Học kỳ này" page the app writes itself (F25.2): rename/move from the tree is refused.
    case 'GENERATED_PAGE':
      return i18n.t('semester.errors.generatedPage');
    default:
      return i18n.t('operations.errors.generic');
  }
}

export function showOperationError(error: unknown, subject: OperationSubject = 'note'): void {
  showToast({ message: operationErrorMessage(error, subject), tone: 'error' });
}

/** Translated text for a client-side name problem. */
export function nameProblemMessage(problem: NameProblem): string {
  return i18n.t(`operations.invalid.${problem}`, { max: MAX_NAME_LENGTH });
}
