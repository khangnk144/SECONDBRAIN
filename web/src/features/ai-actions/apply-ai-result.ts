/**
 * Putting an accepted AI result into the note (R1: nothing changes before she clicks). Text goes
 * in through the editor as one undoable step and is saved like typing; tags go into the `tags:`
 * front matter through the note session's revision-checked property patch.
 */
import { Fragment } from '@tiptap/pm/model';
import type { MarkdownEditorHandle } from '../../editor/editor-handle';
import { pathFormTarget } from '../../editor/link-actions';
import {
  afterTopLevelBlock,
  closeHistoryStep,
  insertBlocksAt,
  linkListParagraph,
  markdownToBlocks,
  replaceRangeWithMarkdown,
} from '../../editor/markdown-insert';
import type { VaultPath } from '../../lib/api/vault-types';
import { foldText } from '../../lib/fold-text';
import { useLinkTargetsStore } from '../../lib/link-targets-store';
import { samePath } from '../../lib/vault-paths';
import type { NoteSession } from '../note-session/note-session';
import { parseFrontmatter } from '../properties/frontmatter-values';
import { tagList } from '../properties/property-format';
import { cleanTag } from '../properties/tags-editor';
import type { RangeTracker } from './range-tracker';

/** `done`; `stale` = the selection is gone or changed; `nothing` = nothing to insert. */
export type ApplyOutcome = 'done' | 'stale' | 'nothing';

/** `> **Tóm tắt (AI):** …`: the AI text quoted, marked as AI's by its label. */
export function aiQuoteMarkdown(label: string, text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
  const first = lines[0] ?? '';
  // A first line that opens a block of its own (list, heading, quote, fence, table) goes below.
  const opensBlock = /^ {0,3}([-*+]\s|\d{1,9}[.)]\s|#{1,6}\s|>|```|~~~|\|)/.test(first);
  const quoted = opensBlock
    ? [`**${label}**`, '', ...lines]
    : [`**${label}** ${first}`, ...lines.slice(1)];
  return quoted.map((line) => (line.trim() === '' ? '>' : `> ${line}`)).join('\n');
}

/**
 * The caret back in the editor at once, where the selection was (the handle's `focus()` waits a
 * frame, so a keyboard user could type into the panel that is closing meanwhile).
 */
export function focusEditorNow(handle: MarkdownEditorHandle | null): void {
  const editor = handle?.editor;
  if (editor && !editor.isDestroyed) editor.view.focus();
  else handle?.focus();
}

function finish(handle: MarkdownEditorHandle, applied: boolean): ApplyOutcome {
  if (!applied) return 'nothing';
  // Typing right after the insertion is a step of its own (one Ctrl+Z takes back exactly this).
  handle.edit(closeHistoryStep);
  focusEditorNow(handle);
  return 'done';
}

/** A new block (or blocks) right after the top-level block that holds the selection's end. */
export function insertMarkdownBelow(
  handle: MarkdownEditorHandle,
  tracker: RangeTracker,
  markdown: string,
): ApplyOutcome {
  const range = tracker.current();
  if (!range) return 'stale';
  const applied = handle.edit((state) => {
    const blocks = markdownToBlocks(markdown, state.schema);
    return blocks ? insertBlocksAt(state, afterTopLevelBlock(state.doc, range.to), blocks) : null;
  });
  return finish(handle, applied);
}

/** The rewritten text in place of the selection, only while the selection is unchanged. */
export function replaceSelection(
  handle: MarkdownEditorHandle,
  tracker: RangeTracker,
  markdown: string,
): ApplyOutcome {
  const range = tracker.unchanged();
  if (!range) return 'stale';
  const applied = handle.edit((state) =>
    replaceRangeWithMarkdown(state, range.from, range.to, markdown),
  );
  return finish(handle, applied);
}

/**
 * How a link to `path` is written from `notePath`, like the `[[` popup: the title when it is
 * unique in the vault, else the path form; unknown notes get the path form (always unambiguous).
 */
export function linkTargetFor(path: VaultPath, title: string, notePath: VaultPath): string {
  const store = useLinkTargetsStore.getState();
  const note = store.titles.find((candidate) => samePath(candidate.path, path));
  if (note) return note.unique ? note.title : pathFormTarget(note.path);
  const resolution = store.resolve(title, notePath);
  return resolution.status === 'resolved' && samePath(resolution.path, path)
    ? title
    : pathFormTarget(path);
}

/** `Liên quan: [[a]], [[b]]` as a new paragraph after the selection's block. */
export function insertLinksBelow(
  handle: MarkdownEditorHandle,
  tracker: RangeTracker,
  label: string,
  targets: readonly string[],
): ApplyOutcome {
  const range = tracker.current();
  if (!range) return 'stale';
  if (targets.length === 0) return 'nothing';
  const applied = handle.edit((state) =>
    insertBlocksAt(
      state,
      afterTopLevelBlock(state.doc, range.to),
      Fragment.from(linkListParagraph(state.schema, label, targets)),
    ),
  );
  return finish(handle, applied);
}

export type TagOutcome =
  | { kind: 'added'; count: number }
  | { kind: 'already' }
  | { kind: 'unreadable' }
  | { kind: 'failed' };

/**
 * Adds tags to `tags:` (existing ones kept in their spelling and order, none twice: compared like
 * the tag editor does, diacritic-insensitive). Invalid YAML or a nested `tags` value is never
 * touched (F7.2).
 */
export async function addTagsToNote(
  session: NoteSession,
  tags: readonly string[],
): Promise<TagOutcome> {
  const parsed = parseFrontmatter(session.getView().frontmatterRaw);
  if (parsed.status === 'invalid') return { kind: 'unreadable' };
  const entry = parsed.status === 'ok' ? parsed.entries.find((e) => e.key === 'tags') : undefined;
  if (entry?.kind === 'complex') return { kind: 'unreadable' };
  const merged = entry ? tagList(entry.value) : [];
  let count = 0;
  for (const raw of tags) {
    const tag = cleanTag(raw);
    if (tag === '' || merged.some((existing) => foldText(existing) === foldText(tag))) continue;
    merged.push(tag);
    count += 1;
  }
  if (count === 0) return { kind: 'already' };
  const saved = await session.patchFrontmatter({ set: { tags: merged } });
  return saved ? { kind: 'added', count } : { kind: 'failed' };
}
