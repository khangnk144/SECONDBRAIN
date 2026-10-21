/**
 * Template variables (SPEC F13.2, F14.2), shared by `POST /note` with a template and by daily
 * notes: `{{title}}`, `{{date}}` (ISO), `{{date:<dayjs format>}}` in the UI language,
 * `{{yesterday}}` / `{{tomorrow}}` (ISO), `{{time}}` (`HH:mm`) or `{{time:<format>}}`, and
 * `{{cursor}}`, which is removed and reported as the caret offset. Anything else is left as
 * written. Every value is inserted literally (a title holding `$1` or `{{cursor}}` stays text).
 */
import dayjs from 'dayjs';
import 'dayjs/locale/vi.js';
import { addDays, localMidnight } from '../lib/local-date.js';

export type TemplateLanguage = 'vi' | 'en';

export interface TemplateContext {
  /** `{{title}}`. */
  title: string;
  /** The note's calendar date: `{{date}}`, `{{yesterday}}`, `{{tomorrow}}`. */
  date: string;
  /** The current instant, for `{{time}}`. */
  now: Date;
  /** Locale of formatted dates (weekday and month names). */
  language: TemplateLanguage;
}

export interface FilledTemplate {
  content: string;
  /** UTF-16 offset of the first `{{cursor}}` in `content`; null when the template has none. */
  cursor: number | null;
}

const VARIABLE = /\{\{([a-z]+)(?::([^{}\r\n]*))?\}\}/g;

function valueOf(name: string, format: string | undefined, context: TemplateContext) {
  const plain = format === undefined || format === '';
  switch (name) {
    case 'title':
      return plain ? context.title : null;
    case 'date':
      return plain
        ? context.date
        : dayjs(localMidnight(context.date)).locale(context.language).format(format);
    case 'time':
      return dayjs(context.now)
        .locale(context.language)
        .format(plain ? 'HH:mm' : format);
    case 'yesterday':
      return plain ? addDays(context.date, -1) : null;
    case 'tomorrow':
      return plain ? addDays(context.date, 1) : null;
    default:
      return null;
  }
}

export function fillTemplate(template: string, context: TemplateContext): FilledTemplate {
  let content = '';
  let cursor: number | null = null;
  let last = 0;
  for (const match of template.matchAll(VARIABLE)) {
    const [whole, name, format] = match as unknown as [string, string, string | undefined];
    content += template.slice(last, match.index);
    last = match.index + whole.length;
    if (name === 'cursor' && format === undefined) {
      cursor ??= content.length;
      continue;
    }
    content += valueOf(name, format, context) ?? whole;
  }
  return { content: content + template.slice(last), cursor };
}
