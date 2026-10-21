/**
 * On-disk shape of `state/reminders.json` and its validation. `superseded` holds thresholds that
 * were skipped because a later one of the same item was due first (no toast, never listed); a
 * file written without it reads as an empty list.
 */
import type { ReminderEntry, ReminderThreshold, ToastOutcome } from './reminder-types.js';

export interface SupersededRecord {
  key: string;
  recordedAt: string;
}

export interface ReminderStoreData {
  version: 1;
  entries: ReminderEntry[];
  superseded: SupersededRecord[];
}

const THRESHOLDS: readonly number[] = [3, 1, 0];
const OUTCOMES: readonly string[] = ['shown', 'failed', 'unsupported'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const isString = (v: unknown): v is string => typeof v === 'string';
const isInstant = (v: unknown): v is string => isString(v) && !Number.isNaN(Date.parse(v));

function toEntry(raw: unknown): ReminderEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const e = raw as Record<string, unknown>;
  const valid =
    isString(e.key) &&
    e.key !== '' &&
    isString(e.itemId) &&
    isString(e.path) &&
    isString(e.title) &&
    isString(e.due) &&
    DATE_RE.test(e.due) &&
    THRESHOLDS.includes(e.threshold as number) &&
    isInstant(e.firedAt) &&
    typeof e.missed === 'boolean' &&
    OUTCOMES.includes(e.toast as string) &&
    typeof e.dismissed === 'boolean';
  if (!valid) return null;
  // Only the known fields: the file never smuggles extra data into API answers.
  return {
    key: e.key as string,
    itemId: e.itemId as string,
    path: e.path as string,
    title: e.title as string,
    due: e.due as string,
    threshold: e.threshold as ReminderThreshold,
    firedAt: e.firedAt as string,
    missed: e.missed as boolean,
    toast: e.toast as ToastOutcome,
    dismissed: e.dismissed as boolean,
  };
}

function toSuperseded(raw: unknown): SupersededRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  return isString(s.key) && s.key !== '' && isInstant(s.recordedAt)
    ? { key: s.key, recordedAt: s.recordedAt }
    : null;
}

/**
 * The store of a file's text, or null when the file is not a version-1 store at all (corrupt or
 * from an unknown version). Single malformed entries are dropped and counted.
 */
export function parseReminderStore(
  text: string,
): { data: ReminderStoreData; dropped: number } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const root = parsed as Record<string, unknown>;
  if (root.version !== 1 || !Array.isArray(root.entries)) return null;
  const rawSuperseded = Array.isArray(root.superseded) ? root.superseded : [];
  const entries = root.entries.map(toEntry);
  const superseded = rawSuperseded.map(toSuperseded);
  const seen = new Set<string>();
  const keep = <T extends { key: string }>(list: (T | null)[]): T[] =>
    list.filter((x): x is T => x !== null && !seen.has(x.key) && (seen.add(x.key), true));
  const data: ReminderStoreData = {
    version: 1,
    entries: keep(entries),
    superseded: keep(superseded),
  };
  const dropped =
    root.entries.length + rawSuperseded.length - data.entries.length - data.superseded.length;
  return { data, dropped };
}

/** Identity of a task reminder that survives a line move inside the same note. */
export function taskTwinKey(path: string, title: string, due: string, threshold: number): string {
  return JSON.stringify([path, title.normalize('NFC'), due, threshold]);
}
