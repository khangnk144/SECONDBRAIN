import {
  getExtensionField,
  getSchema,
  type AnyConfig,
  type AnyExtension,
  type Extensions,
} from '@tiptap/core';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import StarterKit from '@tiptap/starter-kit';
import { MarkdownDocument } from './markdown-document-node';
import { VerbatimBlock } from './verbatim-block-node';
import { Wikilink } from './wikilink-node';

/** Node names of the three list kinds; each carries `loose` (CommonMark loose vs tight list). */
export const LIST_NODE_NAMES = ['bulletList', 'orderedList', 'taskList'] as const;

/**
 * Tiptap extensions that define the editor's node and mark types — and nothing else that changes
 * meaning. Composite kits (StarterKit, TableKit) are flattened so the editor UI can `.extend()` or
 * `.configure()` any single extension by name without forking it. Behaviour such as input rules,
 * popups and node views is added on top; what a node means must stay as defined here.
 */
export function createSchemaExtensions(): AnyExtension[] {
  // Underline is stored as `<u>…</u>` (inline HTML Markdown readers render as underline).
  const starterKit = StarterKit.configure({
    document: false,
    heading: { levels: [1, 2, 3] },
    link: { openOnClick: false, autolink: false, linkOnPaste: false },
  });
  const tableKit = TableKit.configure({ table: { resizable: false } });
  const extensions: Extensions = [
    MarkdownDocument,
    ...kitExtensions(starterKit),
    TaskList,
    TaskItem.configure({ nested: true }),
    ...kitExtensions(tableKit),
    Image.configure({ inline: true, allowBase64: false }),
    Wikilink,
    VerbatimBlock,
  ];
  return extensions.map(adjustForMarkdown);
}

export const editorSchema = getSchema(createSchemaExtensions());

/** The extensions a kit adds, without the kit wrapper itself (which only adds extensions). */
function kitExtensions(kit: AnyExtension): Extensions {
  const context = { name: kit.name, options: kit.options, storage: kit.storage };
  const add = getExtensionField<AnyConfig['addExtensions']>(kit, 'addExtensions', context);
  return add ? add() : [];
}

function adjustForMarkdown(extension: AnyExtension): AnyExtension {
  const name = extension.name;
  // Markdown allows code spans inside emphasis and links (`**`x`**`, `[`x`](u)`): the code mark
  // only excludes itself instead of every other mark.
  if (name === 'code') return extension.extend({ excludes: 'code' });
  // A GFM table cell holds exactly one line of inline content.
  if (name === 'tableCell' || name === 'tableHeader') {
    return extension.extend({ content: 'paragraph' });
  }
  if ((LIST_NODE_NAMES as readonly string[]).includes(name)) return withLooseAttribute(extension);
  return extension;
}

function withLooseAttribute(extension: AnyExtension): AnyExtension {
  return extension.extend({
    addAttributes() {
      const parent = (this as { parent?: () => Record<string, unknown> }).parent;
      return {
        ...parent?.(),
        loose: {
          default: false,
          keepOnSplit: true,
          parseHTML: (element: HTMLElement) => element.getAttribute('data-loose') === 'true',
          renderHTML: (attributes: Record<string, unknown>) =>
            attributes['loose'] ? { 'data-loose': 'true' } : {},
        },
      };
    },
  });
}
