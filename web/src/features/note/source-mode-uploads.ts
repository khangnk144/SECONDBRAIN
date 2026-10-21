/**
 * Files dropped or pasted into source mode go through the same upload flow as in the editor; the
 * returned link text is inserted where the caret was (alone on an empty line, else with a
 * separating space), following any typing done meanwhile. Files of one drop keep their order.
 */
import {
  showLinkNotInserted,
  uploadAttachments,
  type UploadDeps,
} from '../../editor/attachments/attachment-uploads';

export interface SourceUploadTarget {
  /** The text shown now; null when source mode is gone (the link cannot be placed). */
  getText(): string | null;
  /** Replaces the text; `map` moves an offset of the old text into the new one. */
  setText(text: string, map: (offset: number) => number): void;
  /** Shows or hides "Đang tải lên <tên>…" for one file. */
  setUploading(id: number, name: string | null): void;
}

let nextId = 1;

export function uploadIntoSource(
  files: readonly File[],
  offset: number,
  target: SourceUploadTarget,
  deps?: UploadDeps,
): Promise<void> {
  const slots = files.map((file, order) => ({ id: nextId++, order, offset, done: false }));
  let base = target.getText() ?? '';
  // Brings every waiting slot up to the current text (typing may have happened meanwhile).
  const catchUp = (current: string) => {
    if (current === base) return;
    for (const slot of slots) slot.offset = mapOffset(base, current, slot.offset);
    base = current;
  };
  slots.forEach((slot, index) => target.setUploading(slot.id, files[index]?.name ?? ''));

  return uploadAttachments(
    files,
    (_file, index) => {
      const slot = slots[index]!;
      const finish = () => {
        slot.done = true;
        target.setUploading(slot.id, null);
      };
      return {
        cancel: finish,
        done: (result) => {
          finish();
          const current = target.getText();
          if (current === null) {
            showLinkNotInserted(result);
            return;
          }
          catchUp(current);
          const at = Math.min(slot.offset, current.length);
          const insert = linkWithSpaces(current, at, result.link);
          const next = current.slice(0, at) + insert.text + current.slice(at);
          const linkEnd = at + insert.linkEnd;
          for (const other of slots) {
            if (other === slot || other.done) continue;
            if (other.offset > at) other.offset += insert.text.length;
            else if (other.offset === at && other.order > slot.order) other.offset = linkEnd;
          }
          base = next;
          target.setText(next, (offset) => (offset < at ? offset : offset + insert.text.length));
        },
      };
    },
    deps,
  );
}

/** The link alone on an empty line, else with a space on each side that touches other text. */
export function linkWithSpaces(
  text: string,
  at: number,
  link: string,
): { text: string; linkEnd: number } {
  const before = at > 0 ? (text[at - 1] ?? '') : '';
  const after = text[at] ?? '';
  const spaceBefore = before !== '' && !/\s/.test(before);
  const spaceAfter = after !== '' && !/\s/.test(after);
  const head = spaceBefore ? ' ' : '';
  return { text: `${head}${link}${spaceAfter ? ' ' : ''}`, linkEnd: head.length + link.length };
}

/** Where `offset` of `before` lands in `after`, assuming one changed range in between. */
export function mapOffset(before: string, after: string, offset: number): number {
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before[start] === after[start]) start += 1;
  let end = 0;
  while (end < limit - start && before[before.length - 1 - end] === after[after.length - 1 - end]) {
    end += 1;
  }
  if (offset <= start) return offset;
  const oldChangeEnd = before.length - end;
  if (offset >= oldChangeEnd) return offset + (after.length - before.length);
  return after.length - end;
}
