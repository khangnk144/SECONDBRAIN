/**
 * Daily notes (SPEC F13): `Alt+T` opens `Daily/YYYY-MM-DD.md`. `GET /daily` never creates, so a
 * missing note is created with `POST /daily` (from `Templates/Daily.md`) and opened with the caret
 * at the template's `{{cursor}}`. Another window creating it first (409 EXISTS) just opens it.
 */
import { isApiError } from './api-client';
import { getDaily, postDaily } from './api/capture-daily-api';
import type { VaultPath } from './api/vault-types';
import { todayIso } from './local-day';
import { showOperationError } from './operation-errors';
import { useTabsStore } from './tabs-store';
import { useTreeStore } from './tree-store';

export const DAILY_FOLDER = 'Daily';

/** `Daily/<date>.md` for a `YYYY-MM-DD` date. */
export function dailyPath(date: string): VaultPath {
  return `${DAILY_FOLDER}/${date}.md`;
}

export interface OpenDailyOptions {
  newTab?: boolean;
}

/** One request per date at a time: pressing `Alt+T` twice quickly still creates the note once. */
const inFlight = new Map<string, Promise<VaultPath | null>>();

/** Opens (creating if needed) the daily note of `date`. Returns its path, or null on failure. */
export function openDailyNote(
  date: string = todayIso(),
  options: OpenDailyOptions = {},
): Promise<VaultPath | null> {
  const running = inFlight.get(date);
  if (running) return running;
  const task = openOrCreate(date, options).finally(() => inFlight.delete(date));
  inFlight.set(date, task);
  return task;
}

async function openOrCreate(date: string, options: OpenDailyOptions): Promise<VaultPath | null> {
  const open = (path: VaultPath, cursor?: number | null) => {
    useTabsStore.getState().openNote(path, { newTab: options.newTab, cursor });
    return path;
  };
  try {
    return open((await getDaily(date)).path);
  } catch (error) {
    if (!isApiError(error, 'NOT_FOUND')) {
      showOperationError(error);
      return null;
    }
  }
  try {
    const created = await postDaily(date);
    useTreeStore.getState().scheduleRefresh();
    return open(created.path, created.cursor);
  } catch (error) {
    if (isApiError(error, 'EXISTS')) {
      const existing = error.details.path;
      return open(typeof existing === 'string' ? existing : dailyPath(date));
    }
    showOperationError(error);
    return null;
  }
}
