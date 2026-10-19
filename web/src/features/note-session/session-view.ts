import type { SaveStatus, SessionView } from './note-session-types';
import type { SessionCore } from './session-core';

/** The save state shown to the user, most urgent first. */
function statusOf(core: SessionCore): SaveStatus {
  if (core.phase !== 'ready') return 'loading';
  if (core.conflict) return 'conflict';
  if (core.inFlight > 0) return 'saving';
  if (core.error) return 'error';
  if (!core.synced) return core.draftSeq === core.changeSeq ? 'draft' : 'dirty';
  return core.lastSaved ? 'saved' : 'clean';
}

/** A read-only picture of the session for React (a new object after every change). */
export function deriveView(core: SessionCore): SessionView {
  return {
    path: core.path,
    status: statusOf(core),
    loadProblem:
      core.phase === 'not-found' ? 'not-found' : core.phase === 'failed' ? 'failed' : null,
    errorKind: core.conflict ? null : core.error,
    readOnly: core.readOnly,
    noteClass: core.noteClass,
    frontmatterRaw: core.frontmatterRaw,
    doc: core.doc,
    docVersion: core.docVersion,
    keepSelection: core.keepSelection,
    draftRestored: core.restored !== null,
    keptCount: core.keptCount,
    conflict: core.conflict,
    source: core.source ? { text: core.source.display } : null,
  };
}
