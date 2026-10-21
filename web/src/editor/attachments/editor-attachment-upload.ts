/**
 * Uploads files dropped or pasted into the editor and inserts each returned link where its
 * placeholder is, as one undo step per file (SPEC F15.1).
 */
import { closeHistory } from '@tiptap/pm/history';
import type { EditorView } from '@tiptap/pm/view';
import type { AttachmentUploadResponse } from '../../lib/api/attachments-types';
import { buildLinkInsertion, wantsOwnLine } from './attachment-link-insert';
import { showLinkNotInserted, uploadAttachments, type UploadDeps } from './attachment-uploads';
import {
  addUploadPlaceholders,
  findUploadPlaceholder,
  markPlaceholderInserted,
  removeUploadPlaceholder,
} from './upload-placeholders';

export function uploadIntoEditor(
  view: EditorView,
  files: readonly File[],
  pos: number,
  deps?: UploadDeps,
): Promise<void> {
  const ownLine = wantsOwnLine(view.state, pos);
  const ids = addUploadPlaceholders(
    view,
    pos,
    files.map((file) => file.name),
    ownLine,
  );
  return uploadAttachments(
    files,
    (_file, index) => {
      const id = ids[index] ?? -1;
      return {
        done: (result) => insertUploadedLink(view, id, result),
        cancel: () => removeUploadPlaceholder(view, id),
      };
    },
    deps,
  );
}

function insertUploadedLink(view: EditorView, id: number, result: AttachmentUploadResponse): void {
  if (view.isDestroyed) {
    showLinkNotInserted(result);
    return;
  }
  const placeholder = findUploadPlaceholder(view.state, id);
  if (!view.editable) {
    removeUploadPlaceholder(view, id);
    showLinkNotInserted(result);
    return;
  }
  // The document was replaced meanwhile (an outside edit reloaded it): use the caret instead.
  const pos = placeholder?.pos ?? view.state.selection.to;
  const ownLine = placeholder?.ownLine ?? wantsOwnLine(view.state, pos);
  const insertion = buildLinkInsertion(view.state, pos, result.link, ownLine);
  if (!insertion) {
    removeUploadPlaceholder(view, id);
    showLinkNotInserted(result);
    return;
  }
  // Its own undo step: neither merged with typing before it nor with the next file or keystroke.
  view.dispatch(closeHistory(markPlaceholderInserted(insertion.tr, id, insertion.after)));
  view.dispatch(closeHistory(view.state.tr));
}
