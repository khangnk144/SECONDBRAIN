// Fails when vi.json and en.json differ in keys, {{placeholders}} or have empty strings.
// Plural variants (_zero/_one/_two/_few/_many/_other) are grouped: Vietnamese needs only `_other`.
// Usage: tsx scripts/check-i18n-parity.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { appRoot, isMainModule } from './lib/script-utils.js';

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
const PLACEHOLDER = /\{\{\s*([\w.]+)[^}]*\}\}/g;

/** Flattens nested objects to dotted keys; non-string leaves are reported as problems. */
export function flattenLocale(
  obj: Json,
  prefix = '',
  problems: string[] = [],
  name = '',
): Map<string, string> {
  const out = new Map<string, string>();
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    problems.push(`${name}: root must be an object`);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const [ck, cv] of flattenLocale(v, key, problems, name)) out.set(ck, cv);
    } else problems.push(`${name}: "${key}" must be a string or an object`);
  }
  return out;
}

function placeholders(text: string): Set<string> {
  return new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? ''));
}

/** Groups plural variants under their base key; value = union of placeholders. */
function groupByBaseKey(flat: Map<string, string>): Map<string, Set<string>> {
  const groups = new Map<string, Set<string>>();
  for (const [key, value] of flat) {
    const base = key.replace(PLURAL_SUFFIX, '');
    const set = groups.get(base) ?? new Set<string>();
    for (const p of placeholders(value)) set.add(p);
    groups.set(base, set);
  }
  return groups;
}

const sameSet = (a: Set<string>, b: Set<string>) =>
  a.size === b.size && [...a].every((x) => b.has(x));

/** Returns human-readable problems; empty array = parity holds. */
export function compareLocales(vi: Json, en: Json): string[] {
  const problems: string[] = [];
  const viFlat = flattenLocale(vi, '', problems, 'vi.json');
  const enFlat = flattenLocale(en, '', problems, 'en.json');
  for (const [name, flat] of [
    ['vi.json', viFlat],
    ['en.json', enFlat],
  ] as const) {
    for (const [key, value] of flat) {
      if (value.trim() === '') problems.push(`${name}: "${key}" is empty`);
    }
  }
  const viGroups = groupByBaseKey(viFlat);
  const enGroups = groupByBaseKey(enFlat);
  for (const key of viGroups.keys())
    if (!enGroups.has(key)) problems.push(`en.json: missing "${key}"`);
  for (const key of enGroups.keys())
    if (!viGroups.has(key)) problems.push(`vi.json: missing "${key}"`);
  for (const [key, viVars] of viGroups) {
    const enVars = enGroups.get(key);
    if (enVars && !sameSet(viVars, enVars)) {
      problems.push(`"${key}": placeholders differ (vi: {${[...viVars]}} en: {${[...enVars]}})`);
    }
  }
  return problems;
}

/** Reads `<root>/web/src/i18n/{vi,en}.json` and compares them. */
export function checkLocaleFiles(root = appRoot): string[] {
  const dir = path.join(root, 'web', 'src', 'i18n');
  const read = (name: string): Json | undefined => {
    let text: string;
    try {
      text = readFileSync(path.join(dir, name), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
    return JSON.parse(text) as Json;
  };
  const vi = read('vi.json');
  const en = read('en.json');
  const missing = [vi === undefined && 'vi.json', en === undefined && 'en.json'].filter(Boolean);
  if (missing.length > 0) return missing.map((m) => `${m}: file not found in web/src/i18n`);
  return compareLocales(vi as Json, en as Json);
}

if (isMainModule(import.meta.url)) {
  const problems = checkLocaleFiles();
  if (problems.length > 0) {
    console.error('i18n parity check failed:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log('check-i18n-parity: ok');
}
