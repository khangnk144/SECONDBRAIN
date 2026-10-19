/**
 * Relink planning for rename/move on top of the index. Candidates: notes whose links resolve to
 * a file being moved, notes that name an old or a new title/path in any link (a rename into an
 * existing title must not silently retarget their links), and the moved notes themselves
 * (self-links and their own same-folder links after a move). The catalog is the index's current
 * (pre-operation) one, and notes are read through the vault so the rewrite starts from the bytes
 * on disk.
 */
import { isNotePath } from '../markdown/content-classes.js';
import { planRelinkMoves } from '../markdown/relink.js';
import type { RelinkPlan, RelinkPlanner, VaultPath, VaultService } from '../vault/vault-types.js';
import type { IndexService } from './index-types.js';

/** A RelinkPlanner that always answers with the full plan (edits + skipped notes). */
export interface IndexRelinkPlanner extends RelinkPlanner {
  plan(op: Parameters<RelinkPlanner['plan']>[0]): Promise<RelinkPlan>;
  planMoves(moves: { from: VaultPath; to: VaultPath }[]): Promise<RelinkPlan>;
}

export interface IndexRelinkPlannerOptions {
  /**
   * Waits until changes already seen by the app have reached the index (e.g. the change router's
   * queue), so a note edited a moment ago to link here is not missed. Must not wait on the vault's
   * write queue: plan() runs inside it.
   */
  beforePlan?: () => Promise<void>;
}

export function createIndexRelinkPlanner(
  index: IndexService,
  vault: VaultService,
  options: IndexRelinkPlannerOptions = {},
): IndexRelinkPlanner {
  async function planMoves(moves: { from: VaultPath; to: VaultPath }[]): Promise<RelinkPlan> {
    await options.beforePlan?.();
    await index.settled();
    const froms = moves.map((move) => move.from);
    const candidates = [
      ...new Set([
        ...froms.flatMap((from) => index.linkingNotes(from)),
        ...index.notesLinkingByTitleOrPath([...froms, ...moves.map((move) => move.to)]),
        ...froms.filter(isNotePath),
      ]),
    ];
    // A note that is not UTF-8 is still parsed (from its lossy decode) to learn whether it links
    // here, but never rewritten: the caller reports it so the user can fix it by hand.
    const notUtf8 = new Set<VaultPath>();
    const { edits, unresolvable } = await planRelinkMoves({
      moves,
      catalog: index.linkCatalog(),
      candidates,
      readNote: async (p) => {
        const note = await vault.read(p);
        if (!note.utf8) notUtf8.add(p);
        return note;
      },
    });
    const unwritable = unresolvable
      .filter((link) => !notUtf8.has(link.path))
      .map(({ path, raw, line }) => ({ path, raw, line }));
    return {
      edits: edits.filter((edit) => !notUtf8.has(edit.path)),
      skipped: edits.filter((edit) => notUtf8.has(edit.path)).map((edit) => edit.path),
      ...(unwritable.length ? { unresolvable: unwritable } : {}),
    };
  }
  return {
    plan: (op) => planMoves([{ from: op.from, to: op.to }]),
    planMoves,
  };
}
