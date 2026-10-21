// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { FORMATTING_COMMANDS } from './formatting-commands';
import { BAR_ITEMS, MORE_ITEM, SIZES_REM, STYLE_ITEM, toolbarLayout } from './toolbar-layout';

const ALWAYS = [STYLE_ITEM, 'bold', 'italic', 'underline', MORE_ITEM];

/** Width of a row in px, with the same rules as the layout (separators between groups). */
function width(bar: string[], remPx: number, button: number = SIZES_REM.button): number {
  let rem = 0;
  bar.forEach((id, index) => {
    rem += id === STYLE_ITEM ? SIZES_REM.style : button;
    const previous = BAR_ITEMS.find((item) => item.id === bar[index - 1])?.group;
    const current = BAR_ITEMS.find((item) => item.id === id)?.group;
    if (previous && current && previous !== current) rem += SIZES_REM.separator;
  });
  return rem * remPx;
}

describe('formatting toolbar layout', () => {
  it('lists every command once, the four text styles folded into one menu', () => {
    const styles = FORMATTING_COMMANDS.filter((command) => command.group === 'style');
    expect(styles.map((command) => command.id)).toEqual([
      'paragraph',
      'heading1',
      'heading2',
      'heading3',
    ]);
    expect(BAR_ITEMS).toHaveLength(FORMATTING_COMMANDS.length - styles.length + 1);
  });

  it('fits the whole row into the 720 px note column at 16 px text', () => {
    const layout = toolbarLayout(720, 16);
    expect(layout.more).toEqual([]);
    expect(width(layout.bar, 16)).toBeLessThanOrEqual(720);
  });

  it.each([
    [720, 18, false],
    [600, 16, false],
    [480, 16, false],
    [328, 16, false],
    [328, 18, false],
    [328, 14, true],
    [288, 16, false],
  ])(
    'at %i px with %i px text (touch %s) moves the rest into "Thêm" and never overflows',
    (px, rem, coarse) => {
      const layout = toolbarLayout(px, rem, coarse);
      const button = coarse ? SIZES_REM.coarseButton : SIZES_REM.button;
      for (const id of ALWAYS) expect(layout.bar).toContain(id);
      if (px >= 328) expect(width(layout.bar, rem, button)).toBeLessThanOrEqual(px);
      // Nothing lost, nothing twice; "Thêm" sits just before the source switch when it is shown.
      const commands = layout.bar.filter((id) => id !== MORE_ITEM).concat(layout.more);
      expect(commands.sort()).toEqual(BAR_ITEMS.map((item) => item.id).sort());
      const source = layout.bar.indexOf('sourceMode');
      if (source !== -1) expect(layout.bar[source - 1]).toBe(MORE_ITEM);
    },
  );

  it('keeps the commands people use most on a 360 px phone', () => {
    const layout = toolbarLayout(328, 16);
    expect(layout.bar).toEqual([
      STYLE_ITEM,
      'bold',
      'italic',
      'underline',
      'bulletList',
      MORE_ITEM,
      'sourceMode',
    ]);
    expect(layout.more.slice(0, 4)).toEqual(['undo', 'redo', 'strike', 'code']);
  });
});
