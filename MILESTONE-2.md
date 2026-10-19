# Milestone 2 – Editor, links and notes

Date: 2026-10-19 · SPEC v1.1 §12 row M2 · Plan: `plans/2026-10-19-m2-editor-notes/plan.md` (+ phase briefs, `reports/`)

## What was built
- **Editor spike first (gate).** Tiptap 3 on a block-preserving Markdown converter (`web/src/editor/markdown/`): every top-level block keeps its original bytes unless it was edited; changed lists and quotes are rewritten item by item and a tick is a one-line text patch; every changed region is parsed again and compared before it is written; unsupported constructs (math, HTML, footnotes, headings 4–6, callouts, reference links, mixed task lists…) are verbatim blocks edited in source mode. Decision recorded in `DECISIONS.md` before the UI was built.
- **Writing surface** (`web/src/editor/`): Markdown input rules, slash menu (registry), `[[` autocomplete (fuzzy, diacritic-insensitive, path form for duplicate titles, "Tạo"), wikilinks with ghost/ambiguous states and "Chọn đích…", `#` tag autocomplete and pills, `📅`/`@` date picker with urgency chips and visible relative text, round task checkboxes, Tab/Shift+Tab list nesting, Markdown paste, focus mode.
- **Note screen and session** (`web/src/features/note*`, `drafts`, `conflict`, `properties`): title = file name (rename with relink), autosave 500 ms with a truthful indicator (Đang lưu… / Đã lưu / Bản nháp / Lỗi lưu – Thử lại / Xung đột), IndexedDB drafts per window, three-version conflict screen (Tải lại / Giữ bản của tôi / So sánh), property bar with typed editors and YAML-aware patches, source mode (`Alt+S`), banners (draft restored, set-aside versions, non-UTF-8, wiki, control docs, templates).
- **Shell** (`web/src/lib/`, `features/sidebar|tabs|toasts|dialogs|journal|connection`): typed API client, WebSocket client with resync, per-vault browser storage, WAI-ARIA sidebar tree (keyboard, context menu, inline rename, drag to move, Inbox badge, urgent dot), tabs (max 20, persisted per vault), undo toasts through the journal, modal dialogs, unfinished-operation and connection banners, focus recovery, shortcut registry.
- **Right panel, tags, search** (`features/backlinks|mentions|outline|tags|search`): backlinks with highlighted context, unlinked mentions with "Liên kết", outline, "Thẻ" view nested by `/`, `Ctrl+K` palette with filters and "Tạo".
- **Server** (`server/src/api|vault|markdown|mentions`): `PATCH /note/frontmatter` (line patches, comments kept), dry runs for rename/move/folder rename, unlinked mentions + link-mention (`\|` inside tables), folder rename/trash (journaled, undoable), `POST /reveal`, `PUT /note` with `conflictCopy`, `POST /note` with `unique`/`content`, `GET /link-targets`, backlink highlights (index schema v3, automatic rebuild).

## Acceptance criteria assigned to M2

| AC | Verification |
|---|---|
| F2.1 collapsed state and expanded folders persist per vault | `web/src/features/sidebar/sidebar-tree.test.tsx` "sidebar tree rendering and refresh (F2.1, F2.3)", `web/src/app/app-shell-panes.test.tsx` (panes remembered per vault), `web/src/lib/tree-store.test.ts` |
| F2.2 create/rename/move/trash update tree and disk, 10 s undo toast through the journal | e2e `web/e2e/sidebar-tree.spec.ts` (F2 rename with relink → undo, Delete → undo, on disk); `web/src/lib/note-operations.test.ts`, `folder-operations.test.ts`, `features/sidebar/sidebar-tree-keyboard.test.tsx`, `sidebar-tree-menu.test.tsx`; server `api/folder-operations-api.test.ts`, `vault/vault-folder-journal.test.ts`, `vault/vault-folder-trash.test.ts`, `integration/folder-operations-watcher.test.ts` |
| F2.3 Inbox badge = notes in `0 Inbox`, updates within 1 s | `sidebar-tree.test.tsx` (WS event → refetch within the 150 ms debounce), `tree-store.test.ts`; server `api/websocket-hub-and-tree.test.ts` |
| F2.4 full keyboard operation of the tree | `sidebar-tree-keyboard.test.tsx` "sidebar tree keyboard, menu, rename, trash, drag (F2.2, F2.4)"; e2e `sidebar-tree.spec.ts` (keyboard only) |
| F3.1 round-trip corpus: no edit → no write; one word, one tick, one property, one link rename → only that change | `web/src/editor/markdown/markdown-round-trip.test.ts` (57 files × LF/CRLF/BOM/NFD), `markdown-random-documents.test.ts`, `markdown-adversarial-documents.test.ts`, `markdown-distant-edits.test.ts`, `markdown-save-seams.test.ts`, `extensions/task-toggle.test.ts`; property: server `markdown/frontmatter-patch.test.ts`; link rename: server `markdown/relink.test.ts`, `relink-meaning.test.ts`; e2e "opening and closing a note never writes it (P1)" |
| F3.2 unsupported constructs survive byte-identical, editable in source mode | `markdown-verbatim.test.ts` (21 constructs), `extensions/editor-blocks.test.ts` (verbatim node read-only) |
| F3.3 input rules without stray symbols; `/` menu only at an empty line start, Esc, arrows + Enter | `extensions/markdown-input-rules.test.ts`, `popups/slash-menu.test.tsx`; e2e S3a |
| F3.4 autosave within 1 s, "Đã lưu" only after the server confirmed, error state with server down, resumes without loss | `features/note-session/note-session-autosave.test.ts`, `features/note/note-screen-save-states.test.tsx`; e2e `note-safety.spec.ts` "save states" (in-flight save shows "Đang lưu…", disk full, server unreachable → resumes); review B: real server killed and restarted, saving resumed in 1.8 s without loss |
| F3.5 killed tab → draft restored with banner; conflict when disk changed | `note-session-drafts.test.ts`, `drafts/draft-store.test.ts`, `note-screen-banners.test.tsx`; e2e "a draft typed while the server is unreachable survives a killed tab and is restored" |
| F3.6 two windows: 409 → base/disk/mine with three actions; keep mine leaves a trash copy `reason: conflict` | `note-session-conflicts.test.ts`, `conflict/line-diff.test.ts`, server `vault/vault-conflict-copy.test.ts`; e2e "two windows: the second save gets the conflict screen; keep mine trashes the disk copy" |
| F3.7 editing the title renames with relink; tabs, sidebar, backlinks follow | `note-session-operations.test.ts`, `note-session-rename.test.ts`, `note-screen-editing.test.tsx`; e2e "renaming from the title lists the linking notes, rewrites their links and can be undone"; review B (tabs, tree, backlinks by hand) |
| F3.8 source mode shows the exact bytes, saves through the revision contract | `note-session/source-text.test.ts`, `note-screen-editing.test.tsx` ("Alt+S shows the exact text…"), `note-session-races.test.ts` |
| F4.1 `[[` popup ≤ 100 ms, `giai tich` / `dai so` match | `popups/wikilink-menu.test.tsx` (5,000 titles < 100 ms), server `api/link-targets-and-tags-api.test.ts`; e2e S3a (`[[giai tich` → "Giải tích 1") |
| F4.2 resolution rules (unique, same folder, shortest path, ambiguous, path form, code exclusion, NFC/NFD) | server `markdown/resolve-link.test.ts`; client `web/src/lib/link-resolution.test.ts` (same matrix); `wikilink-view.test.tsx` (path form for duplicates, "Chọn đích…") |
| F4.3 two `Bài 1.md`: rename rewrites only links that resolved to it (all forms, not in code) | server `markdown/relink.test.ts`, `relink-meaning.test.ts`, `index/index-relink-planner.test.ts` |
| F4.4 move converts title links to path form where needed | server `markdown/relink.test.ts` "planRelinkEdits on move (F4.4)" |
| F4.5 ghost link click creates `0 Inbox/<Title>.md` (`type: note`, `created`) and opens it | `extensions/wikilink-view.test.tsx`; server `api/note-create-save-api.test.ts` |
| F5.1 backlinks update within 1 s of saving the linking note | `features/backlinks/note-panel.test.tsx` (refetch 200 ms after the WS event); e2e S3a (course note lists the lecture with the link highlighted) |
| F5.2 "Liên kết" patches exactly one occurrence at the revision | server `api/note-mentions-api.test.ts` (diff test, stale revision 409, table rows use `\|`), `markdown/title-mentions.test.ts`; `features/mentions/mentions-section.test.tsx` |
| F6.1 tag autocomplete diacritic-insensitive with `/` nesting | `popups/tag-menu.test.tsx`; server `markdown/parse-note-tags-tasks.test.ts` |
| F6.2 inline + front-matter tags count once per note | server `api/link-targets-and-tags-api.test.ts`; `features/tags/tag-tree-model.test.ts` |
| F6.3 clicking a pill anywhere opens the filtered search | `features/tags/tags-screen.test.tsx`, `extensions/inline-decorations.test.ts` (pill → `openSearch('tag:…')`), `properties/property-bar.test.tsx` |
| F7.1 changing/adding/removing one key changes only its lines | server `markdown/frontmatter-patch.test.ts` (comments, nested lists, quoted strings, CRLF, BOM), `api/note-frontmatter-api.test.ts`; UI `properties/property-bar.test.tsx`, `note-session-operations.test.ts` |
| F7.2 invalid YAML shown raw with a warning, bar disabled, no auto-fix | server `frontmatter-patch.test.ts` "front matter refusals leave the file alone (F7.2)"; `property-bar.test.tsx` |
| F7.3 setting `deadline` → on Today strip and calendar within 1 s | server `api/note-frontmatter-api.test.ts` (deadline service right after the response). The Today strip and calendar UI arrive in M3 |
| F23.1 tabs restore per vault, limit 20, closing the last tab shows Today | `web/src/lib/tabs-store.test.ts`, `features/tabs/tab-bar.test.tsx`, `app/app-shell-focus.test.tsx` |
| F20.1 save-state indicator saving/saved/draft/error/conflict | `note-screen-save-states.test.tsx`, `note-session-autosave.test.ts`; e2e `note-safety.spec.ts` (saving, error with disk full and with the server unreachable, conflict) |
| F20.2 undo after the target changed → conflict message naming the note, nothing changed | `note-operations.test.ts`, `lib/undo-toast.test.ts`, server `vault/vault-journal-conflicts.test.ts` |

DoD: **S3a end to end** – e2e `note-writing.spec.ts` "S3a" (Alt+N → Lecture → name → Markdown typed as you write → `[[` link → saved → backlinks of the course note). **Concurrent writers** – e2e two windows + `note-session-conflicts.test.ts` + server M1 concurrency tests. **Interrupted rename** – server `vault-journal-recovery.test.ts`, `vault-folder-journal.test.ts` (every step), `journal-recovery-api.test.ts`.

## Results (build container, Linux, Node 22.22, 2 vCPU)
| Command | Result |
|---|---|
| `npm test` | 182 files, 2,671 passed, 3 skipped (Windows-only / generated-vault) |
| `npm run lint` | exit 0 (ESLint, raw colors, i18n parity, contrast 90/90) |
| `npm run typecheck` | exit 0 |
| `npx prettier --check .` | clean |
| `npm run test:e2e -- --repeat-each=3` | 30/30 (10 scenarios × 3, Chromium) |

Performance: one-block edit save in a 5,000-block note 4–7 ms; 2 MB note save 17–28 ms; `[[` popup with 5,000 titles < 100 ms; `GET /link-targets` on the 5k vault 20.6 ms p95. Loading a 2 MB note takes ~5 s here (parser-bound, see known gaps); a 50 KB note ~0.25 s.

## Independent review
Two read-only reviewers (data safety; UI/spec/accessibility in a real browser). Confirmed findings fixed with regression tests: distant edits rewrote the blocks between them; deleting a block between two lists merged them; the save check ignored text after the last block; ticks on soft-wrapped tasks; "Liên kết" breaking table rows; property edits dropping comments; Alt+S during a property patch; a late save over a source-mode edit; rename revision adoption; drafts shared between windows; editor view after an inexact save; set-aside versions unreachable; heading of a template note keeping "Ghi chú mới"; caret moved after naming; focus falling to `<body>`; urgency shown by colour only; date sticking to the next word; Tab leaving lists; status list keyboard; missing context menu items; pinned "Ghi chú mới"; row names; rename field focus ring; toasts expiring behind dialogs; undo conflict naming the notes; palette "Tạo" with unrelated results; duplicate mention button names; flaky e2e scenarios. Reports: `plans/2026-10-19-m2-editor-notes/reports/review-a-data-safety.md`, `review-b-ui-spec.md`.

## Manual checks for the owner (Windows)
1. Close the running app, double-click `D:\SECONDBRAIN\Mở Second Brain.cmd` (the first start after this update reinstalls libraries and rebuilds; the index rebuilds once for schema v3).
2. Press `Alt+N`, pick "Lecture", type a title, Enter, write with `## `, `**đậm**`, `- [ ] `, `[[` – watch "Đã lưu".
3. Open the course note you linked: the lecture is listed under "Liên kết đến đây". Rename a note from its title and from the tree (`F2`), then "Hoàn tác".
4. "Hiện trong Explorer" from the tree context menu opens Explorer with the file selected (Windows-only path, tested with an injected launcher here).

## Known gaps
- Loading a very large note (≈ 2 MB) takes several seconds on the main thread; a worker or a fast path is revisited if real notes need it.
- Verbatim (source mode only): math, HTML, footnotes, headings 4–6, callouts, reference links, code fences with more than a language, mixed task/plain lists, ordered task lists, ragged tables. A literal `[` in an edited paragraph is written `\[` (renders the same).
- Lists nested inside a quote or list item that merge after a deletion are written in the canonical style (`exact: false`, nothing lost).
- "Tải lại" keeps every set-aside version; only the newest is reviewed from the banner (a list view later).
- Palette recents = open tabs + recently modified notes until M3 adds a "recently opened" history; F7.3 is verified at API level until the Today strip/calendar UI (M3); the shortcut sheet and PWA shortcut matrix come in M3/M4.
- A new window may restore and save another still-open window's draft (nothing is lost; the other window then shows a conflict that settles when both texts are equal).
- Titles containing `[ ] | # ^` cannot be linked from "Nhắc đến chưa liên kết".
