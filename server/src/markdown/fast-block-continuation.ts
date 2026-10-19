/**
 * Whether an open block continues on the current line (CommonMark "continuation" of block
 * quotes, list items, code, HTML, paragraphs and tables), advancing the cursor past the
 * block's prefix when it does.
 */
import type { BlockScanner } from './fast-block-scanner.js';
import type { Block } from './fast-block-types.js';
import { CODE_INDENT, isSpaceOrTab } from './fast-line-cursor.js';

const CLOSING_FENCE = /^(?:`{3,}|~{3,})(?=[ \t]*$)/;

/** 0 = matched, 1 = not matched, 2 = line fully consumed (closing code fence). */
export function continueBlock(scanner: BlockScanner, block: Block): 0 | 1 | 2 {
  const cursor = scanner.cursor;
  switch (block.kind) {
    case 'blockquote':
      if (cursor.indented || cursor.peek(cursor.nextNonspace) !== 62) return 1;
      cursor.advanceNextNonspace();
      cursor.advanceOffset(1);
      if (isSpaceOrTab(cursor.peek(cursor.offset))) cursor.advanceOffset(1, true);
      return 0;
    case 'item':
      if (cursor.blank) {
        if (block.childCount === 0) {
          // The reference parser keeps an empty item open until the next non-blank line and
          // only then exits it; remember that so that line counts as exiting a container.
          (block.parent as Block).pendingItemExit = true;
          return 1;
        }
        cursor.advanceNextNonspace();
      } else if (cursor.indent >= block.markerOffset + block.padding) {
        cursor.advanceOffset(block.markerOffset + block.padding, true);
      } else return 1;
      return 0;
    case 'footnote':
      // Blank lines continue a footnote; content lines need exactly four columns of indent.
      if (cursor.blank) cursor.advanceNextNonspace();
      else if (cursor.indent >= CODE_INDENT) cursor.advanceOffset(CODE_INDENT, true);
      else return 1;
      return 0;
    case 'list':
      if (block.pendingItemExit && !cursor.blank) {
        block.pendingItemExit = false;
        scanner.itemExitedLate = true;
      }
      return 0;
    case 'code':
      return continueCode(scanner, block);
    case 'html':
      return cursor.blank && block.htmlType >= 6 ? 1 : 0;
    case 'paragraph':
    case 'table':
      return cursor.blank ? 1 : 0;
    default:
      return 1;
  }
}

function continueCode(scanner: BlockScanner, block: Block): 0 | 1 | 2 {
  const cursor = scanner.cursor;
  if (!block.fenced) {
    if (cursor.indent >= CODE_INDENT) cursor.advanceOffset(CODE_INDENT, true);
    else if (cursor.blank) cursor.advanceNextNonspace();
    else return 1;
    return 0;
  }
  if (cursor.indent <= 3 && cursor.peek(cursor.nextNonspace) === block.fenceChar) {
    const match = CLOSING_FENCE.exec(cursor.rest(cursor.nextNonspace));
    if (match && match[0].length >= block.fenceLength) {
      block.end = cursor.end;
      scanner.finalize(scanner.open.pop() as Block);
      return 2;
    }
  }
  for (let i = block.fenceOffset; i > 0 && isSpaceOrTab(cursor.peek(cursor.offset)); i -= 1) {
    cursor.advanceOffset(1, true);
  }
  return 0;
}
