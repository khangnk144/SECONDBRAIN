import { trashFileAbs, writeTrashMeta } from './trash-store.js';
import { writeStateFile, type VaultCore } from './vault-core.js';
import { readAtRevision, replaceContent } from './vault-write-ops.js';
import type { ConflictCopyResult, TrashEntry, TrashReason, VaultPath } from './vault-types.js';

/** Why the bytes on disk are kept: "keep mine", a history restore or a template upgrade. */
export type KeptCopyReason = Extract<
  TrashReason,
  'conflict' | 'history-restore' | 'template-upgrade'
>;

/**
 * "Keep mine" of the conflict UI (SPEC §4.10): the version on disk (at `expectedRevision`, the one
 * the conflict UI showed) is copied into a new trash entry with `reason: 'conflict'`, then the
 * client's content replaces it atomically. The copy is complete before the note is touched, so a
 * crash in between leaves the note as it was and at worst one extra trash copy. A version restore
 * uses the same step (`history-restore`) when the text it replaces could not be committed first.
 */
export function writeKeepingConflictCopy(
  core: VaultCore,
  input: VaultPath,
  content: string,
  expectedRevision: string,
  reason: KeptCopyReason = 'conflict',
): Promise<ConflictCopyResult> {
  return core.queue.run(async () => {
    const { target, current } = await readAtRevision(core, input, expectedRevision);
    const trash: TrashEntry = {
      id: core.newId(),
      opId: core.newId(),
      originalPaths: [target.vaultPath],
      reason,
      deletedAt: core.now().toISOString(),
    };
    await writeTrashMeta(core, trash);
    await writeStateFile(core.paths, trashFileAbs(core, trash.id, target.vaultPath), current);
    const result = await replaceContent(core, target, current, Buffer.from(content, 'utf8'));
    return { ...result, trashId: trash.id };
  });
}
