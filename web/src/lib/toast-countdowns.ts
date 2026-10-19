/**
 * Countdowns of the toasts. A toast's clock runs only while nobody is looking at it: it stops
 * while the pointer or focus is on that toast, and every clock stops while a modal dialog is open
 * (the dialog covers the toasts, so an undo must not expire unseen behind it).
 */
interface Countdown {
  handle: ReturnType<typeof setTimeout> | null;
  remainingMs: number;
  startedAt: number;
  hovered: boolean;
  onExpire: () => void;
}

const countdowns = new Map<number, Countdown>();
let holds = 0;

function sync(countdown: Countdown): void {
  const shouldRun = !countdown.hovered && holds === 0;
  if (shouldRun && countdown.handle === null) {
    countdown.startedAt = Date.now();
    countdown.handle = setTimeout(countdown.onExpire, countdown.remainingMs);
  } else if (!shouldRun && countdown.handle !== null) {
    clearTimeout(countdown.handle);
    countdown.handle = null;
    countdown.remainingMs = Math.max(0, countdown.remainingMs - (Date.now() - countdown.startedAt));
  }
}

export function startCountdown(id: number, ms: number, onExpire: () => void): void {
  const countdown: Countdown = {
    handle: null,
    remainingMs: ms,
    startedAt: Date.now(),
    hovered: false,
    onExpire,
  };
  countdowns.set(id, countdown);
  sync(countdown);
}

export function stopCountdown(id: number): void {
  const countdown = countdowns.get(id);
  if (countdown?.handle) clearTimeout(countdown.handle);
  countdowns.delete(id);
}

export function setCountdownHovered(id: number, hovered: boolean): void {
  const countdown = countdowns.get(id);
  if (!countdown) return;
  countdown.hovered = hovered;
  sync(countdown);
}

/** Stops every toast clock until the returned release is called (nested holds are counted). */
export function holdCountdowns(): () => void {
  holds += 1;
  countdowns.forEach(sync);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    countdowns.forEach(sync);
  };
}

export function clearCountdowns(): void {
  for (const id of [...countdowns.keys()]) stopCountdown(id);
  holds = 0;
}
