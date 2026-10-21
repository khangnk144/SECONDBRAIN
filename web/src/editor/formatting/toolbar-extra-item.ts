import type { HTMLAttributes, ReactNode } from 'react';
import type { TooltipContent } from './toolbar-tooltip';

/**
 * One more control on the row from outside the formatting registry (the AI menu). It sits before
 * the source-mode switch, after a separator, and takes part in the roving focus: render one
 * element with `data-toolbar-item={id}` and the given `tabIndex`.
 */
export interface ToolbarExtraItem {
  id: string;
  /** Its width on the row, in rem (the overflow into "Thêm" leaves room for it). */
  widthRem: number;
  render: (props: {
    tabIndex: 0 | -1;
    tooltipProps: (content: TooltipContent) => HTMLAttributes<HTMLElement>;
  }) => ReactNode;
}

/** The row with the extra control placed before the source-mode switch (or at the end). */
export function withExtraItem(bar: string[], extra: ToolbarExtraItem | undefined): string[] {
  if (!extra) return bar;
  const at = bar.indexOf('sourceMode');
  return at === -1 ? [...bar, extra.id] : [...bar.slice(0, at), extra.id, ...bar.slice(at)];
}
