# Editor core: schema and Markdown converter

Pure TypeScript (no DOM, no React). The editor UI (B1) adds behaviour on top; it must not change
what a node means. SPEC §4.9 is the contract this code implements.

## Schema (`schema/`)

`createSchemaExtensions()` returns flat Tiptap extensions (StarterKit and TableKit are unpacked,
so any one can be `.extend()`ed or `.configure()`d by name); `editorSchema` is its schema.

| Node / mark | Markdown | Notes |
|---|---|---|
| `doc` | file body | content `(block \| verbatimBlock)+` |
| `paragraph`, `heading` (1–3), `blockquote`, `horizontalRule`, `hardBreak` | as usual | |
| `codeBlock` | fenced or indented code | attr `language`; an info string beyond the language is verbatim |
| `bulletList`, `orderedList` (`start`), `taskList` | lists | attr `loose` (blank lines between items, CommonMark "loose") |
| `listItem`, `taskItem` (`checked`) | list items | first child is a paragraph; nested lists allowed |
| `table`, `tableRow`, `tableHeader`, `tableCell` (`align`) | GFM tables | a cell holds exactly one paragraph |
| `image` (inline) | `![alt](src "title")` | |
| `wikilink` (inline atom) | `[[target#heading\|alias]]`, `![[…]]` | attrs `target`, `heading`, `alias`, `embed` |
| `verbatimBlock` (atom) | any unsupported top-level block | attr `source` (`\n` line ends); top level only |
| `bold`, `italic`, `strike`, `code`, `link` | `**`, `*`, `~~`, `` ` ``, `[](…)` | `code` combines with the other marks |
| `underline` | `<u>…</u>` | only an exact lowercase pair of sibling tags around content; nesting written link > underline > strike > bold > italic |

Tags (`#tag`) and task dates (`📅 2026-10-20`, `✅ …`) are plain text; decorate them in the UI.

## Converter (`markdown/`)

```ts
loadMarkdown(source, schema?) → { doc, snapshot, frontmatter: { raw } | null }
saveMarkdown(doc, snapshot) → string            // === source when nothing changed
saveMarkdownWithSnapshot(doc, snapshot) → { text, snapshot, exact }
documentEol(snapshot) → '\n' | '\r\n'
caretForSourceOffset(doc, snapshot, offset) → CaretTarget   // a template's {{cursor}}
```

**Load.** BOM and front matter (server fence rules) are set aside. The body is parsed with
remark + GFM (the server's reference parser), in chunks because micromark is quadratic in the size
of one parse (`markdown-chunks.ts`; each chunk is checked to end cleanly, link definitions are
parsed in front of every chunk). Each top-level block keeps its original bytes, the bytes before
it, and its editor node: a supported node when the mapping is exact, else a `verbatimBlock`
(headings 4–6, HTML other than `<u>…</u>` pairs, math `$…$`/`$$…$$`, footnotes, reference links and definitions, `:::`
containers, callouts `> [!x]`, code info strings, mixed or ordered task lists, ragged tables,
wikilinks the editor cannot hold such as inside link text, NUL characters). Wikilinks are found
with the server's raw-text scan and cut out of `text` nodes (`text-alignment.ts`). Lists and
quotes also record their items, heads and child blocks (`container-source.ts`).

**Save.** Top-level nodes are matched to the snapshot: nodes the editor kept (the same objects)
are paired first, the rest by `node.eq()` classes (prefix/suffix, exact LCS when small, Myers
within a distance budget, else patience anchors – `block-alignment.ts`, `sequence-diff.ts`), so
no edit, however far from another, rewrites the blocks between. Unchanged blocks are written from
their original bytes. Two neighbouring lists that would merge get a marker no neighbour uses
(`list-separation.ts`); inline whitespace Markdown cannot hold is dropped or moved out of
emphasis runs (`inline-whitespace.ts`). Each region around a change (edited, new
or moved blocks, deletion seams) is written, then parsed again with one unchanged neighbour on
each side and must give back exactly the expected nodes (`save-verification.ts`). Attempts, from
most to least preserving: keep unchanged list items/quote children and patch ticks (level 0),
keep unchanged items only (1), canonical block (2), each first with the original gaps and then
with a blank line in every gap of the region. If nothing verifies, the canonical text is written
(nothing is dropped) and `exact` is `false`.

Invariants (each has tests): identity for every input; edits stay inside the edited block and
its adjacent gaps; canonical style only inside edited blocks; re-parse of written text equals the
editor content; front matter, BOM, CRLF/LF, NFD and the final newline never change.

## Notes for the editor UI

- Keep node identity: build the editor state from `loadMarkdown().doc`
  (`EditorState.create({ doc })`); a JSON round trip works but makes every save compare deeply.
- Tick a task with `toggleTask` (`extensions/task-toggle.ts`): `checked` changes and the done
  token on the first line follows the server's view-patch rules (`markdown/done-token-rules.ts`:
  the first ✅ token set to today in place, else ` ✅ <today>` appended as plain text; an untick
  removes every ✅ token). The save writes it as a one-line text patch made the way the server
  makes it (`task-tick-patch.ts`), so editor and Today/Calendar ticks write the same bytes
  (`task-tick-server-parity.test.ts`).
- `exact: false` is informational (logged, not an error). Empty paragraphs, a hard break at the
  end of a paragraph, and code/link marks on atoms have no Markdown form and are not saved.
- Verbatim blocks are edited in source mode only (re-load the whole text after source mode).
- After `saveMarkdownWithSnapshot`, keep the returned snapshot for the next save.

## Adding a construct

1. Schema: add the node/mark (attrs must hold everything that affects rendering).
2. `mdast-to-prosemirror.ts` / `mdast-inline-to-prosemirror.ts`: map it exactly or throw
   `UnsupportedConstruct` for any shape you cannot hold.
3. `prosemirror-to-mdast.ts` / `prosemirror-inline-to-mdast.ts`: map it back; add a handler in
   `markdown-serializer.ts` if mdast has no type for it; mirror any lossy rule in
   `save-normalize.ts`.
4. Add corpus files and run `npx vitest run --project web web/src/editor`: the round-trip,
   idempotence, random-document and adversarial tests must stay green.

## Editor UI (outside `markdown/`)
`markdown-editor.tsx` mounts Tiptap on the converter's own `editorSchema` instance
(`shared-schema.ts`); `extensions/` adds behaviour only (input rules, task item view and
`task-toggle.ts`, wikilink view/follow, decorations for tags and date chips, paste, list and table
keys, writing focus) and **must never change a node's spec** – a changed node or mark set throws
at creation. Popups (`popups/`: slash menu from a registry, `[[`, `#`, date picker) replace their
trigger text through one transaction. The note session talks to the editor only through
`MarkdownEditorHandle` (`focus`, `replaceDoc`, `getDoc`, `edit`; `focus({ caret })` places a
`CaretTarget`, inserting the empty paragraph for a blank line outside the undo history).

## Formatting toolbar (`formatting/`)
`FORMATTING_COMMANDS` is the one registry (`id`, `labelKey`, `keys`, `group`, `icon`, `isActive`,
`isEnabled`, `run` on a `FormattingContext`). The toolbar (`FormattingToolbar`, mounted by the note
screen above the title) renders it as a WAI-ARIA toolbar, folds the four text styles into one menu
and moves less-used commands into "Thêm" by width (`toolbar-layout.ts`, rem sizes shared with the
CSS). `FormattingKeys` binds every registry key in the editor and always takes the key (no browser
default such as view-source on `Ctrl+U`); `Alt+S` stays in the app shortcut registry. Commands are
disabled on a verbatim block, in a code block (except paragraph/code block), for block commands in a
table cell, and in source mode (except undo/redo/source).

## Attachments (`attachments/`)
Files dropped or pasted into the editor (`extensions/attachment-drop-paste.ts`, before the Markdown
paste), dropped on the note screen outside the text, picked with "/ Ảnh", or dropped into source
mode go through one flow (`attachment-uploads.ts`): one slot per file in the order given, images
upload at once, documents after one "Lưu vào" choice (`document-target-store.ts`, remembered per
vault; `DocumentTargetChooserHost` is mounted by the note screen), one file after another
(`uploadAttachment` in `lib/api/attachments-api.ts`). In the editor each slot is a widget
decoration (`upload-placeholders.ts`, never saved) whose position follows edits; the returned link
becomes a `wikilink` node (`attachment-link-insert.ts`: alone on an empty line or between blocks
as its own paragraph, inline with a separating space otherwise) in its own undo step. No converter
rule changed: an inserted link is an ordinary edit of the block it lands in.

Rendering never writes (P1). `![[x.png]]` and `![alt](path)` resolve through the link targets
(`embed-display.ts`; Markdown images relative to the note, then from the vault root) and show
through `lib/vault-file-blob.ts` (token-fetched object URLs, refreshed on `note:changed`/
`note:created`, revoked when unused) as `<img>` only – SVG too. Web images are never fetched; a
missing file is a placeholder naming it. Other embedded files are cards (`file-card-view.ts`);
`[[x.pdf]]` and any non-note target open through `openVaultFile`.
