import type { Editor } from '@tiptap/core';
import { i18n } from '../../i18n';
import { isApiError } from '../../lib/api-client';
import { postNote } from '../../lib/api/notes-api';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { showOperationError } from '../../lib/operation-errors';
import { acceptName } from '../../lib/operation-result';
import { useTabsStore } from '../../lib/tabs-store';
import { showToast } from '../../lib/toast-store';
import { useTreeStore } from '../../lib/tree-store';
import { INBOX_FOLDER, joinPath } from '../../lib/vault-paths';
import { dismissTrigger } from './trigger-replace';

/**
 * "Tạo '<text>'" in the `[[` popup: links to `<text>` and creates `0 Inbox/<text>.md` in the
 * background (the caret stays in this note); a toast offers to open it. A name that cannot be a
 * file name gets the usual friendly message and nothing is inserted.
 */
export function createLinkedNote(
  title: string,
  insertLink: (target: string) => void,
  editor: Editor,
): void {
  const name = acceptName(title);
  if (name === null) {
    dismissTrigger(editor);
    return;
  }
  insertLink(name);
  postNote({ path: joinPath(INBOX_FOLDER, `${name}.md`), title: name }).then(
    (created) => {
      useLinkTargetsStore.getState().scheduleRefresh();
      useTreeStore.getState().scheduleRefresh();
      showToast({
        message: i18n.t('editor.wikilink.created', { title: name }),
        action: {
          label: i18n.t('editor.wikilink.open'),
          run: () => useTabsStore.getState().openNote(created.path),
        },
      });
    },
    (error: unknown) => {
      // A note of that name appeared meanwhile: the link already points to it.
      if (!isApiError(error, 'EXISTS')) showOperationError(error);
    },
  );
}
