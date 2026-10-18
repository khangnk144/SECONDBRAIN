// Loads `web/src/i18n/lint-allowlist.json` (strings, patterns, ignoreFiles) once per path.
import { readFileSync } from 'node:fs';

/** @typedef {{ strings: Set<string>, patterns: RegExp[], ignoreFiles: string[] }} Allowlist */

/** @type {Map<string, Allowlist>} */
const cache = new Map();

/**
 * @param {string | undefined} allowlistPath absolute path; missing file → empty allowlist
 * @returns {Allowlist}
 */
export function loadAllowlist(allowlistPath) {
  if (!allowlistPath) return { strings: new Set(), patterns: [], ignoreFiles: [] };
  const cached = cache.get(allowlistPath);
  if (cached) return cached;
  /** @type {{ strings?: string[], patterns?: string[], ignoreFiles?: string[] }} */
  let raw = {};
  try {
    raw = JSON.parse(readFileSync(allowlistPath, 'utf8'));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'ENOENT') throw err;
  }
  const list = {
    strings: new Set((raw.strings ?? []).map((s) => s.trim())),
    patterns: (raw.patterns ?? []).map((p) => new RegExp(p, 'u')),
    ignoreFiles: raw.ignoreFiles ?? [],
  };
  cache.set(allowlistPath, list);
  return list;
}

/**
 * @param {Allowlist} list
 * @param {string} text
 */
export function isAllowedText(list, text) {
  const trimmed = text.trim();
  if (trimmed === '') return true;
  if (list.strings.has(trimmed)) return true;
  return list.patterns.some((re) => re.test(trimmed));
}
