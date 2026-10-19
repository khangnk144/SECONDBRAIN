/**
 * Source mode shows the file as plain text: line endings as `\n` and no BOM (a textarea always
 * reports `\n`). Writing back keeps every untouched line byte for byte, including its own line
 * ending (a file may mix CRLF and LF); only typed lines get the file's line ending. So leaving
 * source mode without edits, or undoing them, gives the exact file text again.
 */
import { diffArrays } from 'diff';

export type Eol = '\n' | '\r\n';

interface SourceLine {
  text: string;
  /** The line's own ending in the file: `\r\n`, `\n`, a lone `\r`, or '' for the last line. */
  end: string;
}

export interface SourceBase {
  bom: boolean;
  eol: Eol;
  lines: SourceLine[];
}

function splitLines(body: string, breaks: RegExp): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  breaks.lastIndex = 0;
  for (let match = breaks.exec(body); match; match = breaks.exec(body)) {
    lines.push({ text: body.slice(start, match.index), end: match[0] });
    start = match.index + match[0].length;
  }
  if (start < body.length) lines.push({ text: body.slice(start), end: '' });
  return lines;
}

/** The parts of the file text the display form needs to be turned back into file text. */
export function sourceBase(fileText: string, eol: Eol): SourceBase {
  const bom = fileText.charCodeAt(0) === 0xfeff;
  return { bom, eol, lines: splitLines(bom ? fileText.slice(1) : fileText, /\r\n|\r|\n/g) };
}

const lineKey = (line: SourceLine) => (line.end === '' ? line.text : `${line.text}\n`);

/** What the textarea shows: `\n` line endings, no BOM. */
export function displayText(base: SourceBase): string {
  return base.lines.map(lineKey).join('');
}

/** File text for the edited display text: untouched lines keep their bytes, new lines use `eol`. */
export function fileTextFromDisplay(display: string, base: SourceBase): string {
  const edited = splitLines(display, /\n/g);
  const changes = diffArrays(base.lines.map(lineKey), edited.map(lineKey));
  let oldIndex = 0;
  let newIndex = 0;
  let out = base.bom ? '\uFEFF' : '';
  for (const change of changes) {
    const count = change.count ?? change.value.length;
    if (change.removed) {
      oldIndex += count;
      continue;
    }
    for (let i = 0; i < count; i += 1) {
      if (change.added) {
        const line = edited[newIndex + i];
        if (line) out += line.text + (line.end === '' ? '' : base.eol);
      } else {
        const line = base.lines[oldIndex + i];
        if (line) out += line.text + line.end;
      }
    }
    if (!change.added) oldIndex += count;
    newIndex += count;
  }
  return out;
}
