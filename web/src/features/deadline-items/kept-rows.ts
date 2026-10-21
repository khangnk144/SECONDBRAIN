/**
 * Rows ticked during a visit stay on screen, checked and dimmed, so an accidental tick can be
 * unticked right there (design.md screen 1: "Gửi email thầy (đã xong)"). The server's fresh lists
 * leave done tasks out; these helpers put the ones ticked during this visit back where they were.
 * Shared by Today's "Hôm nay" and the Tasks view.
 */

export interface KeptRow<T> {
  entry: T;
  /** Id of the row it followed when it was ticked (null: it was the first). */
  after: string | null;
}

export type KeptRows<T> = ReadonlyMap<string, KeptRow<T>>;

interface Row {
  id: string;
  done: boolean;
}

/**
 * `kept` once the server confirmed that row `id` of `rows` (as shown) is now `done`; unchanged
 * when `rows` does not hold it.
 */
export function keepRow<T extends Row>(
  kept: KeptRows<T>,
  rows: readonly T[],
  id: string,
  done: boolean,
): Map<string, KeptRow<T>> {
  const next = new Map(kept);
  const index = rows.findIndex((row) => row.id === id);
  const row = rows[index];
  if (row) next.set(id, { entry: { ...row, done }, after: rows[index - 1]?.id ?? null });
  return next;
}

/**
 * `fresh` plus the ticked rows it left out, each after the row it followed. Only ticked ones come
 * back: a row unticked here is open again, so the server lists it itself. Returns `fresh` itself
 * when nothing was added.
 */
export function withKeptRows<T extends Row>(fresh: T[], kept: KeptRows<T>): T[] {
  const result = [...fresh];
  const placed = new Set(fresh.map((row) => row.id));
  const place = (id: string, row: KeptRow<T>) => {
    if (placed.has(id)) return;
    placed.add(id);
    const anchorRow = row.after === null ? undefined : kept.get(row.after);
    // The row it followed was ticked too: put that one back first.
    if (row.after !== null && anchorRow?.entry.done) place(row.after, anchorRow);
    const anchor = row.after === null ? -1 : result.findIndex((entry) => entry.id === row.after);
    if (row.after !== null && anchor === -1) result.push(row.entry);
    else result.splice(anchor + 1, 0, row.entry);
  };
  for (const [id, row] of kept) if (row.entry.done) place(id, row);
  return result.length === fresh.length ? fresh : result;
}
