import type { GlobalSettings } from './global-settings.js';

/**
 * Owner of the global settings at runtime. Every module reads the same live object through
 * `get()` (template language, reminder time…), so a change applies without a restart.
 */
export interface SettingsStore {
  /** The live settings object; the same object for the whole run, changed in place. */
  get(): GlobalSettings;
  /**
   * Runs `change` on a copy, saves the copy, then copies it into the live object. Updates run one
   * after another, so concurrent requests never lose each other's fields; a failed save leaves the
   * live object as it was. Side effects that must stay in step with the file (the Startup
   * shortcut) run inside `change`.
   */
  update<T>(change: (draft: GlobalSettings) => T | Promise<T>): Promise<T>;
}

type Json = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Makes `target` deep-equal to `source` while keeping `target`'s nested objects. */
function syncInPlace(target: Json, source: Json): void {
  for (const key of Object.keys(target)) if (!(key in source)) delete target[key];
  for (const [key, value] of Object.entries(source)) {
    const current = target[key];
    if (isPlainObject(current) && isPlainObject(value)) syncInPlace(current, value);
    else target[key] = value;
  }
}

export function createSettingsStore(
  live: () => GlobalSettings,
  persist: (settings: GlobalSettings) => Promise<void>,
): SettingsStore {
  let queue: Promise<unknown> = Promise.resolve();

  return {
    get: live,
    update(change) {
      const run = queue.then(async () => {
        const current = live();
        const draft = structuredClone(current);
        const result = await change(draft);
        if (JSON.stringify(draft) !== JSON.stringify(current)) {
          await persist(draft);
          syncInPlace(current, draft);
        }
        return result;
      });
      // A failed update must not block the ones queued after it.
      queue = run.catch(() => undefined);
      return run;
    },
  };
}
