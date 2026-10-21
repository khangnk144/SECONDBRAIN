import type { Transaction } from '@tiptap/pm/state';
import {
  taskText,
  tickSplices,
  untickSplices,
  type TextSplice,
} from '../markdown/done-token-rules';

/**
 * Ticks or unticks the task item at `pos` in one transaction, with the done-token rules the
 * server's view patches use (`done-token-rules.ts`): `checked` changes, and on the item's first
 * source line (before its first soft or hard line break) a tick sets the first ✅ token to
 * `today` in place or appends ` ✅ <today>` as plain text without marks; an untick removes every ✅
 * token. Ticking a ticked task changes nothing (its completion date stays). The converter writes
 * the change as a patch of that one line.
 */
export function toggleTask(
  tr: Transaction,
  pos: number,
  checked: boolean,
  today: string,
): Transaction {
  const item = tr.doc.nodeAt(pos);
  if (!item || item.type.name !== 'taskItem') return tr;
  const wasChecked = item.attrs['checked'] === true;
  if (checked && wasChecked) return tr;
  if (checked !== wasChecked) tr.setNodeMarkup(pos, undefined, { ...item.attrs, checked });
  const paragraph = item.firstChild;
  if (!paragraph || !paragraph.isTextblock) return tr;
  const task = taskText(paragraph);
  const splices = checked ? tickSplices(task, today) : untickSplices(task);
  // One character per position inside the paragraph (see `taskText`), so offsets map directly;
  // the last splice goes first, so the positions of earlier ones stay valid.
  const contentStart = pos + 2;
  for (const splice of [...splices].sort((a, b) => b.start - a.start)) {
    applySplice(tr, contentStart, splice);
  }
  return tr;
}

function applySplice(tr: Transaction, contentStart: number, splice: TextSplice): void {
  const from = contentStart + splice.start;
  const to = contentStart + splice.end;
  const { schema } = tr.doc.type;
  if (!splice.text) tr.delete(from, to);
  // A new token is plain text, so it never extends a mark the line ends with.
  else if (from === to) tr.insert(from, schema.text(splice.text));
  // A token set in place keeps its marks (the server rewrites it where it stands).
  else tr.replaceWith(from, to, schema.text(splice.text, tr.doc.nodeAt(from)?.marks));
}
