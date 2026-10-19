/**
 * Test helpers: a real Tiptap editor (no React) on the shared schema, driven the way the browser
 * drives it – text through `handleTextInput` (so input rules run), keys through `handleKeyDown`.
 */
import { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import { createEditorContext, type EditorContext } from '../editor-context';
import { createEditorExtensions } from '../editor-extensions';
import { loadMarkdown, type LoadedMarkdown } from '../markdown/markdown-document';
import { adoptMarkdownSchema, asInitialContent } from '../shared-schema';

export interface TestEditor {
  editor: Editor;
  view: EditorView;
  loaded: LoadedMarkdown;
  context: EditorContext;
}

export function createTestEditor(
  source: string,
  options: { notePath?: string; editable?: boolean } = {},
): TestEditor {
  const loaded = loadMarkdown(source);
  const context = createEditorContext(options.notePath ?? '1 Projects/Đồ án.md');
  const element = document.createElement('div');
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: createEditorExtensions(context),
    content: asInitialContent(loaded.doc),
    editable: options.editable ?? true,
    injectCSS: false,
    onBeforeCreate: adoptMarkdownSchema,
  });
  return { editor, view: editor.view, loaded, context };
}

/** Types characters one by one; a character no handler took is inserted like the browser would. */
export function typeText(editor: Editor, text: string): void {
  for (const ch of Array.from(text)) {
    const view = editor.view;
    const { from, to } = view.state.selection;
    const insert = () => view.state.tr.insertText(ch, from, to);
    const handled = view.someProp('handleTextInput', (f) => f(view, from, to, ch, insert));
    if (!handled) view.dispatch(insert());
  }
}

export interface KeyOptions {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
}

/** Sends a keydown through the editor's handlers; returns whether one of them used it. */
export function pressKey(editor: Editor, key: string, options: KeyOptions = {}): boolean {
  const view = editor.view;
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: options.ctrl ?? false,
    shiftKey: options.shift ?? false,
    altKey: options.alt ?? false,
    metaKey: options.meta ?? false,
    bubbles: true,
    cancelable: true,
  });
  return view.someProp('handleKeyDown', (f) => f(view, event)) ?? false;
}

/** Puts the caret right after the first occurrence of `text` (or before it with `before`). */
export function placeCaret(
  editor: Editor,
  text: string,
  where: 'after' | 'before' = 'after',
): void {
  let target = -1;
  editor.state.doc.descendants((node, pos) => {
    if (target !== -1 || !node.isText) return target === -1;
    const index = node.text?.indexOf(text) ?? -1;
    if (index !== -1) target = pos + index + (where === 'after' ? text.length : 0);
    return false;
  });
  if (target === -1) throw new Error(`text not found: ${text}`);
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, target)),
  );
}

/** Caret at the end of the document's last textblock. */
export function caretAtEnd(editor: Editor): void {
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
}

/** Adds an empty paragraph at the end and puts the caret in it. */
export function newLineAtEnd(editor: Editor): void {
  const { state } = editor;
  const tr = state.tr.insert(state.doc.content.size, state.schema.nodes['paragraph']!.create());
  tr.setSelection(TextSelection.create(tr.doc, tr.doc.content.size - 1));
  editor.view.dispatch(tr);
}
