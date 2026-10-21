/**
 * Where the selection is, as far as formatting cares: commands that cannot apply there are shown
 * disabled instead of failing silently (a verbatim block is source only, a code block holds no
 * marks, a table cell holds one line of inline content).
 */
import type { MarkType } from '@tiptap/pm/model';
import { NodeSelection, type EditorState } from '@tiptap/pm/state';

/** Character formatting that "Xóa định dạng" removes (links are content, they stay). */
export const CLEARABLE_MARKS = ['bold', 'italic', 'underline', 'strike', 'code'] as const;

export function verbatimSelected(state: EditorState): boolean {
  const { selection } = state;
  return selection instanceof NodeSelection && selection.node.type.name === 'verbatimBlock';
}

export function inCodeBlock(state: EditorState): boolean {
  const { $from, $to } = state.selection;
  return Boolean($from.parent.type.spec.code || $to.parent.type.spec.code);
}

export function inTableCell(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if (/^table(Cell|Header)$/.test($from.node(depth).type.name)) return true;
  }
  return false;
}

/** The caret (or the selection's end) sits in inline code, where `[[` would stay literal. */
export function inInlineCode(state: EditorState): boolean {
  const marks = state.storedMarks ?? state.selection.$to.marks();
  return marks.some((mark) => mark.type.name === 'code');
}

/** Whether the selection (or, for a caret, the marks it types with) carries clearable marks. */
export function hasClearableMarks(state: EditorState): boolean {
  const types = CLEARABLE_MARKS.map((name) => state.schema.marks[name]).filter(
    (type): type is MarkType => type !== undefined,
  );
  const { selection } = state;
  if (selection.empty) {
    const marks = state.storedMarks ?? selection.$from.marks();
    return marks.some((mark) => types.includes(mark.type));
  }
  return selection.ranges.some(({ $from, $to }) =>
    types.some((type) => state.doc.rangeHasMark($from.pos, $to.pos, type)),
  );
}
