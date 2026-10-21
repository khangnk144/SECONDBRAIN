/**
 * "AI vừa chạm" (SPEC F34, design.md screen 6): every `ai:touched { source, outputs }` the server
 * sends after an MCP ingest is kept for the window's life (the last few), so opening the brain map
 * shortly after still shows it. The map plays an event once: the source appears, a signal travels
 * to each output in order, 150 ms apart, and each output stays highlighted for 10 s from the moment
 * the map lit it. The planned sequence (`[{ path, at }]`, wall-clock ms) lives here so the side
 * panel, the canvas and tests read the same timeline.
 */
import { create } from 'zustand';
import type { VaultPath } from '../../lib/api/vault-types';
import { samePath } from '../../lib/vault-paths';
import { subscribeServerEvent } from '../../lib/ws/server-event-bus';
import { SIGNAL_MS } from './graph-motion';

/** The source grows in at the canvas edge and settles before the first signal leaves. */
export const AI_TOUCH_ENTRY_MS = 600;
/** One signal's travel from the source to an output (same pace as a click's signal). */
export const AI_TOUCH_TRAVEL_MS = SIGNAL_MS;
/** Outputs light up one after another, this far apart (SPEC F34). */
export const AI_TOUCH_STEP_MS = 150;
/** How long each output stays highlighted after it lit up (SPEC F34). */
export const AI_TOUCH_HOLD_MS = 10_000;
/** Events kept per window (newest wins). */
export const MAX_AI_TOUCH_EVENTS = 5;

export interface AiTouchStep {
  path: VaultPath;
  /** Wall-clock ms when the output lights up; it stays lit until `at + AI_TOUCH_HOLD_MS`. */
  at: number;
}

export interface AiTouchPlayback {
  /** Wall-clock ms when the source starts to appear. */
  startedAt: number;
  reducedMotion: boolean;
  /** Outputs drawn on the map, in the AI's order, with the time each lights up. */
  sequence: AiTouchStep[];
  /** The last output has lit (the next event may start). */
  litDoneAt: number;
  /** Every highlight of this event is over. */
  endsAt: number;
}

export interface AiTouchEvent {
  id: number;
  source: VaultPath;
  /** Every output the AI wrote, in its order (duplicates removed). */
  outputs: VaultPath[];
  receivedAt: number;
  /** The map already refetched its data once for this event. */
  refetched: boolean;
  /** Null until the map has shown the event. */
  playback: AiTouchPlayback | null;
}

interface AiTouchState {
  events: AiTouchEvent[];
}

export const useAiTouchStore = create<AiTouchState>(() => ({ events: [] }));

let nextId = 1;

function uniquePaths(paths: readonly VaultPath[]): VaultPath[] {
  const out: VaultPath[] = [];
  for (const path of paths) {
    if (typeof path === 'string' && path !== '' && !out.some((p) => samePath(p, path))) {
      out.push(path);
    }
  }
  return out;
}

export function recordAiTouch(source: VaultPath, outputs: readonly VaultPath[], now = Date.now()) {
  const event: AiTouchEvent = {
    id: nextId++,
    source,
    outputs: uniquePaths(outputs),
    receivedAt: now,
    refetched: false,
    playback: null,
  };
  useAiTouchStore.setState((state) => ({
    events: [...state.events, event].slice(-MAX_AI_TOUCH_EVENTS),
  }));
}

/** Pure timeline of one playback: `startedAt` plus the entry, travel and 150 ms steps. */
export function planAiTouch(
  drawnOutputs: readonly VaultPath[],
  startedAt: number,
  reducedMotion: boolean,
): AiTouchPlayback {
  const sequence = drawnOutputs.map((path, i) => ({
    path,
    at: reducedMotion
      ? startedAt
      : startedAt + AI_TOUCH_ENTRY_MS + i * AI_TOUCH_STEP_MS + AI_TOUCH_TRAVEL_MS,
  }));
  const litDoneAt = sequence.at(-1)?.at ?? startedAt;
  return { startedAt, reducedMotion, sequence, litDoneAt, endsAt: litDoneAt + AI_TOUCH_HOLD_MS };
}

/** Events waiting for the map, oldest first. */
export function pendingAiTouches(events: readonly AiTouchEvent[]): AiTouchEvent[] {
  return events.filter((event) => event.playback === null);
}

/** Playbacks whose highlights are not over at `now`. */
export function activeAiTouches(events: readonly AiTouchEvent[], now: number): AiTouchEvent[] {
  return events.filter((event) => event.playback !== null && now < event.playback.endsAt);
}

export function markAiTouchesRefetched(ids: readonly number[]): void {
  useAiTouchStore.setState((state) => ({
    events: state.events.map((e) => (ids.includes(e.id) ? { ...e, refetched: true } : e)),
  }));
}

/**
 * Starts the playback of pending events in order. With motion, each event waits until the
 * previous one lit its last output, so two ingests never tangle; under reduced motion all light
 * at once. `isDrawn` leaves out outputs the map cannot show (they stay in the panel's list).
 */
export function playAiTouches(
  ids: readonly number[],
  options: { now: number; reducedMotion: boolean; isDrawn: (path: VaultPath) => boolean },
): void {
  const { now, reducedMotion, isDrawn } = options;
  useAiTouchStore.setState((state) => {
    let free = now;
    for (const event of activeAiTouches(state.events, now)) {
      if (!reducedMotion) free = Math.max(free, event.playback?.litDoneAt ?? now);
    }
    const events = state.events.map((event) => {
      if (event.playback !== null || !ids.includes(event.id)) return event;
      const playback = planAiTouch(event.outputs.filter(isDrawn), free, reducedMotion);
      if (!reducedMotion) free = playback.litDoneAt;
      return { ...event, playback };
    });
    return { events };
  });
}

/** "Ẩn danh sách": forgets every kept event. */
export function dismissAiTouches(): void {
  useAiTouchStore.setState({ events: [] });
}

/** Paths lit at `now` across events, in the order they lit (for tests and the canvas). */
export function litAiTouchPaths(events: readonly AiTouchEvent[], now: number): VaultPath[] {
  return events
    .flatMap((event) => event.playback?.sequence ?? [])
    .filter((step) => step.at <= now && now < step.at + AI_TOUCH_HOLD_MS)
    .sort((a, b) => a.at - b.at)
    .map((step) => step.path);
}

/** Listens for `ai:touched` for the window's life (wired at app start). */
export function startAiTouchSync(): () => void {
  return subscribeServerEvent('ai:touched', (event) => {
    if (typeof event.source !== 'string' || !Array.isArray(event.outputs)) return;
    recordAiTouch(event.source, event.outputs);
  });
}

/** Test helper. */
export function resetAiTouchStore(): void {
  nextId = 1;
  useAiTouchStore.setState({ events: [] });
}
