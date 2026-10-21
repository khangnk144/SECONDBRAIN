/// <reference lib="dom" />
// The app's own translations, read from web/src/i18n the way the app merges them (core keys plus
// one subtree per `locales/<area>.<lang>.json`), so the language specs name controls by key and
// look for leftover Vietnamese UI text without copying any string into the test.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

type Tree = { [key: string]: string | Tree };
export type Lang = 'vi' | 'en';

const i18nDir = path.join(process.cwd(), 'web', 'src', 'i18n');

function flatten(tree: Tree, prefix: string, out: Map<string, string>): void {
  for (const [key, value] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(full, value);
    else flatten(value, full, out);
  }
}

function load(lang: Lang): Map<string, string> {
  const out = new Map<string, string>();
  flatten(JSON.parse(readFileSync(path.join(i18nDir, `${lang}.json`), 'utf8')) as Tree, '', out);
  const localesDir = path.join(i18nDir, 'locales');
  for (const file of readdirSync(localesDir)) {
    const match = /^([a-z0-9-]+)\.(vi|en)\.json$/.exec(file);
    if (!match || match[2] !== lang) continue;
    const tree = JSON.parse(readFileSync(path.join(localesDir, file), 'utf8')) as Tree;
    flatten(tree, match[1]!, out);
  }
  return out;
}

const strings = { vi: load('vi'), en: load('en') };

/** `t()` of the app for `lang` (interpolation only; plural keys are named in full). */
export function tr(lang: Lang, key: string, vars: Record<string, string | number> = {}): string {
  const value = strings[lang].get(key);
  if (value === undefined) throw new Error(`no ${lang} string for ${key}`);
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars[name] ?? `{{${name}}}`));
}

interface Matcher {
  key: string;
  test: (text: string) => boolean;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const stripTags = (text: string) => text.replace(/<\/?[a-z]+>/g, '');

/**
 * One matcher per Vietnamese UI string that English says differently: a whole text equal to it
 * (placeholders match anything), or – for long strings – containing it.
 */
function vietnameseMatchers(): Matcher[] {
  const matchers: Matcher[] = [];
  for (const [key, vi] of strings.vi) {
    const en = strings.en.get(key);
    if (en === undefined || en === vi) continue;
    const plain = stripTags(vi).trim();
    if (plain === '') continue;
    const parts = plain.split(/\{\{\w+\}\}/);
    // "{{label}}, {{count}}" says nothing in any language: it would match every English text.
    if (parts.join('').replace(/[^\p{L}]/gu, '').length < 2) continue;
    const whole = new RegExp(`^${parts.map(escape).join('.+?')}$`, 's');
    const longest = parts.reduce((a, b) => (b.trim().length > a.trim().length ? b : a), '').trim();
    matchers.push({
      key,
      test: (text) => whole.test(text) || (longest.length >= 15 && text.includes(longest)),
    });
  }
  return matchers;
}
const VIETNAMESE = vietnameseMatchers();
/** Dates written by dayjs's Vietnamese locale (weekdays, "tháng 10"). */
const VIETNAMESE_DATE = /\b(thứ (hai|ba|tư|năm|sáu|bảy)|chủ nhật)\b|\btháng \d{1,2}\b/i;

/**
 * Visible UI text of the page (text nodes and aria-label/title/placeholder), leaving out what
 * she wrote: the editor's content, file and folder names in the tree and tabs, form values.
 */
function visibleUiTexts(page: Page, exclude: string[]) {
  return page.evaluate((skip) => {
    const outside = (el: Element | null) => !el || !skip.some((sel) => el.closest(sel));
    const shown = (el: Element) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden';
    };
    const found: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
      const parent = node.parentElement;
      if (text && parent && outside(parent) && shown(parent)) found.push(text);
    }
    for (const el of document.body.querySelectorAll('[aria-label], [title], [placeholder]')) {
      if (!outside(el) || !shown(el)) continue;
      for (const attr of ['aria-label', 'title', 'placeholder']) {
        const value = el.getAttribute(attr)?.trim();
        if (value) found.push(value);
      }
    }
    return found;
  }, exclude);
}

/** Vietnamese UI strings still on screen, as `text (key)` (empty when every string switched). */
export async function vietnameseLeftovers(page: Page, exclude: string[] = []): Promise<string[]> {
  const texts = await visibleUiTexts(page, [
    '.ProseMirror',
    '[role="treeitem"]',
    '.tab',
    ...exclude,
  ]);
  const left = new Set<string>();
  for (const text of texts) {
    const hit = VIETNAMESE.find((m) => m.test(text));
    if (hit) left.add(`${text} (${hit.key})`);
    else if (VIETNAMESE_DATE.test(text)) left.add(`${text} (date)`);
  }
  return [...left];
}
