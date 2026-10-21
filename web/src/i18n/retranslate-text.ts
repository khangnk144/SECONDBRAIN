/**
 * Re-renders an already translated string in another language (SPEC F19.2: a language switch
 * updates what is on screen without a reload). Some texts were translated once and kept as plain
 * strings (toasts already shown); this finds the translation that produced the text in the old
 * language – exact text first, then the template whose fixed words cover most of it, its
 * `{{values}}` read back – and renders the same key with the same values in the new language.
 */
import type { LocaleTree } from './merge-locales';

type Lang = 'vi' | 'en';

interface Template {
  /** Key without a plural suffix (`_one`, `_other`…): i18next picks the form again. */
  key: string;
  names: string[];
  pattern: RegExp;
  /** Characters outside placeholders: the more, the more specific the match. */
  literal: number;
}

const PLURAL_SUFFIX = /_(?:zero|one|two|few|many|other)$/;
const PLACEHOLDER = /\{\{\s*([\w.-]+)(?:\s*,[^}]*)?\s*\}\}/g;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function flatten(tree: LocaleTree, prefix: string, out: Map<string, string>): void {
  for (const [name, value] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (typeof value === 'string') out.set(key, value);
    else flatten(value, key, out);
  }
}

interface LanguageIndex {
  exact: Map<string, string>;
  templates: Template[];
}

const indexes = new Map<LocaleTree, LanguageIndex>();

function indexOf(tree: LocaleTree): LanguageIndex {
  const cached = indexes.get(tree);
  if (cached) return cached;
  const flat = new Map<string, string>();
  flatten(tree, '', flat);
  const exact = new Map<string, string>();
  const templates: Template[] = [];
  for (const [fullKey, text] of flat) {
    // Nested translations and empty strings cannot be read back reliably.
    if (text === '' || text.includes('$t(')) continue;
    const key = fullKey.replace(PLURAL_SUFFIX, '');
    const names: string[] = [];
    let literal = 0;
    let source = '';
    let last = 0;
    for (const match of text.matchAll(PLACEHOLDER)) {
      const fixed = text.slice(last, match.index);
      literal += fixed.length;
      source += escapeRegExp(fixed) + '([\\s\\S]+?)';
      names.push(match[1] ?? '');
      last = match.index + match[0].length;
    }
    if (names.length === 0) {
      if (!exact.has(text)) exact.set(text, key);
      continue;
    }
    const rest = text.slice(last);
    literal += rest.length;
    // A template that is nothing but a value would match any text.
    if (literal === 0) continue;
    templates.push({
      key,
      names,
      pattern: new RegExp(`^${source}${escapeRegExp(rest)}$`),
      literal,
    });
  }
  templates.sort((a, b) => b.literal - a.literal);
  const built = { exact, templates };
  indexes.set(tree, built);
  return built;
}

export type Translate = (key: string, options: Record<string, unknown>) => string;

/**
 * `text` (shown in `from`) in the language `t` renders, or null when no translation produced it.
 */
export function retranslateText(text: string, from: LocaleTree, t: Translate): string | null {
  const { exact, templates } = indexOf(from);
  const key = exact.get(text);
  if (key !== undefined) return t(key, {});
  for (const template of templates) {
    const match = template.pattern.exec(text);
    if (!match) continue;
    const values: Record<string, unknown> = {};
    template.names.forEach((name, i) => {
      const value = match[i + 1] ?? '';
      values[name] = name === 'count' && /^\d+$/.test(value) ? Number(value) : value;
    });
    return t(template.key, values);
  }
  return null;
}

export type { Lang };
