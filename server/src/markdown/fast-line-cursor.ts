/**
 * Position bookkeeping for the fast block scanner: one physical line of the file, with
 * CommonMark column arithmetic (tabs advance to the next multiple of 4, and a tab may be only
 * partly consumed by a container's indentation). All offsets are absolute in the file text.
 */

export const CODE_INDENT = 4;

export class LineCursor {
  text = '';
  /** Absolute offsets of the line (without its line ending). */
  start = 0;
  end = 0;
  offset = 0;
  column = 0;
  nextNonspace = 0;
  nextNonspaceColumn = 0;
  indent = 0;
  indented = false;
  blank = false;

  /** Start of the whitespace run whose end `nextNonspace` holds (-1 = nothing cached). */
  private scannedFrom = -1;

  reset(text: string, start: number, end: number): void {
    this.text = text;
    this.start = start;
    this.end = end;
    this.offset = start;
    this.column = 0;
    this.scannedFrom = -1;
  }

  /** Char code at an absolute offset, or -1 past the end of the line. */
  peek(at: number): number {
    return at < this.end ? this.text.charCodeAt(at) : -1;
  }

  findNextNonspace(): void {
    // Columns are absolute within the line, so from anywhere inside the whitespace run scanned
    // last time the next non-space is the same: reusing it keeps deeply nested containers
    // (each re-checking the same indentation) linear instead of quadratic in the indent.
    if (this.scannedFrom < 0 || this.offset < this.scannedFrom || this.offset > this.nextNonspace) {
      let i = this.offset;
      let cols = this.column;
      let code = this.peek(i);
      while (code === 32 || code === 9) {
        cols += code === 32 ? 1 : 4 - (cols % 4);
        i += 1;
        code = this.peek(i);
      }
      this.scannedFrom = this.offset;
      this.blank = code === -1;
      this.nextNonspace = i;
      this.nextNonspaceColumn = cols;
    }
    this.indent = this.nextNonspaceColumn - this.column;
    this.indented = this.indent >= CODE_INDENT;
  }

  advanceNextNonspace(): void {
    this.offset = this.nextNonspace;
    this.column = this.nextNonspaceColumn;
  }

  /** Advances `count` characters, or `count` columns when `columns` (tabs count as spaces). */
  advanceOffset(count: number, columns = false): void {
    let left = count;
    while (left > 0) {
      const code = this.peek(this.offset);
      if (code === -1) return;
      if (code === 9) {
        const toTab = 4 - (this.column % 4);
        if (columns) {
          const partial = toTab > left;
          const step = partial ? left : toTab;
          this.column += step;
          if (!partial) this.offset += 1;
          left -= step;
        } else {
          this.column += toTab;
          this.offset += 1;
          left -= 1;
        }
      } else {
        this.offset += 1;
        this.column += 1;
        left -= 1;
      }
    }
  }

  /** The rest of the line from an absolute offset. */
  rest(from: number = this.offset): string {
    return this.text.slice(from, this.end);
  }
}

export function isSpaceOrTab(code: number): boolean {
  return code === 32 || code === 9;
}
