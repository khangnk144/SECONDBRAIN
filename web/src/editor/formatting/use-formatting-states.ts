import { useEditorState } from '@tiptap/react';
import { useLayoutEffect, useState, type RefObject } from 'react';
import { FORMATTING_COMMANDS, type FormattingContext } from './formatting-commands';

export interface CommandState {
  enabled: boolean;
  /** Toggle commands only: whether the selection has it. */
  pressed: boolean | undefined;
}

/**
 * Enabled and pressed state of every formatting command for the current selection, recomputed
 * after every editor transaction (and when the editor becomes editable or read-only). Reading
 * the state never changes the document.
 */
export function useFormattingStates(context: FormattingContext): Record<string, CommandState> {
  const compute = (editor: FormattingContext['editor']) => {
    const current = { ...context, editor };
    const states: Record<string, CommandState> = {};
    for (const command of FORMATTING_COMMANDS) {
      states[command.id] = {
        enabled: command.isEnabled(current),
        pressed: command.isActive ? command.isActive(current) : undefined,
      };
    }
    return states;
  };
  // The store only signals "something changed"; the editor comes from the props, so a newly
  // mounted editor counts at once (the store's own snapshot keeps the old one until it changes).
  const states = useEditorState({
    editor: context.editor,
    selector: () => compute(context.editor),
  });
  return states ?? compute(context.editor);
}

/** The element's width in px, followed while it resizes (null until measured or without layout). */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth > 0 ? element.clientWidth : null);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/** The root font size in px (Settings offer 14, 16 and 18). */
export function rootFontSize(): number {
  const size = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  return Number.isFinite(size) && size > 0 ? size : 16;
}

export function coarsePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}
