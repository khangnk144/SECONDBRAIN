/**
 * Fast CommonMark + GFM block structure scanner (line based, no tokens, no tree of inlines).
 * It follows the reference block-parsing strategy of the CommonMark spec: match the open
 * containers, try block starts, handle lazy paragraph continuation, close what did not match.
 * A full remark parse is ~45 s on the 5,000-note benchmark vault; this pass is what keeps
 * cold reindexing inside the SPEC §5 budget. GFM footnote definitions are containers here;
 * link reference definitions are taken off the start of paragraphs when they close. Anything
 * not modeled throws `FullParseRequired` so the caller can fall back to the full parse.
 */
import { continueBlock } from './fast-block-continuation.js';
import {
  checkboxAllowed,
  extractDefinitions,
  collectLineBounds,
  isContainer,
  maybeSpecial,
} from './fast-block-helpers.js';
import { tryBlockStarts } from './fast-block-starts.js';
import { acceptsLines, Block, type BlockKind, canContain } from './fast-block-types.js';
import { LineCursor } from './fast-line-cursor.js';
import { openTableIfStarts } from './fast-table-rows.js';
import { htmlBlockEnds, htmlBlockStart } from './html-syntax.js';

export class BlockScanner {
  readonly cursor = new LineCursor();
  readonly doc: Block;
  /** Open blocks from the document down to the tip. */
  readonly open: Block[];
  readonly leaves: Block[] = [];
  allClosed = true;
  lastMatched: Block;
  /**
   * Whether new blocks on this line interrupt an open paragraph (or indented code), with the
   * reference parser's semantics: decided once per line, before any container opens, and kept
   * for containers nested on the same line.
   */
  interrupt = false;
  /** Some container did not continue on this line and no new container was opened (yet). */
  containersExited = false;
  /** Where the line's text starts before its leading whitespace is skipped. */
  textStart = 0;
  /** An empty list item ended at a blank line and counts as exiting on this line. */
  itemExitedLate = false;
  /** Normalized labels of link reference definitions and of footnote definitions. */
  readonly definitions = new Set<string>();
  readonly footnotes = new Set<string>();
  /** Absolute [start, end) of every line, for one-line lookahead (table delimiter rows). */
  readonly lineBounds: number[] = [];
  lineIndex = 0;

  constructor(
    readonly content: string,
    bodyStart: number,
  ) {
    this.doc = new Block('document', null, bodyStart);
    this.open = [this.doc];
    this.lastMatched = this.doc;
    collectLineBounds(content, bodyStart, this.lineBounds);
  }

  get tip(): Block {
    return this.open[this.open.length - 1] as Block;
  }

  scan(): Block[] {
    const count = this.lineBounds.length / 2;
    for (this.lineIndex = 0; this.lineIndex < count; this.lineIndex += 1) {
      const at = this.lineIndex * 2;
      this.cursor.reset(
        this.content,
        this.lineBounds[at] as number,
        this.lineBounds[at + 1] as number,
      );
      this.incorporateLine();
    }
    while (this.open.length > 1) this.finalize(this.open.pop() as Block);
    return this.leaves;
  }

  private incorporateLine(): void {
    const cursor = this.cursor;
    const oldTip = this.tip;
    let container = this.doc;
    let depth = 1;
    for (; depth < this.open.length; depth += 1) {
      const block = this.open[depth] as Block;
      cursor.findNextNonspace();
      const result = continueBlock(this, block);
      if (result === 2) return;
      if (result === 1) break;
      container = block;
    }
    const lastContainer = isContainer(oldTip.kind) ? this.open.length - 1 : this.open.length - 2;
    this.containersExited = depth - 1 < lastContainer || this.itemExitedLate;
    this.itemExitedLate = false;
    this.interrupt =
      !this.containersExited &&
      (oldTip.kind === 'paragraph' || (oldTip.kind === 'code' && !oldTip.fenced));
    this.allClosed = container === oldTip;
    this.lastMatched = container;
    if (container.kind === 'table' && container.awaitingDelimiter) {
      container.awaitingDelimiter = false;
      this.addLine(container);
      return;
    }
    let matchedLeaf = container.kind === 'code' || container.kind === 'html';
    while (!matchedLeaf) {
      cursor.findNextNonspace();
      this.textStart = cursor.offset;
      if (!cursor.indented && !maybeSpecial(cursor.peek(cursor.nextNonspace))) {
        cursor.advanceNextNonspace();
        break;
      }
      const result = tryBlockStarts(this, container);
      if (result === 0) {
        cursor.advanceNextNonspace();
        break;
      }
      container = this.tip;
      if (result === 2) matchedLeaf = true;
      else this.containersExited = false;
    }
    this.addText(container);
    // The reference parser ends an indented code block opened on such a line right there.
    const tip = this.tip;
    if (tip.kind === 'code' && tip.closeAtLineEnd) this.finalize(this.open.pop() as Block);
  }

  /** What remains of the line is text: lazy continuation, a leaf's line, or a new paragraph. */
  private addText(container: Block): void {
    const cursor = this.cursor;
    if (!this.allClosed && !cursor.blank && this.tip.kind === 'paragraph') {
      // A table may start on a lazy line only if its delimiter row is in the paragraph's
      // container (the reference parser rejects lazy delimiter rows).
      if (openTableIfStarts(this, this.tip.parent as Block)) return;
      // The reference parser lets a lone complete HTML tag end the paragraph on a lazy line:
      // it becomes an HTML block in the paragraph's container, which stays open.
      if (
        !cursor.indented &&
        cursor.peek(cursor.offset) === 60 &&
        htmlBlockStart(cursor.rest(), true) === 7
      ) {
        this.finalize(this.open.pop() as Block);
        this.addChild('html', cursor.offset).htmlType = 7;
        this.addLine(this.tip);
        return;
      }
      this.addContinuation(this.tip);
      return;
    }
    this.closeUnmatched();
    if (container.kind === 'paragraph' && openTableIfStarts(this, container.parent as Block))
      return;
    if (container.kind === 'paragraph') this.addContinuation(container);
    else if (acceptsLines(container.kind)) {
      this.addLine(container);
      if (container.kind === 'html' && htmlBlockEnds(container.htmlType, cursor.rest())) {
        this.finalize(this.open.pop() as Block);
      }
    } else if (cursor.offset < cursor.end && !cursor.blank) {
      if (openTableIfStarts(this, container)) return;
      const paragraph = this.addChild('paragraph', cursor.offset);
      if (paragraph.firstInItem && !checkboxAllowed(this, paragraph.parent as Block)) {
        paragraph.firstInItem = false;
      }
      cursor.advanceNextNonspace();
      paragraph.start = cursor.offset;
      this.addLine(paragraph);
    }
  }

  /** Paragraph continuation lines keep their leading whitespace (it matters inside code spans). */
  private addContinuation(paragraph: Block): void {
    paragraph.lines.push(Math.min(this.textStart, this.cursor.offset), this.cursor.end);
    paragraph.end = this.cursor.end;
  }

  addLine(block: Block): void {
    block.lines.push(this.cursor.offset, this.cursor.end);
    block.end = this.cursor.end;
  }

  closeUnmatched(): void {
    if (this.allClosed) return;
    while (this.tip !== this.lastMatched) this.finalize(this.open.pop() as Block);
    this.allClosed = true;
  }

  addChild(kind: BlockKind, start: number): Block {
    while (!canContain(this.tip.kind, kind)) this.finalize(this.open.pop() as Block);
    const parent = this.tip;
    const block = new Block(kind, parent, start);
    if (kind === 'paragraph' && parent.kind === 'item' && parent.childCount === 0)
      block.firstInItem = true;
    parent.childCount += 1;
    this.open.push(block);
    return block;
  }

  finalize(block: Block): void {
    if (block.kind === 'paragraph' && !extractDefinitions(this, block)) return;
    if (!isContainer(block.kind)) this.leaves.push(block);
  }
}
