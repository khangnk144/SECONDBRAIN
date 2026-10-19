/**
 * Common-subsequence helpers over integer sequences (class ids of nodes). Each returns the pairs
 * `[index in a, index in b]` of equal elements, increasing in both indexes.
 */
export type Pair = readonly [number, number];

/** An exact longest common subsequence; quadratic, for small inputs only. */
export function lcsPairs(a: Int32Array, b: Int32Array): Pair[] {
  const rows = a.length;
  const width = b.length + 1;
  const table = new Uint32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = width - 2; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const pairs: Pair[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < width - 1) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i += 1;
    else j += 1;
  }
  return pairs;
}

/**
 * A longest common subsequence by Myers' O((N+M)·D) diff, or null when more than `maxDistance`
 * insertions and deletions separate the inputs (time and memory stay bounded).
 */
export function myersPairs(a: Int32Array, b: Int32Array, maxDistance: number): Pair[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxDistance);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)
          ? v[offset + k + 1]!
          : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, offset, n, m);
    }
  }
  return null;
}

function backtrack(trace: readonly Int32Array[], offset: number, n: number, m: number): Pair[] {
  const pairs: Pair[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const v = trace[d]!;
    const k = x - y;
    let previousX = 0;
    let previousY = 0;
    if (d > 0) {
      const down = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!);
      const previousK = down ? k + 1 : k - 1;
      previousX = v[offset + previousK]!;
      previousY = previousX - previousK;
    }
    while (x > previousX && y > previousY) {
      x -= 1;
      y -= 1;
      pairs.push([x, y]);
    }
    x = previousX;
    y = previousY;
  }
  return pairs.reverse();
}

/** Pairs of elements that occur exactly once in each input (the anchors of a patience diff). */
export function uniquePairs(a: Int32Array, b: Int32Array): Pair[] {
  const counts = new Map<number, { inA: number; inB: number; i: number; j: number }>();
  a.forEach((id, i) => {
    const entry = counts.get(id);
    if (entry) entry.inA += 1;
    else counts.set(id, { inA: 1, inB: 0, i, j: -1 });
  });
  b.forEach((id, j) => {
    const entry = counts.get(id);
    if (entry) {
      entry.inB += 1;
      entry.j = j;
    }
  });
  const pairs: Pair[] = [];
  for (const { inA, inB, i, j } of counts.values()) if (inA === 1 && inB === 1) pairs.push([i, j]);
  return pairs.sort((x, y) => x[0] - y[0]);
}

/** The longest subsequence of pairs (ordered by first index) whose second index increases. */
export function longestIncreasing(pairs: readonly Pair[]): Pair[] {
  const tails: number[] = [];
  const previous = new Int32Array(pairs.length).fill(-1);
  pairs.forEach(([, j], k) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]!]![1] < j) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[k] = tails[lo - 1]!;
    tails[lo] = k;
  });
  const out: Pair[] = [];
  for (let k = tails[tails.length - 1] ?? -1; k !== -1; k = previous[k]!) out.push(pairs[k]!);
  return out.reverse();
}
