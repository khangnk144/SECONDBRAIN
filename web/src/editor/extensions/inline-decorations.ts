import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { i18n } from '../../i18n';
import { useSearchUi } from '../../lib/search-ui-store';
import { todayDate, type CalendarDate } from '../local-dates';
import { doneDateLook, dueDateLook } from './date-chip-text';
import { scanInlineTokens } from './inline-tokens';
import { scheduleDayChange } from './day-change-timer';

export const inlineDecorationsKey = new PluginKey<DecorationSet>('inlineDecorations');
const REFRESH = 'refresh';

/**
 * Tags as pills (F6) and task date tokens as urgency chips (F9 look), drawn as decorations over
 * the plain text (never inside code or links). Only textblocks touched by a transaction are
 * scanned again; the whole document is re-scanned when the day changes.
 */
export const InlineDecorations = Extension.create({
  name: 'inlineDecorations',
  priority: 900,

  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => {
        const tag = tagAt(this.editor.state, this.editor.state.selection.from);
        if (tag === null) return false;
        useSearchUi.getState().openSearch(`tag:${tag}`);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: inlineDecorationsKey,
        state: {
          init: (_, state) => decorateAll(state.doc),
          apply: (tr, set) => applyTransaction(tr, set),
        },
        props: {
          decorations: (state) => inlineDecorationsKey.getState(state),
          handleClick: (view, pos, event) => {
            if (event.button !== 0) return false;
            const tag = tagAt(view.state, pos);
            if (tag === null) return false;
            useSearchUi.getState().openSearch(`tag:${tag}`);
            return true;
          },
        },
        view: (view: EditorView) => {
          const stop = scheduleDayChange(() => {
            if (!view.isDestroyed)
              view.dispatch(view.state.tr.setMeta(inlineDecorationsKey, REFRESH));
          });
          return { destroy: stop };
        },
      }),
    ];
  },
});

/** The tag under `pos` (a click or the caret), or null. */
export function tagAt(state: EditorState, pos: number): string | null {
  const set = inlineDecorationsKey.getState(state);
  const found = set?.find(pos, pos, (spec) => typeof spec['tag'] === 'string') ?? [];
  const hit = found.find((deco) => deco.from <= pos && pos <= deco.to);
  return hit ? String(hit.spec['tag']) : null;
}

function applyTransaction(tr: Transaction, set: DecorationSet): DecorationSet {
  if (tr.getMeta(inlineDecorationsKey) === REFRESH) return decorateAll(tr.doc);
  if (!tr.docChanged) return set;
  let next = set.map(tr.mapping, tr.doc);
  const today = todayDate();
  for (const [from, to] of changedRanges(tr)) {
    tr.doc.nodesBetween(from, to, (node, pos, parent) => {
      if (!node.isTextblock) return true;
      next = next.remove(next.find(pos, pos + node.nodeSize));
      next = next.add(tr.doc, decorationsFor(node, pos, parent, today));
      return false;
    });
  }
  return next;
}

/** Ranges of the new document touched by the transaction's steps (incl. mark-only steps). */
function changedRanges(tr: Transaction): [number, number][] {
  const ranges: [number, number][] = [];
  const size = tr.doc.content.size;
  tr.steps.forEach((step, index) => {
    const rest = tr.mapping.slice(index + 1);
    const push = (from: number, to: number) => {
      const a = rest.map(from, -1);
      const b = rest.map(to, 1);
      ranges.push([Math.max(0, Math.min(a, b) - 1), Math.min(size, Math.max(a, b) + 1)]);
    };
    step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => push(newStart, newEnd));
    const marked = step as unknown as { from?: number; to?: number };
    if (typeof marked.from === 'number' && typeof marked.to === 'number') {
      push(step.getMap().map(marked.from, -1), step.getMap().map(marked.to, 1));
    }
  });
  return ranges;
}

function decorateAll(doc: ProseMirrorNode): DecorationSet {
  const today = todayDate();
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isTextblock) return true;
    decorations.push(...decorationsFor(node, pos, parent, today));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

function decorationsFor(
  textblock: ProseMirrorNode,
  pos: number,
  parent: ProseMirrorNode | null,
  today: CalendarDate,
): Decoration[] {
  const tokens = scanInlineTokens(textblock, pos + 1);
  if (tokens.length === 0) return [];
  const doneTask = parent?.type.name === 'taskItem' && parent.attrs['checked'] === true;
  return tokens.flatMap((token) => {
    if (token.kind === 'tag') {
      const title = i18n.t('editor.tag.pillTitle', { tag: `#${token.tag}` });
      return [
        Decoration.inline(token.from, token.to, { class: 'tag-pill', title }, { tag: token.tag }),
      ];
    }
    const look =
      token.kind === 'due' ? dueDateLook(token.date, doneTask, today) : doneDateLook(token.date);
    const chip = Decoration.inline(
      token.from,
      token.to,
      { class: `date-chip date-chip--${look.state}`, title: look.title },
      { date: token.date },
    );
    return look.label === null ? [chip] : [chip, relativeLabel(token.to, look.state, look.label)];
  });
}

/**
 * The relative text after a date chip, in the matching text colour. A widget: shown and read by
 * assistive tech with the date, but not part of the document, so it is never saved.
 */
function relativeLabel(pos: number, state: string, label: string): Decoration {
  return Decoration.widget(
    pos,
    () => {
      const element = document.createElement('span');
      element.className = `date-chip__when date-chip__when--${state}`;
      element.setAttribute('contenteditable', 'false');
      element.textContent = label;
      return element;
    },
    { side: 1, ignoreSelection: true, key: `when:${state}:${label}`, when: true },
  );
}
