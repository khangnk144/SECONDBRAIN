/**
 * Test stand-in for `<MarkdownEditor>` with the same props and handle (B1's component is tested
 * on its own). Kept apart from the screen kit so `vi.mock` can load it without the screen.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { act } from '@testing-library/react';
import { useEffect } from 'react';
import { vi, type Mock } from 'vitest';
import type {
  FocusPosition,
  MarkdownEditorHandle,
  MarkdownEditorProps,
} from '../../editor/markdown-editor';

type ReplaceDoc = (doc: ProseMirrorNode, opts?: { keepSelection?: boolean }) => void;

interface EditorStub {
  props: MarkdownEditorProps | null;
  doc: ProseMirrorNode | null;
  mounts: number;
  handle: MarkdownEditorHandle & {
    focus: Mock<(position?: FocusPosition) => void>;
    replaceDoc: Mock<ReplaceDoc>;
  };
}

export const editorStub: EditorStub = {
  props: null,
  doc: null,
  mounts: 0,
  handle: {
    focus: vi.fn<(position?: FocusPosition) => void>(),
    replaceDoc: vi.fn<ReplaceDoc>((doc) => {
      editorStub.doc = doc;
    }),
    getDoc: () => {
      if (!editorStub.doc) throw new Error('no editor document');
      return editorStub.doc;
    },
    // Like the real editor: the edit becomes the document and is reported as typing.
    edit: (build) => {
      if (!editorStub.doc) return false;
      const tr = build(EditorState.create({ doc: editorStub.doc }));
      if (!tr) return false;
      editorStub.doc = tr.doc;
      editorStub.props?.onDocChange(tr.doc);
      return true;
    },
  },
};

export function resetEditorStub(): void {
  editorStub.props = null;
  editorStub.doc = null;
  editorStub.mounts = 0;
  editorStub.handle.focus.mockClear();
  editorStub.handle.replaceDoc.mockClear();
}

/** Stand-in for `MarkdownEditor`: shows the text, reports typing through `onDocChange`. */
export function StubMarkdownEditor(props: MarkdownEditorProps) {
  editorStub.props = props;
  useEffect(() => {
    editorStub.mounts += 1;
    editorStub.doc = props.initialDoc;
    props.onReady?.(editorStub.handle);
    // Mount-only, like the real editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div data-testid="editor" aria-label={props.ariaLabel} data-editable={String(props.editable)}>
      {props.initialDoc.textContent}
    </div>
  );
}

/** Types into the stub editor at a document position (1 = start of the first block). */
export function typeInEditor(text: string, pos = 1): void {
  const { doc, props } = editorStub;
  if (!doc || !props) throw new Error('editor not mounted');
  const next = EditorState.create({ doc }).tr.insertText(text, pos).doc;
  editorStub.doc = next;
  act(() => props.onDocChange(next));
}
