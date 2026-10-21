import type { DragEvent } from 'react';
import { transferFiles } from '../../editor/attachments/attachment-files';
import { uploadIntoEditor } from '../../editor/attachments/editor-attachment-upload';
import type { MarkdownEditorHandle } from '../../editor/markdown-editor';

/**
 * Drops on the note screen outside the text (the title, the property bar, the margins): the
 * browser would open the file in place of the app, so the drop is taken and the files go to the
 * end of the note. Drops the editor or the source field already took are left alone.
 */
export function noteScreenDropHandlers(
  getHandle: () => MarkdownEditorHandle | null,
  inSource: boolean,
) {
  return {
    onDragOver: (event: DragEvent) => {
      if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
    },
    onDrop: (event: DragEvent) => {
      if (event.defaultPrevented) return;
      const files = transferFiles(event.dataTransfer);
      if (files.length === 0) return;
      event.preventDefault();
      const view = getHandle()?.editor?.view;
      if (!view || inSource || !view.editable) return;
      void uploadIntoEditor(view, files, view.state.doc.content.size);
    },
  };
}
