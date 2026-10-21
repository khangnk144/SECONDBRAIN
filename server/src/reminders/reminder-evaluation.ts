/**
 * One scheduler pass (SPEC F17): plan → record → toast → record outcomes → broadcast. The store
 * is written before any toast, so a crash in between loses one toast rather than repeating it
 * after the restart; entries start as `failed` until the deliverer says otherwise.
 */
import type { AppContext } from '../app-context/create-app-context.js';
import { errorCodeOf } from '../app-context/app-context-errors.js';
import type { GlobalSettings } from '../config/global-settings.js';
import type { AppLogger } from '../logging/rotating-file-logger.js';
import { remindableItems } from './reminder-items.js';
import {
  languageOf,
  reminderToast,
  summaryToast,
  type ReminderLanguage,
  type ToastContent,
} from './reminder-messages.js';
import { planReminders, type PlannedReminder } from './reminder-plan.js';
import type { ReminderStore } from './reminder-store.js';
import { DEFAULT_CLOCK_TIME, parseReminderTime, reminderTimeOf } from './reminder-time.js';
import type { ReminderEntry, ToastOutcome } from './reminder-types.js';
import type { ToastDeliverer } from './windows-toast.js';

/** More reminders than this in one pass become a single summary toast. */
export const BURST_LIMIT = 3;

export interface EvaluationDeps {
  context: AppContext;
  store: ReminderStore;
  deliverer: ToastDeliverer;
  settings: () => GlobalSettings;
  port: number;
  logger: AppLogger;
  now: () => Date;
  /** False once the plugin is closing: nothing is announced for a vault that is going away. */
  isOpen: () => boolean;
}

async function safeDeliver(deps: EvaluationDeps, toast: ToastContent): Promise<ToastOutcome> {
  try {
    return await deps.deliverer.deliver(toast);
  } catch (error) {
    deps.logger.warn(`Reminder toast failed (${errorCodeOf(error)}).`);
    return 'failed';
  }
}

async function deliverAll(
  deps: EvaluationDeps,
  fire: readonly PlannedReminder[],
  language: ReminderLanguage,
): Promise<ToastOutcome[]> {
  if (fire.length > BURST_LIMIT) {
    const outcome = await safeDeliver(deps, summaryToast(fire.length, language, deps.port));
    return fire.map(() => outcome);
  }
  const outcomes: ToastOutcome[] = [];
  for (const planned of fire) {
    const { item, threshold, overdue } = planned;
    const toast = reminderToast(
      { title: item.title, path: item.path, due: item.date, threshold, overdue },
      language,
      deps.port,
    );
    outcomes.push(await safeDeliver(deps, toast));
  }
  return outcomes;
}

export async function evaluateReminders(deps: EvaluationDeps): Promise<ReminderEntry[]> {
  const { context, store, logger } = deps;
  // Without the recorded keys every reminder would look new (and fire again): wait for them.
  if (!(await store.ensureLoaded())) return [];
  await context.settled();
  const now = deps.now();
  const settings = deps.settings();
  const time = parseReminderTime(reminderTimeOf(settings)) ?? DEFAULT_CLOCK_TIME;
  const plan = planReminders({
    vaultId: context.vault.id,
    items: remindableItems(context),
    now,
    time,
    isRecorded: (key, item, threshold) =>
      store.has(key) ||
      (item.kind === 'task' && store.hasTaskTwin(item.path, item.title, item.date, threshold)),
  });
  if (plan.fire.length === 0 && plan.superseded.length === 0) return [];

  const firedAt = now.toISOString();
  const entries: ReminderEntry[] = plan.fire.map(({ key, item, threshold, missed }) => ({
    key,
    itemId: item.id,
    path: item.path,
    title: item.title,
    due: item.date,
    threshold,
    firedAt,
    missed,
    // Until the deliverer answers (a crash before that means it was never shown).
    toast: deps.deliverer.supported ? 'failed' : 'unsupported',
    dismissed: false,
  }));
  await store.update((draft) => {
    draft.entries.push(...entries);
    for (const { key } of plan.superseded) draft.superseded.push({ key, recordedAt: firedAt });
  });
  if (entries.length === 0) return [];

  const outcomes = await deliverAll(deps, plan.fire, languageOf(settings.ui?.language));
  const final = entries.map((entry, i) => ({ ...entry, toast: outcomes[i] ?? 'failed' }));
  const byKey = new Map(final.map((entry) => [entry.key, entry.toast]));
  try {
    await store.update((draft) => {
      for (const entry of draft.entries) entry.toast = byKey.get(entry.key) ?? entry.toast;
    });
  } catch (error) {
    // The reminders are recorded (no repeat); only the toast outcome stays "failed" on disk.
    logger.warn(`Recording reminder toast outcomes failed (${errorCodeOf(error)}).`);
  }
  const missed = final.filter((e) => e.missed).length;
  const shown = final.filter((e) => e.toast === 'shown').length;
  logger.info(
    `Reminders: ${final.length} fired (${missed} caught up, ${plan.superseded.length} superseded, ` +
      `${final.length > BURST_LIMIT ? 'one summary toast' : `${shown} toasts shown`}).`,
  );
  if (deps.isOpen())
    for (const reminder of final) context.hub.broadcast({ type: 'reminder', reminder });
  return final;
}
