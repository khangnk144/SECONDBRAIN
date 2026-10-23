/**
 * Per-vault plugin of the "Học kỳ này" page (SPEC F25). Off by default: without a state file it
 * writes nothing at all (an empty vault stays exactly as F1.1 says). When on, the page is
 * rebuilt after relevant index changes – any note created, deleted or renamed (titles decide the
 * link form), an edit of a course/lecture/project note, a folder change, a finished rebuild –
 * debounced (`debounceMs`) but never later than `maxWaitMs` after the first change, so it is
 * current within 2 s; and once the local day changes ("còn n ngày"). Every run and every action
 * goes through one queue. After each of them, and after any change of the file at the page's
 * path, the registry learns whether that file is the app's page (guarded) or not (a note of
 * hers, or nothing), and the page's spans (activity leaves the generator's events out).
 */
import { errorCodeOf } from '../app-context/app-context-errors.js';
import type { VaultPlugin, VaultPluginHost } from '../app-context/vault-plugins.js';
import { toLocalDate } from '../lib/local-date.js';
import { linkIdentityKey } from '../markdown/normalize-text.js';
import { languageOf } from '../reminders/reminder-messages.js';
import type { ServerEvent } from '../ws/server-events.js';
import { setGeneratedSpans, setManagedPage } from './generated-page-registry.js';
import { createPageGenerator } from './semester-page-generator.js';
import { PAGE_TYPES, typeOf } from './semester-page-rows.js';
import {
  runSemesterAction,
  type SemesterAction,
  type SemesterActionResult,
} from './semester-page-actions.js';
import { createSemesterStateStore, openSemesterState } from './semester-page-state.js';
import type { SemesterPageStatus } from './semester-page-generator.js';

export const SEMESTER_PLUGIN = 'semester-page';
export const REGENERATE_DEBOUNCE_MS = 700;
export const REGENERATE_MAX_WAIT_MS = 1_500;
const DAY_CHECK_MS = 60_000;

export interface PageTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface SemesterPluginOptions {
  timers?: PageTimers;
  debounceMs?: number;
  maxWaitMs?: number;
}

export interface SemesterPageService {
  status(): Promise<SemesterPageStatus>;
  act(action: SemesterAction): Promise<SemesterActionResult>;
  /** Resolves once every queued run and action has finished (tests, shutdown). */
  idle(): Promise<void>;
  close(): Promise<void>;
}

const unref = (handle: NodeJS.Timeout) => {
  handle.unref();
  return handle;
};
const nodeTimers: PageTimers = {
  setTimeout: (callback, ms) => unref(setTimeout(callback, ms)),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
  setInterval: (callback, ms) => unref(setInterval(callback, ms)),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

async function startSemesterPage(
  host: VaultPluginHost,
  options: SemesterPluginOptions,
): Promise<SemesterPageService> {
  const { context, logger } = host;
  const { vault } = context;
  const initial = await openSemesterState(vault.paths.stateDir, (m) => logger.warn(m));
  const store = createSemesterStateStore(initial.file, initial);
  const language = () => languageOf(host.settings().ui.language);
  const generator = createPageGenerator({ context, store, language });
  const timers = options.timers ?? nodeTimers;
  const debounceMs = options.debounceMs ?? REGENERATE_DEBOUNCE_MS;
  const maxWaitMs = options.maxWaitMs ?? REGENERATE_MAX_WAIT_MS;
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  let lastBuiltDay = toLocalDate(context.now());

  /** Guards the page's path only while the file there is the app's page (review M1). */
  const syncRegistry = async () => {
    const s = store.get();
    setGeneratedSpans(vault, s.spans);
    if (closed || !s.enabled || s.path === null) return setManagedPage(vault, null);
    let current = null;
    try {
      current = await generator.readPage(s.path);
    } catch (error) {
      logger.warn(`The semester page could not be read (${errorCodeOf(error)}).`);
    }
    if (closed) return;
    setManagedPage(vault, current !== null && generator.isAppFile(current) ? s.path : null);
  };
  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = queue.then(task).finally(syncRegistry);
    queue = run.catch(() => undefined);
    return run;
  };
  const runAuto = () =>
    void enqueue(async () => {
      if (closed) return;
      lastBuiltDay = toLocalDate(context.now());
      try {
        await generator.regenerate('auto');
      } catch (error) {
        logger.warn(`The semester page was not updated (${errorCodeOf(error)}).`);
      }
    });

  let debounce: unknown = null;
  let maxWait: unknown = null;
  const fire = () => {
    if (debounce !== null) timers.clearTimeout(debounce);
    if (maxWait !== null) timers.clearTimeout(maxWait);
    debounce = maxWait = null;
    runAuto();
  };
  const schedule = () => {
    if (closed || !store.get().enabled) return;
    if (debounce !== null) timers.clearTimeout(debounce);
    debounce = timers.setTimeout(fire, debounceMs);
    maxWait ??= timers.setTimeout(fire, maxWaitMs);
  };

  const pageKey = () => {
    const path = store.get().path;
    return path === null ? null : linkIdentityKey(path);
  };
  const isRelevant = (event: ServerEvent): boolean => {
    switch (event.type) {
      case 'note:created':
      case 'note:deleted':
      case 'note:renamed':
        return linkIdentityKey(event.path) !== pageKey();
      case 'note:changed': {
        const key = linkIdentityKey(event.path);
        if (key === pageKey()) return false;
        const note = context.index.getNote(event.path);
        return generator.watched().has(key) || (note !== null && PAGE_TYPES.has(typeOf(note)));
      }
      case 'folder:changed':
        return true;
      case 'index:progress':
        return event.phase === 'done';
      default:
        return false;
    }
  };
  const touchesPage = (event: ServerEvent): boolean => {
    const key = pageKey();
    if (key === null) return false;
    const paths: (string | undefined)[] = [];
    if (event.type === 'note:renamed') paths.push(event.path, event.oldPath);
    else if (event.type === 'note:created' || event.type === 'note:changed') paths.push(event.path);
    else if (event.type === 'note:deleted') paths.push(event.path);
    return paths.some((p) => p !== undefined && linkIdentityKey(p) === key);
  };
  const unsubscribe = context.onEvent((event) => {
    if (isRelevant(event)) schedule();
    if (touchesPage(event)) void enqueue(async () => undefined); // the registry follows the file
  });
  const dayCheck = timers.setInterval(() => {
    if (toLocalDate(context.now()) !== lastBuiltDay) schedule();
  }, DAY_CHECK_MS);

  await syncRegistry();
  // Catch up with whatever changed while the app was closed.
  if (initial.enabled) runAuto();

  return {
    status: () => enqueue(() => generator.status()),
    act: (action) => enqueue(() => runSemesterAction(action, { context, store, generator })),
    idle: () => queue.then(() => undefined),
    async close() {
      if (closed) return;
      closed = true;
      unsubscribe();
      timers.clearInterval(dayCheck);
      if (debounce !== null) timers.clearTimeout(debounce);
      if (maxWait !== null) timers.clearTimeout(maxWait);
      await queue;
      setManagedPage(vault, null);
      setGeneratedSpans(vault, []);
    },
  };
}

/** The host attaches the started instance as `SEMESTER_PLUGIN`. */
export function createSemesterPagePlugin(
  options: SemesterPluginOptions = {},
): VaultPlugin<SemesterPageService> {
  return { name: SEMESTER_PLUGIN, start: (host) => startSemesterPage(host, options) };
}
