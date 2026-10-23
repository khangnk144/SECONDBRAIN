/**
 * When a vault path held the app's own "Học kỳ này" page (SPEC F25, review L2): one span per
 * path, from the moment the switch put the page there until it was turned off (or moved to a free
 * name), kept in `semester-page.json`. The activity views (Today, the weekly review) leave out the
 * events of that path inside its spans: the page's creation, daily rebuilds and links are the
 * generator's writing, also after the page is off and has become a plain note. Her own edits
 * after the switch went off count as usual. Instants are ISO strings (compared as text, like the
 * event log's `ts`); at most `MAX_SPANS` are kept, newest last.
 */
import { localMidnight } from '../lib/local-date.js';
import { isNotePath } from '../markdown/content-classes.js';
import { linkIdentityKey } from '../markdown/normalize-text.js';
import { isStoredVaultPath } from '../vault/journal-validation.js';
import type { VaultPath } from '../vault/vault-types.js';

export interface GeneratedSpan {
  path: VaultPath;
  /** ISO instant the page was put at `path`. */
  from: string;
  /** ISO instant it stopped being the app's (switch off, moved); null while it still is. */
  to: string | null;
}

export const MAX_SPANS = 20;

const isInstant = (v: unknown): v is string =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v));

/** What a state file written before spans existed still tells (its page and its dates). */
export interface LegacyPage {
  enabled: boolean;
  path: VaultPath | null;
  created: string | null;
  lastGeneratedAt: string | null;
}

/** The spans of a state file; a file without them gets one from its page and its dates. */
export function parseSpans(raw: unknown, legacy: LegacyPage): GeneratedSpan[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((s): s is GeneratedSpan => {
        const span = s as Partial<GeneratedSpan> | null;
        return (
          !!span &&
          isStoredVaultPath(span.path) &&
          isNotePath(span.path as string) &&
          isInstant(span.from) &&
          (span.to === null || isInstant(span.to))
        );
      })
      .map(({ path, from, to }) => ({ path, from, to }))
      .slice(-MAX_SPANS);
  }
  if (legacy.path === null || legacy.created === null) return [];
  const from = localMidnight(legacy.created).toISOString();
  if (legacy.enabled) return [{ path: legacy.path, from, to: null }];
  return legacy.lastGeneratedAt ? [{ path: legacy.path, from, to: legacy.lastGeneratedAt }] : [];
}

/** Every open span ends at `at`. */
export function closeSpans(spans: readonly GeneratedSpan[], at: Date): GeneratedSpan[] {
  const end = at.toISOString();
  return spans.map((s) => (s.to === null ? { ...s, to: end < s.from ? s.from : end } : s));
}

/** The page is the app's at `path` from `at` on (an open span there is kept as it is). */
export function openSpan(
  spans: readonly GeneratedSpan[],
  path: VaultPath,
  at: Date,
): GeneratedSpan[] {
  const key = linkIdentityKey(path);
  if (spans.some((s) => s.to === null && linkIdentityKey(s.path) === key)) return [...spans];
  return [...closeSpans(spans, at), { path, from: at.toISOString(), to: null }].slice(-MAX_SPANS);
}

/** `(path, ts) => true` when the event at `ts` on `path` falls inside a span of that path. */
export function spanMatcher(
  spans: readonly GeneratedSpan[],
): (path: VaultPath, ts: string) => boolean {
  const keyed = spans.map((s) => ({ ...s, key: linkIdentityKey(s.path) }));
  return (path, ts) => {
    let key: string | null = null;
    for (const span of keyed) {
      if (ts < span.from || (span.to !== null && ts > span.to)) continue; // cheap test first
      key ??= linkIdentityKey(path);
      if (key === span.key) return true;
    }
    return false;
  };
}
