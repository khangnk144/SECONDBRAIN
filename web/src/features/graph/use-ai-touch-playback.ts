import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VaultPath } from '../../lib/api/vault-types';
import { baseName } from '../../lib/vault-paths';
import {
  activeAiTouches,
  markAiTouchesRefetched,
  pendingAiTouches,
  playAiTouches,
  useAiTouchStore,
  type AiTouchEvent,
} from './graph-ai-touch';
import type { AiTouchPlay } from './graph-ai-touch-effect';
import { indexOfPath, type GraphModel } from './graph-model';

/** Title of a path on the map, else its file name (a source not on the map, a page not drawn). */
export function aiTouchTitle(model: GraphModel | null, path: VaultPath): string {
  const node = model?.nodes[model ? indexOfPath(model, path) : -1];
  return node?.title ?? baseName(path).replace(/\.md$/i, '');
}

interface Waiting {
  /** The map the refetch was asked from: play once a newer one is on screen. */
  model: GraphModel;
  failed: boolean;
}

export interface AiTouchPlaybackState {
  /** Playbacks for the canvas (those whose highlights are not over). */
  plays: AiTouchPlay[];
  /** Text of the polite live region, set once when events start playing. */
  announcement: string;
}

/**
 * Plays "AI vừa chạm" events on the open map. An event naming a source or output the map does
 * not have yet (the ingest's pages were just written) makes the map refetch once; the event then
 * plays on the refreshed map, whatever is still missing. Expired playbacks leave the canvas.
 */
export function useAiTouchPlayback(
  model: GraphModel | null,
  reducedMotion: boolean,
  reload: () => Promise<boolean>,
): AiTouchPlaybackState {
  const { t } = useTranslation();
  const events = useAiTouchStore((state) => state.events);
  const [announcement, setAnnouncement] = useState('');
  const [tick, setTick] = useState(0);
  const waiting = useRef<Waiting | null>(null);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    const pending = pendingAiTouches(events);
    if (!model || pending.length === 0) return;
    const drawn = (path: VaultPath) => indexOfPath(model, path) >= 0;
    const incomplete = (event: AiTouchEvent) =>
      !event.refetched && (!drawn(event.source) || !event.outputs.every(drawn));
    const missing = pending.filter(incomplete);
    if (missing.length > 0) {
      markAiTouchesRefetched(missing.map((event) => event.id));
      const wait: Waiting = { model, failed: false };
      waiting.current = wait;
      void reloadRef.current().then((ok) => {
        if (ok || waiting.current !== wait) return;
        // The refetch failed: play on the map that is there.
        wait.failed = true;
        setTick((value) => value + 1);
      });
      return;
    }
    const wait = waiting.current;
    if (wait && wait.model === model && !wait.failed) return;
    waiting.current = null;
    playAiTouches(
      pending.map((event) => event.id),
      { now: Date.now(), reducedMotion, isDrawn: drawn },
    );
    setAnnouncement(
      pending
        .map((event) =>
          t('graph.aiTouch.announce', {
            count: event.outputs.length,
            title: aiTouchTitle(model, event.source),
          }),
        )
        .join(' '),
    );
  }, [events, model, reducedMotion, t, tick]);

  const plays = useMemo(
    () =>
      activeAiTouches(events, Date.now()).map((event): AiTouchPlay => ({
        id: event.id,
        source: event.source,
        sourceTitle: aiTouchTitle(model, event.source),
        // Filtered by `activeAiTouches`.
        playback: event.playback!,
      })),
    // `tick` re-reads the clock when a playback ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, model, tick],
  );

  // Wake up when the next playback is over, so its highlights leave the canvas.
  useEffect(() => {
    if (plays.length === 0) return;
    const next = Math.min(...plays.map((play) => play.playback.endsAt));
    const handle = setTimeout(() => setTick((value) => value + 1), Math.max(0, next - Date.now()));
    return () => clearTimeout(handle);
  }, [plays]);

  return { plays, announcement };
}
