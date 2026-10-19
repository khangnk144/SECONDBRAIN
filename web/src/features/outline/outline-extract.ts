/**
 * Headings (levels 1–3) of a note for the "Mục lục" panel: a light line scan, not a full
 * Markdown parse. ATX (`## Title`) and setext (`Title` + `===`/`---`) headings count; lines inside
 * fenced code and the front matter block never do. Lines are 1-based and count the front matter,
 * like the server's backlink lines, so `&line=N` means the same thing everywhere.
 */
export interface OutlineHeading {
  level: 1 | 2 | 3;
  text: string;
  line: number;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
/** Lines that start another block and so never continue or form a setext paragraph. */
const OTHER_BLOCK = /^ {0,3}(?:>|[-*+](?:[ \t]|$)|\d{1,9}[.)](?:[ \t]|$)|<|(?:[-*_][ \t]*){3,}$)/;
const FRONT_MATTER_OPEN = /^---[ \t]*$/;
const FRONT_MATTER_CLOSE = /^(?:---|\.\.\.)[ \t]*$/;

interface Fence {
  char: string;
  length: number;
}

/** Plain text of a heading: wikilinks show their alias or target, Markdown links their text. */
export function cleanHeadingText(raw: string): string {
  return raw
    .replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
    .replace(/!?\[\[([^\]]*)\]\]/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/\*(\S(?:.*?\S)?)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Index of the first line after the front matter block (0 when there is none or it is open). */
function bodyStart(lines: string[]): number {
  if (!FRONT_MATTER_OPEN.test(lines[0] ?? '')) return 0;
  for (let i = 1; i < lines.length; i += 1) {
    if (FRONT_MATTER_CLOSE.test(lines[i] ?? '')) return i + 1;
  }
  return 0;
}

function closesFence(line: string, fence: Fence): boolean {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
  const run = match?.[1];
  return run !== undefined && run[0] === fence.char && run.length >= fence.length;
}

export function extractOutline(content: string): OutlineHeading[] {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const headings: OutlineHeading[] = [];
  let fence: Fence | null = null;
  // The paragraph being read: a setext underline turns it into a heading.
  let paragraph: { line: number; parts: string[] } | null = null;
  const push = (level: number, raw: string, line: number) => {
    const text = cleanHeadingText(raw);
    if (level <= 3 && text !== '') headings.push({ level: level as 1 | 2 | 3, text, line });
  };

  for (let i = bodyStart(lines); i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const lineNumber = i + 1;
    if (fence) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    const run = open?.[1];
    // A backtick fence's info string may not contain backticks (CommonMark).
    if (run && !(run[0] === '`' && (open?.[2] ?? '').includes('`'))) {
      fence = { char: run[0] ?? '`', length: run.length };
      paragraph = null;
      continue;
    }
    const underline = SETEXT_UNDERLINE.exec(line);
    if (underline && paragraph) {
      push(underline[1]?.startsWith('=') ? 1 : 2, paragraph.parts.join(' '), paragraph.line);
      paragraph = null;
      continue;
    }
    const atx = ATX.exec(line);
    if (atx) {
      push(atx[1]?.length ?? 1, atx[2] ?? '', lineNumber);
      paragraph = null;
    } else if (line.trim() === '' || OTHER_BLOCK.test(line)) {
      paragraph = null;
    } else if (paragraph) {
      paragraph.parts.push(line.trim());
    } else if (!/^(?: {4}|\t)/.test(line)) {
      paragraph = { line: lineNumber, parts: [line.trim()] };
    }
  }
  return headings;
}
