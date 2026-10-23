/**
 * The note screen's read-only hook (SPEC F25.2): `path` is the generated "Học kỳ này" page while
 * the page is on. The note is then shown, never edited: editor, title, properties and source
 * mode are read-only, and the banner explains why (the server refuses those writes anyway).
 */
import type { VaultPath } from '../../lib/api/vault-types';
import { samePath } from '../../lib/vault-paths';
import type { SemesterPageStatus } from './semester-api';
import { useSemesterPageStatus } from './semester-page-store';

export function useGeneratedPage(path: VaultPath): SemesterPageStatus | null {
  const status = useSemesterPageStatus();
  return status !== null && status.enabled && samePath(status.path, path) ? status : null;
}
