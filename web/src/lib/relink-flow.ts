/**
 * Rename/move with relink (SPEC F4): dry run first; when other notes would be rewritten (or links
 * cannot be kept), the user confirms a dialog listing them; then the real operation runs.
 */
import { i18n } from '../i18n';
import type { RelinkDryRun, RelinkResult } from './api/notes-types';
import { confirmDialog } from './dialogs/dialog-requests';
import { noteTitleFromPath } from './vault-paths';

export interface RelinkFlow {
  dryRun: () => Promise<RelinkDryRun>;
  execute: () => Promise<RelinkResult>;
  /** Translated dialog title and confirm button. */
  title: string;
  confirmLabel: string;
}

/** Display form of a note path in lists: the path without `.md`. */
function notePathLabel(path: string): string {
  const slash = path.lastIndexOf('/');
  const title = noteTitleFromPath(path);
  return slash === -1 ? title : `${path.slice(0, slash)}/${title}`;
}

export function needsRelinkConfirm(plan: RelinkDryRun): boolean {
  return (
    plan.affected.length > 0 ||
    (plan.unresolvable?.length ?? 0) > 0 ||
    (plan.skipped?.length ?? 0) > 0
  );
}

function confirmBody(plan: RelinkDryRun): string {
  const lines: string[] = [];
  if (plan.affected.length > 0) {
    lines.push(i18n.t('operations.confirm.relinkBody', { count: plan.affected.length }));
  }
  const unresolvable = plan.unresolvable?.length ?? 0;
  if (unresolvable > 0) {
    lines.push(i18n.t('operations.confirm.unresolvableBody', { count: unresolvable }));
  }
  const skipped = plan.skipped?.length ?? 0;
  if (skipped > 0) lines.push(i18n.t('operations.confirm.skippedBody', { count: skipped }));
  return lines.join(' ');
}

function confirmItems(plan: RelinkDryRun): string[] {
  const items = plan.affected.map(notePathLabel);
  for (const link of plan.unresolvable ?? []) {
    items.push(
      i18n.t('operations.confirm.unresolvableItem', {
        note: notePathLabel(link.path),
        line: link.line,
        raw: link.raw,
      }),
    );
  }
  return items;
}

/** Returns the operation result, or null when the user cancelled. Errors propagate. */
export async function runRelinkFlow(flow: RelinkFlow): Promise<RelinkResult | null> {
  const plan = await flow.dryRun();
  if (needsRelinkConfirm(plan)) {
    const confirmed = await confirmDialog({
      title: flow.title,
      body: confirmBody(plan),
      items: confirmItems(plan),
      itemsLabel: i18n.t('operations.confirm.affectedLabel'),
      confirmLabel: flow.confirmLabel,
      cancelLabel: i18n.t('operations.confirm.cancel'),
    });
    if (!confirmed) return null;
  }
  return flow.execute();
}
