/**
 * "Đang tải lên <tên>…" markers where dropped or pasted files will land. They are widget
 * decorations (never part of the document, so they are never saved); their positions follow
 * edits. Files of one drop share a position and keep their order: a link inserted for one file
 * pushes the later files of its batch after it, while the earlier ones stay before it.
 */
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { i18n } from '../../i18n';

export interface UploadPlaceholder {
  id: number;
  pos: number;
  name: string;
  batch: number;
  order: number;
  /** Dropped on an empty line or between blocks: the link gets its own paragraph. */
  ownLine: boolean;
}

type PlaceholderMeta =
  | { type: 'add'; placeholders: UploadPlaceholder[] }
  | { type: 'remove'; id: number }
  /** The link for `id` was inserted; later files of its batch go to `after`. */
  | { type: 'inserted'; id: number; after: number };

export const uploadPlaceholderKey = new PluginKey<UploadPlaceholder[]>('uploadPlaceholders');

let nextId = 1;
let nextBatch = 1;

export function createUploadPlaceholderPlugin(): Plugin<UploadPlaceholder[]> {
  return new Plugin<UploadPlaceholder[]>({
    key: uploadPlaceholderKey,
    state: {
      init: () => [],
      apply: (tr, list) => applyMeta(tr, list),
    },
    props: {
      decorations: (state) => {
        const list = uploadPlaceholderKey.getState(state) ?? [];
        if (list.length === 0) return DecorationSet.empty;
        return DecorationSet.create(
          state.doc,
          list.map((placeholder) =>
            Decoration.widget(placeholder.pos, () => placeholderElement(placeholder), {
              key: `upload-${placeholder.id}`,
              // Negative: text typed or inserted at the same spot goes after the marker; the
              // order keeps the files of one drop in the order they were given.
              side: placeholder.order - 10_000,
              ignoreSelection: true,
            }),
          ),
        );
      },
    },
  });
}

function applyMeta(tr: Transaction, list: UploadPlaceholder[]): UploadPlaceholder[] {
  const meta = tr.getMeta(uploadPlaceholderKey) as PlaceholderMeta | undefined;
  let next = list;
  if (tr.docChanged) {
    const inserted =
      meta?.type === 'inserted' ? list.find((item) => item.id === meta.id) : undefined;
    next = list.map((item) => {
      const follows =
        inserted &&
        meta?.type === 'inserted' &&
        item.batch === inserted.batch &&
        item.order > inserted.order &&
        item.pos === inserted.pos;
      return { ...item, pos: follows ? meta.after : tr.mapping.map(item.pos, -1) };
    });
  }
  if (meta?.type === 'add') next = [...next, ...meta.placeholders];
  if (meta?.type === 'remove' || meta?.type === 'inserted') {
    next = next.filter((item) => item.id !== meta.id);
  }
  return next;
}

function placeholderElement(placeholder: UploadPlaceholder): HTMLElement {
  const element = document.createElement('span');
  element.className = 'upload-placeholder';
  element.contentEditable = 'false';
  element.setAttribute('role', 'status');
  element.textContent = i18n.t('attachments.uploading', { name: placeholder.name });
  return element;
}

/** Adds one marker per file at `pos`, in order; returns their ids. */
export function addUploadPlaceholders(
  view: EditorView,
  pos: number,
  names: readonly string[],
  ownLine: boolean,
): number[] {
  const batch = nextBatch++;
  const placeholders = names.map((name, order) => ({
    id: nextId++,
    pos,
    name,
    batch,
    order,
    ownLine,
  }));
  view.dispatch(
    view.state.tr
      .setMeta(uploadPlaceholderKey, { type: 'add', placeholders })
      .setMeta('addToHistory', false),
  );
  return placeholders.map((placeholder) => placeholder.id);
}

export function findUploadPlaceholder(state: EditorState, id: number): UploadPlaceholder | null {
  return uploadPlaceholderKey.getState(state)?.find((item) => item.id === id) ?? null;
}

export function removeUploadPlaceholder(view: EditorView, id: number): void {
  if (view.isDestroyed || !findUploadPlaceholder(view.state, id)) return;
  view.dispatch(view.state.tr.setMeta(uploadPlaceholderKey, { type: 'remove', id }));
}

/** Marks `tr` as the insertion of the link for placeholder `id` (see `applyMeta`). */
export function markPlaceholderInserted(tr: Transaction, id: number, after: number): Transaction {
  return tr.setMeta(uploadPlaceholderKey, { type: 'inserted', id, after });
}
