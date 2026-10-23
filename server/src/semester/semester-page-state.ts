/**
 * `<vault>/.secondbrain/state/semester-page.json` (SPEC F25, durable state §4.13, in backups):
 * whether the page is on, where it lives and which revisions the app wrote. Missing file = off,
 * and nothing is written until she turns the page on (an empty vault stays as F1.1 says). The
 * file is read back defensively: anything that is not the shape written here counts as off.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile } from '../fs/atomic-write-file.js';
import { isNotePath } from '../markdown/content-classes.js';
import { isStoredVaultPath } from '../vault/journal-validation.js';
import type { VaultPath } from '../vault/vault-types.js';
import { parseSpans, type GeneratedSpan } from './semester-page-spans.js';

export const SEMESTER_STATE_FILE = 'semester-page.json';

export interface SemesterPageState {
  enabled: boolean;
  /** The page's vault path (chosen in the UI language when it was turned on); null before. */
  path: VaultPath | null;
  /** Revision of the bytes the app last wrote; any other revision on disk means "edited". */
  lastRevision: string | null;
  /**
   * Revision of a write in progress: stored before the page is written, so a crash between the
   * page and this file still recognises the page as the app's own.
   */
  nextRevision: string | null;
  /** ISO instant of the last write of the page. */
  lastGeneratedAt: string | null;
  /** `created:` of the page (local date of its first creation). */
  created: string | null;
  /** When which path held the app's page (activity leaves those events out, review L2). */
  spans: GeneratedSpan[];
}

export const DEFAULT_STATE: SemesterPageState = Object.freeze({
  enabled: false,
  path: null,
  lastRevision: null,
  nextRevision: null,
  lastGeneratedAt: null,
  created: null,
  spans: [],
});

const REVISION = /^[0-9a-f]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const pick = <T>(value: unknown, ok: (v: unknown) => v is T): T | null =>
  ok(value) ? value : null;
const isRevision = (v: unknown): v is string => typeof v === 'string' && REVISION.test(v);
const isNote = (v: unknown): v is string => isStoredVaultPath(v) && isNotePath(v);
const isDate = (v: unknown): v is string => typeof v === 'string' && DATE.test(v);
const isInstant = (v: unknown): v is string =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v));

export function parseSemesterState(raw: unknown): SemesterPageState {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_STATE };
  const value = raw as Record<string, unknown>;
  const pagePath = pick(value.path, isNote);
  const enabled = value.enabled === true && pagePath !== null;
  const lastGeneratedAt = pick(value.lastGeneratedAt, isInstant);
  const created = pick(value.created, isDate);
  return {
    enabled,
    path: pagePath,
    lastRevision: pick(value.lastRevision, isRevision),
    nextRevision: pick(value.nextRevision, isRevision),
    lastGeneratedAt,
    created,
    spans: parseSpans(value.spans, { enabled, path: pagePath, created, lastGeneratedAt }),
  };
}

export interface SemesterStateStore {
  get(): SemesterPageState;
  /** Writes the merged state atomically; the copy in memory changes only after the write. */
  update(change: Partial<SemesterPageState>): Promise<SemesterPageState>;
}

export async function openSemesterState(
  stateDir: string,
  warn: (message: string) => void,
): Promise<SemesterPageState & { file: string }> {
  const file = path.join(stateDir, SEMESTER_STATE_FILE);
  try {
    const text = await readFile(file, 'utf8');
    try {
      return { ...parseSemesterState(JSON.parse(text)), file };
    } catch {
      warn('The semester page state is not valid JSON; the page counts as off.');
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      warn(`The semester page state could not be read (${(error as NodeJS.ErrnoException).code}).`);
    }
  }
  return { ...DEFAULT_STATE, spans: [], file };
}

export function createSemesterStateStore(
  file: string,
  initial: SemesterPageState,
): SemesterStateStore {
  const { file: _file, ...state } = initial as SemesterPageState & { file?: string };
  let current: SemesterPageState = state; // the state file never names its own path
  return {
    get: () => current,
    async update(change) {
      const next = { ...current, ...change };
      await atomicWriteFile(file, `${JSON.stringify(next, null, 2)}\n`);
      current = next;
      return next;
    },
  };
}
