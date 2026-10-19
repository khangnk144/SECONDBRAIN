import { create } from 'zustand';
import {
  clearCountdowns,
  holdCountdowns,
  setCountdownHovered,
  startCountdown,
  stopCountdown,
} from './toast-countdowns';

/** design.md §5: plain toasts stay 4 s; toasts with an action ("Hoàn tác", "Mở") stay 10 s. */
export const TOAST_MS = 4_000;
export const ACTION_TOAST_MS = 10_000;
export const MAX_TOASTS = 3;

export interface ToastAction {
  /** Translated button label, e.g. "Hoàn tác". */
  label: string;
  run: () => void | Promise<void>;
}

export interface ToastInput {
  /** Translated message. */
  message: string;
  action?: ToastAction;
  /** Defaults to 4 s, or 10 s when the toast carries an action. */
  durationMs?: number;
  /** `error` toasts are announced assertively. */
  tone?: 'info' | 'error';
}

export interface Toast {
  id: number;
  message: string;
  action?: ToastAction;
  tone: 'info' | 'error';
  durationMs: number;
  paused: boolean;
  /** Element that had keyboard focus when the toast appeared (focus goes back there after an action). */
  origin: HTMLElement | null;
}

interface ToastState {
  toasts: Toast[];
  show: (input: ToastInput) => number;
  dismiss: (id: number) => void;
  /** Stops the countdown while the pointer or focus is on the toast. */
  pause: (id: number) => void;
  /** Restarts the countdown with the time that was left. */
  resume: (id: number) => void;
}

let nextId = 1;

function focusedElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  show: (input) => {
    const id = nextId++;
    const durationMs = input.durationMs ?? (input.action ? ACTION_TOAST_MS : TOAST_MS);
    const toast: Toast = {
      id,
      message: input.message,
      action: input.action,
      tone: input.tone ?? 'info',
      durationMs,
      paused: false,
      origin: focusedElement(),
    };
    const next = [...get().toasts, toast];
    // Keep at most three: the oldest goes first.
    while (next.length > MAX_TOASTS) {
      const dropped = next.shift();
      if (dropped) stopCountdown(dropped.id);
    }
    set({ toasts: next });
    startCountdown(id, durationMs, () => get().dismiss(id));
    return id;
  },
  dismiss: (id) => {
    stopCountdown(id);
    set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
  },
  pause: (id) => {
    setCountdownHovered(id, true);
    set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, paused: true } : t)) });
  },
  resume: (id) => {
    setCountdownHovered(id, false);
    set({ toasts: get().toasts.map((t) => (t.id === id ? { ...t, paused: false } : t)) });
  },
}));

/** Shows a toast bottom-right; returns its id. */
export function showToast(input: ToastInput): number {
  return useToastStore.getState().show(input);
}

export function dismissToast(id: number): void {
  useToastStore.getState().dismiss(id);
}

/**
 * Freezes every toast countdown while a modal is open (`ModalFrame` does this); returns the
 * release function. Toasts shown meanwhile start counting only after the release.
 */
export function holdToastTimers(): () => void {
  return holdCountdowns();
}

/** Test helper: removes every toast and timer. */
export function resetToasts(): void {
  clearCountdowns();
  useToastStore.setState({ toasts: [] });
}
