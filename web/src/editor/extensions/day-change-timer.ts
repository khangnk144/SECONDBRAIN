import { localDateString } from '../local-dates';

/**
 * Calls `onChange` when the local calendar day changes: a timer just after midnight, plus a check
 * when the page becomes visible again (the machine may have slept through midnight, SPEC §4.7).
 * Returns a function that stops watching.
 */
export function scheduleDayChange(onChange: () => void): () => void {
  let day = localDateString();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const check = () => {
    const now = localDateString();
    if (now === day) return;
    day = now;
    onChange();
  };
  const arm = () => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    timer = setTimeout(() => {
      check();
      arm();
    }, next.getTime() - now.getTime());
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') check();
  };

  arm();
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    if (timer !== undefined) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
