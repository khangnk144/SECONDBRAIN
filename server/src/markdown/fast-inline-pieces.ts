/**
 * The readable text of a leaf as the inline pass builds it: a list of pieces (text, code, raw
 * HTML, `[`/`![` brackets) that are handed to the `PlainTextBuilder` once no bracket is pending.
 * A bracket piece disappears when it turns out to start a link; raw HTML only becomes text
 * inside an image label (the reference parser makes it part of the alt text).
 */
import type { PlainTextBuilder } from './plain-text-builder.js';

const TEXT = 0;
const CODE = 1;
const REMOVED = 2;
const BRACKET = 3;
const HTML = 4;

export class InlinePieces {
  private readonly values: string[] = [];
  private readonly kinds: number[] = [];

  get count(): number {
    return this.values.length;
  }

  text(value: string): void {
    const last = this.values.length - 1;
    if (last >= 0 && this.kinds[last] === TEXT) this.values[last] += value;
    else this.push(value, TEXT);
  }

  code(value: string): void {
    this.push(value, CODE);
  }

  html(value: string): void {
    this.push(value, HTML);
  }

  /** Adds a `[` or `![` and returns its piece index. */
  bracket(value: string): number {
    this.push(value, BRACKET);
    return this.values.length - 1;
  }

  /** The bracket at `index` started a link or reference: it is syntax, not text. */
  remove(index: number): void {
    this.kinds[index] = REMOVED;
  }

  /** Raw HTML after piece `index` (an image label) counts as alt text. */
  htmlAsTextAfter(index: number): void {
    for (let k = index + 1; k < this.kinds.length; k += 1) {
      if (this.kinds[k] === HTML) this.kinds[k] = TEXT;
    }
  }

  /** Hands every piece to the builder; only call while no bracket is pending. */
  flush(builder: PlainTextBuilder): void {
    for (let k = 0; k < this.values.length; k += 1) {
      const kind = this.kinds[k];
      if (kind === CODE) builder.code(this.values[k] as string);
      else if (kind !== REMOVED && kind !== HTML) builder.text(this.values[k] as string);
    }
    this.values.length = 0;
    this.kinds.length = 0;
  }

  private push(value: string, kind: number): void {
    this.values.push(value);
    this.kinds.push(kind);
  }
}
