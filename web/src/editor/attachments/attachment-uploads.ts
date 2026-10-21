/**
 * The upload flow shared by the editor and source mode (SPEC F15.1): every dropped or pasted file
 * gets a slot (a placeholder where its link will go) in the order given; images upload at once,
 * documents after one "Lưu vào" choice for all of them. Files upload one after another, so the
 * server names same-named files in the order they were given (`image.png`, `image 2.png`).
 */
import { i18n } from '../../i18n';
import { isApiError } from '../../lib/api-client';
import { uploadAttachment } from '../../lib/api/attachments-api';
import type {
  AttachmentTarget,
  AttachmentUploadResponse,
  DocumentTarget,
} from '../../lib/api/attachments-types';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { showToast } from '../../lib/toast-store';
import { isImageFile } from './attachment-files';
import { chooseDocumentTarget } from './document-target-store';

export interface UploadSlot {
  /** The server saved the file: put its link where the slot is. */
  done(result: AttachmentUploadResponse): void;
  /** Nothing goes in (the upload failed or the chooser was cancelled). */
  cancel(): void;
}

export interface UploadDeps {
  upload?: (file: File, target: AttachmentTarget) => Promise<AttachmentUploadResponse>;
  chooseTarget?: (names: string[]) => Promise<DocumentTarget | null>;
}

interface Item {
  file: File;
  slot: UploadSlot;
}

export async function uploadAttachments(
  files: readonly File[],
  openSlot: (file: File, index: number) => UploadSlot,
  deps: UploadDeps = {},
): Promise<void> {
  const upload = deps.upload ?? uploadAttachment;
  const choose = deps.chooseTarget ?? chooseDocumentTarget;
  const items: Item[] = files.map((file, index) => ({ file, slot: openSlot(file, index) }));
  const images = items.filter((item) => isImageFile(item.file));
  const documents = items.filter((item) => !isImageFile(item.file));

  const uploadAll = async (list: Item[], target: AttachmentTarget) => {
    for (const item of list) await uploadOne(item, target, upload);
  };
  const uploadDocuments = async () => {
    if (documents.length === 0) return;
    const target = await choose(documents.map((item) => item.file.name));
    if (target === null) {
      documents.forEach((item) => item.slot.cancel());
      return;
    }
    await uploadAll(documents, target);
  };
  await Promise.all([uploadAll(images, 'auto'), uploadDocuments()]);
}

async function uploadOne(
  item: Item,
  target: AttachmentTarget,
  upload: NonNullable<UploadDeps['upload']>,
): Promise<void> {
  let result: AttachmentUploadResponse;
  try {
    result = await upload(item.file, target);
  } catch (error) {
    item.slot.cancel();
    showToast({ message: uploadErrorMessage(item.file.name, error), tone: 'error' });
    return;
  }
  knowUploadedFile(result);
  item.slot.done(result);
}

/**
 * The new file joins the link targets at once, so its link renders resolved (not as a missing
 * file) before the server's `note:created` refresh arrives.
 */
function knowUploadedFile(result: AttachmentUploadResponse): void {
  const store = useLinkTargetsStore.getState();
  store.scheduleRefresh();
  // Before the first full load there is nothing to add to (that load brings the file too).
  if (store.status !== 'ready' || store.files.some((entry) => entry.path === result.path)) return;
  store.setTargets(store.titles, [...store.files, { path: result.path, name: result.name }]);
}

/** What happened and what to do next (design.md §7). */
export function uploadErrorMessage(name: string, error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 413) return i18n.t('attachments.errors.tooLarge', { name });
    if (error.status === 400) return i18n.t('attachments.errors.invalid', { name });
    return i18n.t('attachments.errors.failed', { name });
  }
  // fetch rejects with a TypeError when the server cannot be reached.
  if (error instanceof TypeError) return i18n.t('attachments.errors.offline', { name });
  return i18n.t('attachments.errors.failed', { name });
}

/** Saved, but the place for its link is gone (note closed, or not editable any more). */
export function showLinkNotInserted(result: AttachmentUploadResponse): void {
  showToast({
    message: i18n.t('attachments.errors.notInserted', { name: result.name, link: result.link }),
    tone: 'error',
  });
}
