import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { transferFiles } from '../attachments/attachment-files';
import { uploadIntoEditor } from '../attachments/editor-attachment-upload';
import { createUploadPlaceholderPlugin } from '../attachments/upload-placeholders';

/**
 * Files dropped on the editor or pasted into it (a screenshot, a PDF from Explorer) are uploaded
 * and their links inserted at the drop point or the caret (SPEC F15.1). Drags of text and pastes
 * without files are left to the editor. Runs before the Markdown paste handler.
 */
export const AttachmentDropPaste = Extension.create({
  name: 'attachmentDropPaste',
  priority: 150,

  addProseMirrorPlugins() {
    return [
      createUploadPlaceholderPlugin(),
      new Plugin({
        key: new PluginKey('attachmentDropPaste'),
        props: {
          handleDOMEvents: {
            // A read-only editor still takes the drop, so the browser never opens the file instead.
            dragover: (view, event) => {
              if (view.editable || !hasFiles(event.dataTransfer)) return false;
              event.preventDefault();
              return true;
            },
            drop: (view, event) => {
              const files = transferFiles(event.dataTransfer);
              if (files.length === 0) return false;
              event.preventDefault();
              if (!view.editable) return true;
              const pos = dropPosition(view, event);
              // Focus comes back here after the "Lưu vào" chooser closes.
              view.focus();
              void uploadIntoEditor(view, files, pos);
              return true;
            },
          },
          handlePaste: (view, event) => {
            const files = transferFiles(event.clipboardData);
            if (files.length === 0) return false;
            event.preventDefault();
            if (!view.state.selection.empty) view.dispatch(view.state.tr.deleteSelection());
            void uploadIntoEditor(view, files, view.state.selection.from);
            return true;
          },
        },
      }),
    ];
  },
});

function hasFiles(data: DataTransfer | null): boolean {
  return Array.from(data?.types ?? []).includes('Files');
}

/** The document position under the pointer; the caret when there is none (no layout). */
function dropPosition(view: EditorView, event: DragEvent): number {
  try {
    const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (found) return found.pos;
  } catch {
    // jsdom and detached views have no layout.
  }
  return view.state.selection.from;
}
