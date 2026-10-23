import { useEffect, useMemo, useState } from 'react';
import type { GraphModel } from './graph-model';
import { recentNodeIndices } from './graph-pulse';

/** A note stops pulsing at most this long after its 24 hours are over. */
export const RECENT_REFRESH_MS = 60_000;

export interface GraphRecent {
  /** Indices into `model.nodes` for the canvas pulse, or null. */
  indices: Int32Array | null;
  /** The same notes by id, for the side panel's "sửa trong 24 giờ". */
  ids: ReadonlySet<string> | null;
}

const NONE: GraphRecent = { indices: null, ids: null };

/** Notes of `model` edited in the last 24 h (SPEC F24.3); none when `enabled` is false. */
export function useGraphRecent(model: GraphModel | null, enabled: boolean): GraphRecent {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), RECENT_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  return useMemo(() => {
    if (!model || !enabled) return NONE;
    const indices = recentNodeIndices(model, now);
    if (!indices) return NONE;
    return { indices, ids: new Set(Array.from(indices, (i) => model.nodes[i]?.id ?? '')) };
  }, [model, enabled, now]);
}
