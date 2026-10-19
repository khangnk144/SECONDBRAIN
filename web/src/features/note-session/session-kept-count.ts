/** How many versions "Tải lại" set aside for this note (banner "Có n bản đã cất…"). */
import type { SessionCore } from './session-core';

export async function refreshKeptCount(core: SessionCore): Promise<void> {
  const count = (await core.deps.drafts.listKept(core.vaultId, core.path)).length;
  if (count === core.keptCount || core.disposed) return;
  core.keptCount = count;
  core.emit();
}

/** A set-aside version was restored or let go: forget it. */
export async function dropKept(core: SessionCore, id: number): Promise<void> {
  await core.deps.drafts.removeKept(id);
  await refreshKeptCount(core);
}
