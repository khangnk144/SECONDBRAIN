/**
 * Which toolbar items fit on one row and which move into "Thêm". Sizes are in rem, the same values
 * `formatting-toolbar.css` uses, so the row never overflows (360 px phones and 18 px text
 * included). At 16 px text the whole row (about 711 px) fits the 720 px note column. Less-used
 * commands leave first; the text style, bold, italic, underline and "Thêm" always stay.
 */
import { FORMATTING_COMMANDS, type FormattingGroup } from './formatting-commands';

export const STYLE_ITEM = 'textStyle';
export const MORE_ITEM = 'more';

/** Bar items in order: every command, the four text styles folded into one menu button. */
export const BAR_ITEMS: ReadonlyArray<{ id: string; group: FormattingGroup }> = [
  ...FORMATTING_COMMANDS.filter((command) => command.group !== 'style').map(({ id, group }) => ({
    id,
    group,
  })),
].flatMap((item) =>
  item.id === 'bold' ? [{ id: STYLE_ITEM, group: 'style' as const }, item] : [item],
);

/** First to leave the row first. */
const HIDE_ORDER = [
  'table',
  'divider',
  'clearFormatting',
  'noteLink',
  'codeBlock',
  'blockquote',
  'code',
  'strike',
  'redo',
  'undo',
  'orderedList',
  'webLink',
  'taskList',
  'sourceMode',
  'bulletList',
];

export const SIZES_REM = {
  button: 2,
  /** Touch screens: 40 px targets (design.md §8). */
  coarseButton: 2.5,
  style: 6.25,
  /** A 1 px line with 2 px on each side; buttons sit edge to edge (their padding is inside). */
  separator: 0.3125,
  gap: 0,
} as const;

export interface ToolbarLayout {
  /** Items on the row, in order (`more` included when anything is in the menu). */
  bar: string[];
  /** Command ids in the "Thêm" menu, in registry order. */
  more: string[];
}

function rowWidth(ids: readonly string[], buttonRem: number): number {
  let rem = 0;
  ids.forEach((id, index) => {
    rem += id === STYLE_ITEM ? SIZES_REM.style : buttonRem;
    if (index > 0) rem += SIZES_REM.gap;
    const previous = BAR_ITEMS.find((item) => item.id === ids[index - 1]);
    const current = BAR_ITEMS.find((item) => item.id === id);
    if (previous && current && previous.group !== current.group) rem += SIZES_REM.separator;
  });
  return rem;
}

/** Puts `more` before the source-mode switch, which sits at the end of the row. */
function withMore(ids: string[]): string[] {
  const at = ids.indexOf('sourceMode');
  return at === -1 ? [...ids, MORE_ITEM] : [...ids.slice(0, at), MORE_ITEM, ...ids.slice(at)];
}

export function toolbarLayout(availablePx: number, remPx = 16, coarse = false): ToolbarLayout {
  const buttonRem = coarse ? SIZES_REM.coarseButton : SIZES_REM.button;
  const all = BAR_ITEMS.map((item) => item.id);
  const fits = (ids: string[]) => rowWidth(ids, buttonRem) * remPx <= availablePx;
  if (fits(all)) return { bar: all, more: [] };
  for (let count = 1; count <= HIDE_ORDER.length; count += 1) {
    const hidden = new Set(HIDE_ORDER.slice(0, count));
    const bar = withMore(all.filter((id) => !hidden.has(id)));
    if (fits(bar) || count === HIDE_ORDER.length) {
      return { bar, more: all.filter((id) => hidden.has(id)) };
    }
  }
  return { bar: all, more: [] };
}
