// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { lcsPairs, longestIncreasing, myersPairs, uniquePairs, type Pair } from './sequence-diff';

/** A small deterministic PRNG (mulberry32). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function expectCommonSubsequence(a: Int32Array, b: Int32Array, pairs: readonly Pair[]): void {
  pairs.forEach(([i, j], k) => {
    expect(a[i]).toBe(b[j]);
    if (k > 0) {
      expect(i).toBeGreaterThan(pairs[k - 1]![0]);
      expect(j).toBeGreaterThan(pairs[k - 1]![1]);
    }
  });
}

describe('sequence diff', () => {
  it('Myers finds a longest common subsequence, like the exact LCS', () => {
    const next = random(7);
    for (let run = 0; run < 2000; run += 1) {
      const alphabet = 1 + Math.floor(next() * 5);
      const a = Int32Array.from({ length: Math.floor(next() * 14) }, () =>
        Math.floor(next() * alphabet),
      );
      const b = Int32Array.from({ length: Math.floor(next() * 14) }, () =>
        Math.floor(next() * alphabet),
      );
      const exact = lcsPairs(a, b);
      const myers = myersPairs(a, b, 64);
      expectCommonSubsequence(a, b, exact);
      expectCommonSubsequence(a, b, myers!);
      expect(myers!.length).toBe(exact.length);
    }
  });

  it('Myers gives up beyond the distance budget', () => {
    const a = Int32Array.from({ length: 100 }, (_, i) => i);
    const b = Int32Array.from({ length: 100 }, (_, i) => i + 1000);
    expect(myersPairs(a, b, 50)).toBeNull();
    expect(myersPairs(a, a, 0)).toHaveLength(100);
  });

  it('pairs elements unique on both sides, and keeps their longest increasing run', () => {
    const a = Int32Array.from([1, 2, 2, 3, 4, 5]);
    const b = Int32Array.from([5, 1, 3, 2, 4]);
    expect(uniquePairs(a, b)).toEqual([
      [0, 1],
      [3, 2],
      [4, 4],
      [5, 0],
    ]);
    expect(longestIncreasing(uniquePairs(a, b))).toEqual([
      [0, 1],
      [3, 2],
      [4, 4],
    ]);
  });
});
