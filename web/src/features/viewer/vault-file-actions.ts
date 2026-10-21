/**
 * "Tải về" and "Mở bằng ứng dụng khác" for any vault file. A download is fetched with the token
 * (`download=1`), turned into a Blob and saved through a temporary `<a download>`: the API URL is
 * never navigated to, framed or opened in a window, so nothing from the vault is ever rendered in
 * the app origin (SPEC §4.8, F15.3).
 */
import { i18n } from '../../i18n';
import { isApiError } from '../../lib/api-client';
import { fetchVaultFileBlob, openFileWithOtherApp } from '../../lib/api/files-api';
import type { VaultPath } from '../../lib/api/vault-types';
import { showToast } from '../../lib/toast-store';
import { baseName } from '../../lib/vault-paths';

/** Chrome starts the download from the object URL asynchronously; keep it alive meanwhile. */
const REVOKE_AFTER_MS = 30_000;

/** "Đã tải … về máy" style messages for a failed request, by what went wrong. */
function failureMessage(error: unknown, name: string, otherwise: string): string {
  if (isApiError(error, 'NOT_FOUND')) return i18n.t('viewer.files.missing', { name });
  if (error instanceof TypeError) return i18n.t('viewer.files.offline');
  return i18n.t(otherwise, { name });
}

/** Hands a Blob to the browser's download manager under `name`. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

/** Opens the file with the computer's default app; says so, or what went wrong. */
export async function openWithOtherApp(path: VaultPath): Promise<boolean> {
  const name = baseName(path);
  try {
    await openFileWithOtherApp(path);
    showToast({ message: i18n.t('viewer.files.opening', { name }) });
    return true;
  } catch (error) {
    const executable = isApiError(error, 'VALIDATION') && error.details.reason === 'executable';
    showToast({
      message: executable
        ? i18n.t('viewer.files.executable', { name })
        : failureMessage(error, name, 'viewer.files.openFailed'),
      tone: 'error',
    });
    return false;
  }
}

/**
 * Downloads the file; the toast offers "Mở bằng ứng dụng khác" (images, Office files, HTML…).
 * Resolves false when the download failed (the error toast is shown).
 */
export async function downloadVaultFile(path: VaultPath): Promise<boolean> {
  const name = baseName(path);
  let blob: Blob;
  try {
    blob = await fetchVaultFileBlob(path, { download: true });
  } catch (error) {
    showToast({
      message: failureMessage(error, name, 'viewer.files.downloadFailed'),
      tone: 'error',
    });
    return false;
  }
  saveBlob(blob, name);
  showToast({
    message: i18n.t('viewer.files.downloaded', { name }),
    action: { label: i18n.t('viewer.files.openExternal'), run: () => void openWithOtherApp(path) },
  });
  return true;
}
