/**
 * Keeps the selection an AI request was made for, while she goes on writing (the panel is not
 * modal): every editor transaction maps the range forward. A document loaded from outside (a
 * reload, source mode) makes the range unknown; so does text typed inside it, for a replace.
 */
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Mapping } from '@tiptap/pm/transform';
import type { Transaction } from '@tiptap/pm/state';

export interface TrackedRange {
  from: number;
  to: number;
}

const leafText = () => ' ';

export class RangeTracker {
  private readonly mapping = new Mapping();
  private doc: ProseMirrorNode;
  private lost = false;
  private readonly text: string;

  constructor(
    private readonly editor: Editor,
    private readonly from: number,
    private readonly to: number,
  ) {
    this.doc = editor.state.doc;
    this.text = this.doc.textBetween(from, to, '\n', leafText);
    editor.on('transaction', this.onTransaction);
  }

  private readonly onTransaction = (props: {
    transaction: Transaction;
    appendedTransactions: Transaction[];
  }) => {
    if (this.lost) return;
    for (const tr of [props.transaction, ...props.appendedTransactions]) {
      // `replaceDoc` swaps the whole document without steps: positions mean nothing any more.
      if (tr.before !== this.doc) {
        this.lost = true;
        return;
      }
      this.mapping.appendMapping(tr.mapping);
      this.doc = tr.doc;
    }
  };

  /** Where the range is now, or null when it cannot be known. */
  current(): TrackedRange | null {
    if (this.lost || this.editor.isDestroyed || this.editor.state.doc !== this.doc) return null;
    const from = this.mapping.map(this.from, 1);
    const to = this.mapping.map(this.to, -1);
    return to >= from ? { from, to } : null;
  }

  /** The range while it still holds exactly the text that was selected (for "Thay"). */
  unchanged(): TrackedRange | null {
    const range = this.current();
    if (!range) return null;
    const text = this.editor.state.doc.textBetween(range.from, range.to, '\n', leafText);
    return text === this.text ? range : null;
  }

  dispose(): void {
    this.editor.off('transaction', this.onTransaction);
  }
}
