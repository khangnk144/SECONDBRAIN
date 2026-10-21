/**
 * Note names proposed by AI (Inbox tidying, saved answers) follow the quick-capture name rules
 * (DECISIONS M3: first non-empty line, Windows-invalid and control characters and `[ ] # ^ |`
 * → space, invisible format characters dropped, dots/spaces trimmed, reserved device names
 * refused) with a longer limit. Returns null when nothing usable is left, so the caller decides
 * the fallback instead of getting a timestamp name.
 */
import { segmentProblem } from '../../security/path-guard.js';

// eslint-disable-next-line no-control-regex -- control characters are exactly what is replaced
const UNUSABLE = /[\\/:*?"<>|[\]#^\u0000-\u001f\u007f]/g;
const INVISIBLE = /[\p{Cf}\p{Cs}]/gu;
const VISIBLE = /[\p{L}\p{N}\p{S}\p{P}]/u;
const RESERVED_ZERO_PORT = /^(?:com|lpt)0$/i;
const LINE_PREFIX = /^(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d{1,9}[.)]\s+)+/;
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function sanitizeNoteTitle(raw: string, maxGraphemes: number): string | null {
  const firstLine =
    raw
      .normalize('NFC')
      .split(/\r\n|\n|\r/)
      .find((line) => line.trim() !== '') ?? '';
  const clusters: string[] = [];
  for (const { segment } of graphemes.segment(firstLine.trim().replace(LINE_PREFIX, ''))) {
    // Emoji sequences keep their joiners; elsewhere format characters are dropped.
    const kept = /\p{Extended_Pictographic}/u.test(segment)
      ? segment
      : segment.replace(INVISIBLE, '');
    if (kept !== '') clusters.push(kept);
  }
  const name = clusters
    .slice(0, maxGraphemes)
    .join('')
    .replace(UNUSABLE, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+|[. ]+$/g, '');
  if (!VISIBLE.test(name)) return null;
  const stem = name.split('.')[0]!.trimEnd();
  if (segmentProblem(`${name}.md`) !== null || RESERVED_ZERO_PORT.test(stem)) return null;
  return name;
}
