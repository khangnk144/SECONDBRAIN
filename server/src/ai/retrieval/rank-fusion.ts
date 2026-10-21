/**
 * Reciprocal-rank fusion (k = 60) of the BM25 and embedding rankings: each list contributes
 * 1 / (k + rank) per item, so an item both rankings like rises above one only a single ranking
 * likes, without comparing BM25 scores to cosine similarities.
 */
export const RRF_K = 60;

export function reciprocalRankFusion<T>(
  lists: readonly (readonly T[])[],
  keyOf: (item: T) => string,
): T[] {
  const scores = new Map<string, { item: T; score: number; first: number }>();
  let order = 0;
  for (const list of lists) {
    list.forEach((item, index) => {
      const key = keyOf(item);
      const entry = scores.get(key);
      const add = 1 / (RRF_K + index + 1);
      if (entry) entry.score += add;
      else scores.set(key, { item, score: add, first: order++ });
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score || a.first - b.first)
    .map((entry) => entry.item);
}
