/**
 * Property edits (F7) are server-side text patches of the front matter. Pending body edits are
 * saved first, so the patch carries the revision of everything typed so far; body edits typed
 * while the patch runs stay unsaved and are written right after, on top of the new front matter.
 */
import { loadMarkdown } from '../../editor/markdown/markdown-document';
import { noteConflictDetails } from '../../lib/api-client';
import type { FrontmatterChange } from './note-session-types';
import { diskFromConflictDetails, enterConflict } from './session-conflict';
import type { SessionCore } from './session-core';
import { saveInQueue } from './session-save';

export async function patchFrontmatterInQueue(
  core: SessionCore,
  change: FrontmatterChange,
): Promise<boolean> {
  if (core.phase !== 'ready' || core.conflict || core.readOnly || core.source) return false;
  if (!(await saveInQueue(core))) return false;
  const expectedRevision = core.baseRevision;
  if (expectedRevision === null) return false;
  core.inFlight += 1;
  core.emit();
  try {
    const result = await core.deps.api.patchNoteFrontmatter({
      path: core.path,
      expectedRevision,
      ...change,
    });
    // The document keeps its nodes (and any edits typed meanwhile); only the base moves.
    const loaded = loadMarkdown(result.content, core.deps.schema);
    core.setBase(result.content, result.revision);
    core.snapshot = loaded.snapshot;
    core.frontmatterRaw = loaded.frontmatter?.raw ?? null;
    core.lastSaved = true;
    core.resync();
    if (core.synced) {
      core.removeDraft();
    } else {
      core.writeDraftNow();
      core.restartAutosave();
    }
    return true;
  } catch (error) {
    const details = noteConflictDetails(error);
    if (details) enterConflict(core, diskFromConflictDetails(details));
    // Without edits of ours the note just reloaded: say the change did not go through.
    if (!core.conflict) core.deps.notify({ kind: 'patch-failed', error });
    return false;
  } finally {
    core.inFlight -= 1;
    core.emit();
  }
}
