import { Extension, type Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import type { VaultPath } from '../../lib/api/vault-types';
import { isNotePath } from '../../lib/vault-paths';
import type { EditorContext } from '../editor-context';
import { followWikilink, pathFormTarget } from '../link-actions';
import type { WikilinkAttributes } from '../schema/wikilink-node';

/** Follows the wikilink node at `pos`; an ambiguous link opens the "Chọn đích…" menu. */
export function followLinkNode(
  editor: Editor,
  context: EditorContext,
  pos: number,
  options: { newTab: boolean },
): void {
  const node = editor.state.doc.nodeAt(pos);
  if (node?.type.name !== 'wikilink') return;
  const attrs = node.attrs as WikilinkAttributes;
  void followWikilink(attrs, context.getNotePath(), {
    newTab: options.newTab,
    onAmbiguous: (candidates) => openTargetMenu(editor, context, pos, attrs.target, candidates),
  });
}

function openTargetMenu(
  editor: Editor,
  context: EditorContext,
  pos: number,
  target: string,
  candidates: VaultPath[],
): void {
  const element = editor.view.nodeDOM(pos);
  const rect = element instanceof HTMLElement ? element.getBoundingClientRect() : null;
  context.openTargetMenu({
    pos,
    target,
    candidates,
    x: rect?.left ?? 0,
    y: rect ? rect.bottom + 4 : 0,
    returnFocus: editor.view.dom as HTMLElement,
  });
}

/**
 * "Chọn đích…": rewrites the link at `pos` to the path form of `path` (F4), if it is still the
 * link the menu was opened for.
 */
export function chooseLinkTarget(
  editor: Editor,
  pos: number,
  expectedTarget: string,
  path: VaultPath,
): void {
  const node = editor.state.doc.nodeAt(pos);
  if (node?.type.name !== 'wikilink' || node.attrs['target'] !== expectedTarget) return;
  const target = isNotePath(path) ? pathFormTarget(path) : path;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, target }));
  editor.view.focus();
}

/** Enter on a selected wikilink opens it (Ctrl/⌘+Enter: in a new tab). */
export function createWikilinkKeys(context: EditorContext) {
  const followSelected = (editor: Editor, newTab: boolean) => {
    const { selection } = editor.state;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'wikilink')
      return false;
    followLinkNode(editor, context, selection.from, { newTab });
    return true;
  };
  return Extension.create({
    name: 'wikilinkKeys',
    priority: 1000,
    addKeyboardShortcuts() {
      return {
        Enter: () => followSelected(this.editor, false),
        'Mod-Enter': () => followSelected(this.editor, true),
      };
    },
  });
}
