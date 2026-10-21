/**
 * File name of a quick capture (SPEC F12.2): the first non-empty line without its Markdown line
 * prefix, at most 40 characters as people see them (grapheme clusters, so an emoji sequence is
 * never cut), with every character Windows refuses in names (`\ / : * ? " < > |`, control
 * characters) and every character that makes a title unlinkable (`[ ] # ^ |`) replaced by a
 * space. Invisible format characters (zero-width spaces, bidi controls, a BOM) and broken UTF-16
 * are dropped first, so a name never hides or reorders what it shows. A name with nothing visible
 * left, or a reserved device name, becomes `Ghi nhanh YYYY-MM-DD HH-mm` (local time).
 */
import { segmentProblem } from '../security/path-guard.js';

const MAX_GRAPHEMES = 40;
/** Heading, quote, task, bullet and ordered-list markers at the start of a line. */
const LINE_PREFIX =
  /^(?:#{1,6}(?:[ \t]+|$)|>[ \t]?|[-*+][ \t]+\[[ xX]\](?:[ \t]+|$)|[-*+](?:[ \t]+|$)|\d{1,9}[.)](?:[ \t]+|$))/;
// eslint-disable-next-line no-control-regex -- control characters are exactly what is replaced
const UNUSABLE = /[\\/:*?"<>|[\]#^\u0000-\u001f\u007f]/g;
/** Format characters (Unicode Cf: ZWSP, ZWJ, bidi controls, BOM, tags…) and lone surrogates. */
const INVISIBLE = /[\p{Cf}\p{Cs}]/gu;
/** Inside an emoji sequence, ZWJ and tag characters (as in subdivision flags) belong to it. */
const EMOJI_JOINER = /^[\u200D\u{E0020}-\u{E007F}]$/u;
/** What a name needs at least one of to be visible. */
const VISIBLE = /[\p{L}\p{N}\p{S}\p{P}]/u;
const DEFAULT_IGNORABLE = /\p{Default_Ignorable_Code_Point}/gu;
/** Names Microsoft lists as reserved beyond the path guard's (`COM0`, `LPT0`), extension ignored. */
const RESERVED_ZERO_PORT = /^(?:com|lpt)0$/i;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const pad = (n: number) => String(n).padStart(2, '0');

/** `Ghi nhanh 2026-10-20 09-05`: the name used when the text gives none. */
export function timestampCaptureName(now: Date): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `Ghi nhanh ${date} ${pad(now.getHours())}-${pad(now.getMinutes())}`;
}

/** The grapheme clusters of `text` without invisible characters (emoji sequences kept whole). */
function visibleClusters(text: string): string[] {
  const clusters: string[] = [];
  for (const { segment } of graphemes.segment(text)) {
    const emoji = /\p{Extended_Pictographic}/u.test(segment);
    const kept = segment.replace(INVISIBLE, (char) =>
      emoji && EMOJI_JOINER.test(char) ? char : '',
    );
    if (kept !== '') clusters.push(kept);
  }
  return clusters;
}

function stripLinePrefixes(line: string): string {
  let text = line.trim();
  for (;;) {
    const next = text.replace(LINE_PREFIX, '').trimStart();
    if (next === text) return text;
    text = next;
  }
}

function isReserved(name: string): boolean {
  const stem = name.split('.')[0]!.trimEnd();
  return segmentProblem(`${name}.md`) !== null || RESERVED_ZERO_PORT.test(stem);
}

/** Note name (without `.md`) for captured `text`; never empty, always a valid file name. */
export function captureNoteName(text: string, now: Date): string {
  const firstLine =
    visibleClusters(text.normalize('NFC'))
      .join('')
      .split(/\r\n|\n|\r/)
      .find((line) => line.trim() !== '') ?? '';
  const head = visibleClusters(stripLinePrefixes(firstLine)).slice(0, MAX_GRAPHEMES).join('');
  const name = head
    .replace(UNUSABLE, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '');
  const visible = VISIBLE.test(name.replace(DEFAULT_IGNORABLE, ''));
  if (!visible || isReserved(name)) return timestampCaptureName(now);
  return name;
}
