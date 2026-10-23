import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getGraphHistory } from '../../lib/api/graph-api';
import type { GraphResponse } from '../../lib/api/graph-types';
import { compileHistory, weekResponse, type CompiledHistory } from './graph-history-model';
import type { GraphScene } from './graph-scene';
import { buildWeekScene, historyOnlyPositions } from './graph-week-scene';

/** "Phát" moves one week this often. */
export const PLAY_STEP_MS = 700;
/** Week scenes kept for going back and forth. */
const SCENE_CACHE = 12;

/** `GET /graph/history`, again whenever the map data changes (the server caches the log). */
function useCompiledHistory(data: GraphResponse | null): CompiledHistory | null {
  const [compiled, setCompiled] = useState<CompiledHistory | null>(null);
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    getGraphHistory().then(
      (history) => {
        if (!cancelled) setCompiled(compileHistory(history));
      },
      () => {
        // Without history the scrubber stays hidden (or keeps the weeks it had).
      },
    );
    return () => {
      cancelled = true;
    };
  }, [data]);
  return compiled;
}

export interface TimeTravel {
  history: CompiledHistory | null;
  /** Week index on the scrubber; the last one is now (the live map). */
  position: number;
  live: boolean;
  /** The past week's scene, or null on the live map. */
  scene: GraphScene | null;
  /** Whether the scrubber was used: scene changes then fade. */
  used: boolean;
  playing: boolean;
  goTo: (week: number) => void;
  play: () => void;
  stop: () => void;
}

/**
 * The time scrubber's state (SPEC F24.1): the chosen week (null = now) and that week's scene,
 * built from the live scene's positions and cached; "Phát" steps a week every `PLAY_STEP_MS`
 * up to now, never under reduced motion.
 */
export function useGraphTimeTravel(
  data: GraphResponse | null,
  liveScene: GraphScene | null,
  reducedMotion: boolean,
): TimeTravel {
  const history = useCompiledHistory(data);
  const [week, setWeek] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [used, setUsed] = useState(false);
  const last = (history?.weeks.length ?? 1) - 1;
  const position = week === null ? last : Math.min(Math.max(0, week), last);
  const live = position >= last;

  /** A week chosen by the person (slider, keys): stops a playback. */
  const goTo = useCallback(
    (next: number) => {
      setUsed(true);
      setPlaying(false);
      setWeek(next >= last ? null : Math.max(0, next));
    },
    [last],
  );
  const stop = useCallback(() => setPlaying(false), []);
  const play = useCallback(() => {
    if (reducedMotion || last < 1) return;
    setUsed(true);
    // From now, playing starts over at the first week.
    if (position >= last) setWeek(0);
    setPlaying(true);
  }, [reducedMotion, last, position]);

  useEffect(() => {
    if (!playing) return;
    if (reducedMotion) {
      setPlaying(false);
      return;
    }
    // Reaching now (the live map) ends the playback.
    const timer = setTimeout(() => {
      if (position >= last) setPlaying(false);
      else setWeek(position + 1 >= last ? null : position + 1);
    }, PLAY_STEP_MS);
    return () => clearTimeout(timer);
  }, [playing, position, last, reducedMotion]);

  const spots = useMemo(
    () => (history && liveScene ? historyOnlyPositions(history, liveScene.model) : null),
    [history, liveScene],
  );
  const cache = useRef<{ key: unknown[]; scenes: Map<number, GraphScene> }>({
    key: [],
    scenes: new Map(),
  });
  const scene = useMemo(() => {
    if (live || !history || !liveScene || !data || !spots) return null;
    const key = [history, liveScene, data, spots];
    if (key.some((value, i) => cache.current.key[i] !== value)) {
      cache.current = { key, scenes: new Map() };
    }
    const scenes = cache.current.scenes;
    let built = scenes.get(position);
    if (!built) {
      built = buildWeekScene(weekResponse(history, position, data), liveScene, spots);
      if (scenes.size >= SCENE_CACHE) scenes.delete(scenes.keys().next().value as number);
      scenes.set(position, built);
    }
    return built;
  }, [live, history, liveScene, data, spots, position]);

  return { history, position, live, scene, used, playing, goTo, play, stop };
}
