/**
 * File name of a dropped file (SPEC §4.8, F15.1): the name the browser sent, kept as far as a
 * Windows file name and a working wikilink allow. NFC; every character Windows refuses
 * (`\ / : * ? " < > |`, control characters) and every character that would cut a `[[name]]` link
 * short (`[ ] # ^`) becomes a space; invisible format characters (bidi controls, zero-width
 * spaces, soft hyphens, a BOM) are dropped, except the joiners inside an emoji sequence; runs of
 * whitespace collapse; dots and spaces are trimmed at both ends (a leading dot would hide the file
 * or look like one of the app's temp files). The extension is kept as given, the whole name is at
 * most 120 code points (the stem is cut on a grapheme boundary). A name with nothing visible
 * left, or a reserved device name, becomes `Tệp đính kèm YYYY-MM-DD HH-mm.<ext>` (local time).
 */
import { segmentProblem } from '../security/path-guard.js';

const MAX_CODE_POINTS = 120;
/** Longer "extensions" are part of the name (`bản nháp.lần cuối cùng thật sự`). */
const MAX_EXTENSION_CODE_POINTS = 16;
// eslint-disable-next-line no-control-regex -- control characters are exactly what is replaced
const UNUSABLE = /[\\/:*?"<>|[\]#^\u0000-\u001f\u007f-\u009f]/g;
/** Format characters (Unicode Cf) and lone surrogates. */
const INVISIBLE = /[\p{Cf}\p{Cs}]/gu;
/** Inside an emoji sequence, ZWJ and tag characters (subdivision flags) belong to it. */
const EMOJI_JOINER = /^[‍\u{E0020}-\u{E007F}]$/u;
const VISIBLE = /[\p{L}\p{N}\p{S}\p{P}]/u;
/** Reserved by Windows beyond the path guard's list (`COM0`, `LPT0`), extension ignored. */
const RESERVED_ZERO_PORT = /^(?:com|lpt)0$/i;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const pad2 = (n: number) => String(n).padStart(2, '0');
const codePoints = (text: string) => Array.from(text).length;

/** `Tệp đính kèm 2026-10-21 09-05`: the stem used when the browser's name is unusable. */
export function fallbackAttachmentStem(now: Date): string {
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return `Tệp đính kèm ${date} ${pad2(now.getHours())}-${pad2(now.getMinutes())}`;
}

function withoutInvisibles(text: string): string {
  let out = '';
  for (const { segment } of graphemes.segment(text)) {
    const emoji = /\p{Extended_Pictographic}/u.test(segment);
    out += segment.replace(INVISIBLE, (char) => (emoji && EMOJI_JOINER.test(char) ? char : ''));
  }
  return out;
}

/** Cleaned name, trimmed at the end only (a leading dot may still mark a bare extension). */
function cleaned(raw: string): string {
  return withoutInvisibles(raw.normalize('NFC'))
    .replace(UNUSABLE, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/, '');
}

/** Stem without leading dots/spaces; `.png` has an extension and an empty stem. */
function splitExtension(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.');
  const extension = dot === -1 ? '' : name.slice(dot + 1);
  const isExtension =
    extension !== '' &&
    !extension.includes(' ') &&
    codePoints(extension) <= MAX_EXTENSION_CODE_POINTS;
  const stem = isExtension ? name.slice(0, dot) : name;
  return { stem: stem.replace(/^[. ]+/, ''), extension: isExtension ? extension : '' };
}

/** The longest grapheme-aligned prefix of `stem` with at most `max` code points. */
function cutStem(stem: string, max: number): string {
  if (codePoints(stem) <= max) return stem;
  let out = '';
  let used = 0;
  for (const { segment } of graphemes.segment(stem)) {
    const size = codePoints(segment);
    if (used + size > max) break;
    out += segment;
    used += size;
  }
  return out.replace(/[. ]+$/, '');
}

function unusable(stem: string, name: string): boolean {
  if (!VISIBLE.test(stem)) return true;
  return segmentProblem(name) !== null || RESERVED_ZERO_PORT.test(stem.trimEnd());
}

/** The name a dropped file is saved under (before the vault-wide ` 2`, ` 3` suffix). */
export function attachmentFileName(clientName: string, now: Date): string {
  const { stem: rawStem, extension } = splitExtension(cleaned(clientName));
  const suffix = extension === '' ? '' : `.${extension}`;
  const stem = cutStem(rawStem, MAX_CODE_POINTS - codePoints(suffix));
  const name = `${stem}${suffix}`;
  return unusable(stem, name) ? `${fallbackAttachmentStem(now)}${suffix}` : name;
}
