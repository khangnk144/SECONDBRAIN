# Decisions

Record any deviation from `../SPEC.md` or `../design.md` here **before** making it (SPEC §0 rule 5). Format:

```
## <YYYY-MM-DD> <short title>
Context: …
Decision: …
Why: …
Spec sections affected: …
```

## 2026-10-18 Agent tooling: ClaudeKit subset in app/
Context: The owner has a local copy of ClaudeKit (`D:\Claude_Kit`) with 88 skills.
Decision: Install 45 relevant skills plus agents, rules and hooks into `app/.claude` and `app/.codex`; drop media, payments, mobile, 3D, shadcn/Tailwind, Postgres and other irrelevant skills. Project rules in `CLAUDE.md` override skill defaults.
Why: Fewer, relevant skills mean better routing and less context noise; the kit lives in `app/` so the vault's own `CLAUDE.md` (Phase 3, AI wiki schema) never mixes with coding rules.
Spec sections affected: none.

## 2026-10-18 Node engines `>=22.12` instead of `>=22`
Context: SPEC §1.3 pins Node 24 LTS with engines `>=22`. Vite 8 and Vitest 5 require Node `^22.12` or `>=24`.
Decision: `engines.node` is `>=22.12`; `.nvmrc` stays `24`. The launcher checks for 22.12+.
Why: Node 22.0–22.11 cannot run the build toolchain; the locked target (Node 24) is unaffected.
Spec sections affected: §1.3 (engines range only).

## 2026-10-18 Library major versions
Context: Latest majors at M0 time: React Router 8 (needs React 19), TypeScript 7 (native port, not yet supported by typescript-eslint).
Decision: React 18.3.1 (locked by SPEC) with react-router 7.18; TypeScript 5.9.3. All versions pinned exactly in package.json.
Why: Stay on the stack SPEC §8 names while keeping lint/test tooling compatible.
Spec sections affected: none (§8 asks for pinned versions).

## 2026-10-18 Launcher location
Context: SPEC §3 places `Mở Second Brain.cmd` at the install root; §8 lists it under `app/launcher/`.
Decision: The logic lives in `app/launcher/start-second-brain.ps1` (tracked in git). `D:\SECONDBRAIN\Mở Second Brain.cmd` is a thin copy of `app/launcher/root-wrapper.cmd` that calls it.
Why: Keeps the launcher versioned with the code while the owner still double-clicks a file at the root.
Spec sections affected: §3, §8, F21 (no behavior change).

## 2026-10-18 Dev-mode CSP relaxation
Context: SPEC §5 requires `default-src 'self'` and no inline scripts on the UI shell. In `npm run dev`, Vite injects the React refresh preamble as an inline script and CSS as `<style>` tags, and HMR uses its own websocket.
Decision: Production (`npm start`, launcher) uses the strict CSP. Dev mode only adds `'unsafe-inline'` to `script-src`/`style-src` and the HMR websocket to `connect-src`.
Why: HMR is needed for development; the owner never runs dev mode.
Spec sections affected: §5 Security (dev mode only).

## 2026-10-18 Server log location before a vault exists
Context: SPEC §5 puts logs in `vault/.secondbrain/logs/`. M0 has no vault yet.
Decision: Until the vault service exists (M1), the server logs to `<install root>/.secondbrain/logs/server.log` (5 MB rotation, no tokens, no query strings, no note content). M1 moves logging into the vault.
Why: The launcher needs a log to show when startup fails.
Spec sections affected: §5 Logs (temporary).

## 2026-10-18 Commit messages
Context: The system default adds AI co-author trailers; `.claude/rules/development-rules.md` says commit messages carry no AI references.
Decision: Follow the repo rule: conventional commits plus `milestone N: <summary>`, no AI trailers.
Why: The owner's repo rules take precedence.
Spec sections affected: none.

## 2026-10-18 Extra API error codes and headers
Context: SPEC §9 lists error codes for vault/AI operations; the M0 security layer needs codes for its own refusals.
Decision: Add `UNAUTHORIZED` (401, missing/wrong token), `MISDIRECTED_REQUEST` (421, Host not allowed) and `INTERNAL` (500). Every response also carries `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin`. The 127.0.0.1 → localhost redirect applies to the UI shell only; `/api/*` is answered directly on both allowed hosts (the launcher probes `http://127.0.0.1:<port>/api/health`).
Why: Same `{error:{code,message}}` shape for every refusal; the extra headers cost nothing for a same-origin app; on Windows `localhost` may resolve to `::1` first while the server binds `127.0.0.1` only.
Spec sections affected: §5, §9 (additive).

## 2026-10-18 Vite config loading in dev
Context: With Vite's default config loader, the bundled temp copy of `vite.config.ts` is written and deleted next to the sources, which made `tsx watch` restart the server in a loop.
Decision: The dev server starts Vite with `configLoader: 'runner'`.
Why: Stable `npm run dev`.
Spec sections affected: none.

## 2026-10-18 Web shell details left open by design.md
Context: design.md gives Vietnamese copy only; §4 says the left pane becomes a sliding menu below 900 px (mobile polish is Phase 2 per SPEC F28).
Decision: English greetings "Good morning / Good midday / Good afternoon / Good evening / Up late, {{name}}." Below 900 px the sidebar becomes a top bar with horizontally scrolling nav (folders hidden) until the Phase 2 drawer. `tokens.css` keeps design.md values but is Prettier-formatted (lowercase hex, single-quoted attribute selectors); the contrast checker parses both quote styles.
Why: Keeps M0 small without breaking narrow layouts.
Spec sections affected: F10 (EN copy), F28 (interim), design.md §4/§10 (formatting only).

## 2026-10-18 gen-vault output details
Context: SPEC §5 asks for a generated 5,000-note vault.
Decision: The generator writes its counts to `<out>/.secondbrain/gen-vault-summary.json` (so the indexer never sees it as a note) and refuses non-empty folders and anything inside `<install root>/vault`. `scripts/lib/gen-vault/vocabulary.ts` exceeds 200 lines because it is only word lists.
Why: Deterministic, safe fixture for the M1+ performance checks.
Spec sections affected: §5 Performance, §11.

## 2026-10-18 POST /api/shutdown and origin-form-only requests
Context: The launcher's `stop` could only kill the process (no graceful shutdown on Windows, where `Stop-Process` is a hard kill), and F20 will need a clean shutdown for the auto-commit; F21 needs "Thoát Second Brain". The independent review also showed that an absolute-form request target (`GET http://localhost:4747/api/settings`) slipped past the path-based token check.
Decision: Add `POST /api/shutdown` (token, Origin and Host rules like every `/api` route; any body ignored; 202 then graceful close and `server.json` removal). The launcher calls it first and only falls back to `Stop-Process` after checking the PID's command line. Every request whose target does not start with `/` is refused with 400 `VALIDATION` before any other check.
Why: Graceful stop now, one code path for the later Settings button; closes a token bypass for non-browser local clients.
Spec sections affected: §9 (new route), §5 (stricter), F21.

## 2026-10-18 Launcher kept as one PowerShell file; lint skip pattern for message kinds
Context: `launcher/start-second-brain.ps1` grew to ~345 lines (start, stop, lock, graceful shutdown). The i18n rule checks every argument of toast/notify/error helpers.
Decision: Keep the launcher as one file (splitting it would mean dot-sourcing several UTF-8-with-BOM files on Windows PowerShell 5.1). In message-helper calls, identifier-like ASCII arguments (`'info'`, `'save-ok'`, `'fieldName'`, camelCase allowed) are treated as kinds/keys, not UI text.
Why: Fewer moving parts on the owner's machine; no false positives on variant arguments.
Spec sections affected: none (code-size guideline only).

## 2026-10-18 M1: scope pulled forward and spec readings
Context: Some M1 acceptance criteria depend on features scheduled later, and a few SPEC rules leave room for interpretation.
Decision:
- **Relink in M1 (server side).** F1.7 needs an interrupted rename-relink, so the relink planner (F4 rules: title/path/alias/heading/embed/`course:` forms, never inside code) and `POST /note/rename|move` exist from M1. F4 acceptance (UI, autocomplete) stays in M2.
- **F1.3 without a sidebar.** The sidebar UI is M2 (F2); in M1 "external edits reflected within 1 s" is verified through the index, `GET /note`, `GET /tree` and the WebSocket events.
- **Title ties.** "Shortest path" in SPEC §4.4 = fewest path segments; still tied → ambiguous. "Same folder" = same parent folder. Templates are excluded from title lookup (the path form still reaches them) so `[[Paper]]` never turns ambiguous because of a template.
- **Done items.** An item is done when the task is ticked **or** its note has `status: done` (both kinds), so a finished project stops producing reminders for leftover tasks.
- **User folders.** `.md` files in a top folder the user created (not one of SPEC §3) are user notes.
- **Templates on start.** Bundled templates and `CLAUDE.md` are written only when a vault is initialized (no `vault.json` yet); standard folders are re-created on every start. A template the user deletes stays deleted until Settings "Khôi phục mẫu gốc" (resolves F1 "create if absent" vs F14.1 "restore action").
- **Empty search.** With no query and no filters the server returns the 8 most recently modified notes; the client replaces them with recently opened notes in M3.
Why: Keeps every M1 AC testable now and picks the least surprising behaviour for the owner.
Spec sections affected: §4.4, §4.7, §4.2, F1, F4, F8, F14 (interpretations, no contract change).

## 2026-10-18 M1: vault service details
Context: SPEC §4.10–§4.13 fix the contract; the implementation needed concrete choices.
Decision:
- Path guard does not percent-decode (the HTTP layer decodes once; a literal `%2e%2e` is a file name). Reserved names include `COM¹–³`/`LPT¹–³`. `list()` skips symlinks and names the guard would refuse.
- Reads match names case-insensitively only on Windows; existence checks for create/rename/restore targets are case- and NFC-insensitive on every platform; NFD names on disk are reached through their NFC vault path.
- Trash layout: `trash/<ulid>/meta.json` + `trash/<ulid>/files/<original path>`; restore collisions get ` (restored)`, ` (restored 2)`…; `purgeTrash` (30 days, at start) keeps entries an unfinished operation still needs.
- Journal: entries in `state/journal/<id>.json`; content rewrites keep `before`/`after` copies in `state/journal/<id>/`; rename/trash/restore steps keep no byte copy (the file moves unchanged and its revision is re-checked). Status `undoing` added so an interrupted undo resumes. A runtime failure mid-operation rolls back automatically (`undone`); only a failed rollback stays pending (`failed`). Finished entries are pruned after 30 days.
- Case-only/NFC-only renames go through an interim `.<name>.<hex>.renaming` name (never removed by the temp cleanup).
- A write producing identical bytes is a no-op (no disk write, no event). An unreadable `vault.json` stops the open (the identity is never replaced).
Why: Data safety first; everything stays recoverable from the journal or the trash.
Spec sections affected: §4.10–§4.13, §5 Path guard (implementation detail).

## 2026-10-18 M1: fast Markdown scanner for indexing
Context: Parsing the 5k/51 MB performance vault with the full remark pipeline took ~45 s on the build container; the whole cold reindex budget is 15 s (SPEC §5).
Decision: `parseNote` uses a dependency-free line scanner that follows CommonMark/micromark block and inline rules for what the index needs (front matter, code/HTML exclusion, wikilinks, tags, tasks, headings, links, readable text). Notes with constructs it does not model exactly (link-reference or footnote definitions, uncommon named entities, a few bare-URL edge cases) fall back to the full remark parse. Differential tests compare both paths on fixtures (LF/CRLF/BOM/NFD variants), 1,800 seeded random documents in CI and the whole generated vault (0 differences). `plainText` is readable text, not byte-exact mdast text. Front matter uses its own fence detection (also accepts the `...` closer) and `yaml` with the core schema. The M2 editor keeps remark for its block model.
Why: 1.3–2.3 s instead of ~45 s for the 5k vault, with the same links/tags/tasks.
Spec sections affected: §4.14 (implementation), §5 Performance.

## 2026-10-18 M1: index, search and event log details
Context: SPEC §4.14/§4.15/F8 define the schema and behaviour; details were open.
Decision:
- Additive tables/columns: original plain text for snippets, a `files` table for non-note link targets, link kind/alias/front-matter key/target key/line text, task line text and invalid dates. The index file is ~2.8× the vault text size (normalized + original text). Startup corruption check = `quick_check` per table (0.1 s on 5k notes).
- `.html` files in `3 Resources` are indexed as raw sources (text without tags, title = file name, `<title>` searchable).
- Search: AND of prefix terms; a "title match" needs every term in the title; multiple `tag:` filters must all match, the last `folder:`/`type:`/`due:` wins, an unknown `due:`/`class:` value is searched as text; `tag:x` includes nested `x/…`; `due:7d|30d` = open items 0…N days ahead, overdue only via `due:overdue`. Tag lists/counts include searchable classes only. Backlinks omit self-links (relink still sees them).
- Event log: `note_*` events for `.md` files only; a deletion logs only `note_deleted`; re-resolution is logged on the linking note; the first index writes approximate `note_created` lines only. Known noise: a relinked rename logs a transient ghost `link_added`/`link_removed` pair per affected note (same millisecond), harmless for the Phase 2 time scrubber.
- Task groups: `today` = due today, `next7` = 1–7 days.
Why: Matches what the screens in M2/M3 need while staying inside the §5 budgets.
Spec sections affected: §4.14, §4.15, F8 (additive).

## 2026-10-18 M1: server wiring details
Context: SPEC §9 lists the routes; M1 serves the ones its features need.
Decision:
- Routes served in M1: health (with `vaultId`), tree, note GET/PUT/POST, note rename/move/trash, journal pending/undo/complete, folder create, search, today, calendar, tasks, tags, files, templates list/restore, index rebuild, sample-data GET/POST/DELETE. Property/task/append patches, daily, attachments upload, history, reminders and settings writes come with their features.
- Note routes accept `.md` only; other files go through `GET /files` (images inline; SVG only with a sandbox CSP; everything else as attachment + nosniff). `POST /note` without a template writes `type: note` + `created`; `template` is a path under `Templates/`; `{{title}} {{date}} {{time}}` substituted, `{{cursor}}` removed (caret placement is M3).
- WebSocket `note:*` events cover every vault file (attachments too) so the tree can refresh; `note:renamed` carries the revision; after a watcher error the server re-scans and sends `index:progress` `done` so clients reload. An external folder deletion/rename triggers a re-scan. Saves during a rebuild answer immediately; their events follow after the swap. The watcher's echo of an app write is dropped only when the index already agrees.
- Startup outcome `vault-unusable` → exit code 3 with a line in the global log. After the log moves to `vault/.secondbrain/logs/app.log`, errors are also copied to the global `server.log` the launcher shows.
- Sample data: 22 files (incl. the ambiguous pair `1 Projects/Ghi chú.md` / `2 Areas/Ghi chú.md`). `DELETE` keeps `state/sample.json` with `files: []` + `removedAt` so the first-run offer does not come back; `POST` refuses (409 `EXISTS`, nothing created) when a user file already uses a sample name.
Why: Smallest surface that M2/M3 can build on; nothing user-visible depends on routes that do not exist yet.
Spec sections affected: §9 (subset + additive), §10.

## 2026-10-19 M1 review round: stricter data-safety and link rules
Context: Two independent reviews (data safety/security; parsing/index correctness) found defects; the fixes needed a few rules SPEC does not spell out.
Decision:
- **Never re-encode a file.** `NoteRead.utf8` reports whether the bytes are valid UTF-8. `write`/`patch` refuse a non-UTF-8 file (`VALIDATION`, `reason: 'not-utf8'`), relink leaves it unchanged and lists it in `skipped`. Writes/patches also refuse symlinks (`reason: 'symlink'`) and files over 1 GiB (`reason: 'too-large'`); rename/trash refuse symlink sources.
- **Relink keeps every link's meaning.** Besides SPEC F4 (links to the renamed note follow it), any other link in a candidate note whose resolution would change because of the operation (renaming into an existing title, the moved note's own same-folder links) is pinned to its old target's path form. Links that were ghost or ambiguous before stay untouched. Candidates = notes resolving to the note, notes naming its old or new title/path, and the note itself; the planner first waits for pending index updates. Links that cannot be written so they still resolve (titles with `#`, `[`, `]`, `|`) are left as they are and reported as `unresolvable`. Front-matter rewrites respect YAML quoting and must still parse.
- **Link identity is NFC + lowercase only** (`linkIdentityKey`): `đ` and `d` are different letters for resolution (SPEC §4.14 "never use normalized forms for file identity"); search and tags keep the đ→d folding. `tag:` filters are also diacritic-insensitive (F6.1), schema version 2.
- **Temp names** are short fixed-length `.sb-<12 hex>.tmp` / `.sb-<12 hex>.renaming` (older long forms still recognised), so names up to 255 characters stay writable; `ENAMETOOLONG` → `WRITE_FAILED`. `create()` uses a hard link for no-clobber creation, falling back to check-then-rename where links are unsupported (FAT/exFAT). Atomic replace keeps the POSIX mode. Results and events always carry the canonical on-disk spelling (NFC).
- **Boot never fails on housekeeping** (temp cleanup, journal pruning, trash purge, template/folder creation): failures are logged as warnings with counts and codes only.
- **A vault may not overlap the install**: a vault folder equal to, containing or inside `<home>/.secondbrain` or the app folder is refused (`vault-unusable`), so settings.json can never become a vault file.
- Interrupted case/NFC-only renames never land on a name that a file now uses (conflict instead). Journal/trash JSON is validated (ULIDs, guarded paths) before use.
- Index: links to paths that vanished during a rebuild are re-resolved after the build and in the post-swap queue; reconcile repairs dangling resolved links; a failed open after the swap restores `index.sqlite.previous`; Windows side-file deletes retry. Server tests run with `TZ=Asia/Ho_Chi_Minh` by default (override with `TZ=…`).
Why: The owner's files must never be silently changed, re-encoded or lost, and a rename must never change what an unrelated link points to.
Spec sections affected: §4.4, §4.9, §4.10, §4.14, §5 Path guard/Reliability, F4 (stricter, additive).

## 2026-10-19 M2: work order around the editor spike
Context: SPEC §12 asks for the editor spike (F3.1/F3.2 on the corpus) before the rest of M2.
Decision: The spike ran first for everything that depends on the converter (editor UI, note session, source mode). Work that does not touch the converter – server routes, the web data layer, sidebar tree, tabs, toasts, dialogs, right panel, tags view and search palette – ran in parallel with it. Translations are split into feature files (`web/src/i18n/locales/<area>.<lang>.json`, merged under `<area>`; the parity script checks the merged trees) so parallel tracks never edit the same JSON.
Why: The spike's risk is the preservation contract; the parallel parts would be built the same way whatever the converter outcome.
Spec sections affected: §12 (ordering only), F19 (file layout of translations).

## 2026-10-19 M2: server additions
Context: M2 screens need routes SPEC §9 lists only in outline, or not at all.
Decision:
- `PATCH /note/frontmatter` is a YAML-aware text patch (only the edited keys' lines change; new keys before the closing fence; a new block at the top when there is none). Writable values: scalars and flat lists; key names start with a letter or `_`; one value style (dates plain, strings plain or double-quoted, `"[[X]]"` always quoted, lists in flow style); a value already set writes nothing; after patching, the YAML must parse and every key and the body must read back as intended. Refusals carry `details.reason` (`invalid-yaml`, `duplicate-key`, `not-mapping`, `invalid-key`, `unsupported-value`, `patch-verify`).
- Rename/move/folder-rename accept `dryRun: true` (same planner and checks, nothing changes) so the confirm dialog can list affected notes before anything moves.
- Unlinked mentions: `GET /note/mentions` + `POST /note/link-mention` (whole-word, NFC- and case-insensitive, outside code/HTML tags/links/URLs/front matter; writes `[[Title]]`, `[[Title|original]]` when the case differs, or `[[path/Title|original]]` when the title is not unique; titles containing `[ ] | # ^` cannot be linked).
- Folders: `POST /folder/rename` (also moves under another parent; relinks path-form links and embeds, pins links whose ambiguity would change) and `POST /folder/trash` (one trash entry keeping the structure, empty folders included via `meta.json` `folders`). Both are one journaled directory-move step; standard folders of SPEC §3 and their fixed subfolders are refused with `FORBIDDEN`. File revisions inside a moved folder are not re-checked on undo (moving it back loses nothing); relinked notes are.
- `POST /reveal` opens the OS file manager for a file or folder (never through a shell). `PUT /note` with `conflictCopy: true` stores the current disk version as a trash entry (`reason: conflict`) before writing ("Giữ bản của tôi"); no journal entry (a crash leaves at worst an extra conflict copy). `POST /note` accepts `unique: true` and exact `content`. `GET /link-targets` lists linkable notes (templates included with `unique: false`) and other files for autocomplete and link rendering. Backlinks carry the link's `highlight` offsets; index schema version 3 (automatic rebuild on the first start).
Why: Every change stays revision-checked, journaled or trash-backed, and the UI can show consequences before acting.
Spec sections affected: §4.10, §4.11, §4.12, §4.14, F2, F4, F5, F7, §9 (additive).

## 2026-10-19 M2: web shell behaviour
Context: SPEC F2/F22/F23 leave interaction details open.
Decision:
- Tabs: one tab per note (opening a note that already has a tab activates it); closing the active tab activates its right neighbour, else the left one; a 21st tab replaces the least recently active one with a toast; `Alt+W`, `Alt+[`, `Alt+]` act while a note is on screen.
- Shortcuts: one registry; ignored in plain form fields unless a shortcut allows it, active in the editor, suspended while an overlay is open.
- Sidebar tree shows folders and notes only (attachments arrive with the M4 "Tài liệu" view). Deleting a folder that contains notes asks first; deleting a note only shows the undo toast. "Thư mục mới" also offers undo (trashes the folder only while it is still empty). On first run `0 Inbox` and `1 Projects` start expanded. Leaving the inline rename field commits a valid name (like Explorer). Names are trimmed and NFC-normalized; names starting with "." or longer than 200 characters are refused before any request.
- Pane toggles (`Alt+1`/`Alt+2` and buttons) sit in a toolbar row above the screen, with the tab bar between them on the note route. The connection banner shows above the main content on every screen (F10.6's placement inside Today comes with M3).
Why: Predictable, browser-like behaviour with every shortcut also reachable by a button or menu.
Spec sections affected: F2, F22, F23 (interpretations).

## 2026-10-19 M2 editor spike: Tiptap + block-preserving converter holds
Context: SPEC §13 names the converter the riskiest item; M2 starts with a spike against the §4.9 corpus (F3.1/F3.2).
Decision: Keep Tiptap 3. `web/src/editor/schema` defines the node/mark types (StarterKit/TableKit unpacked; code combines with other marks; lists carry `loose`; table cells hold one paragraph; `wikilink` inline atom; `verbatimBlock` atom allowed only at document level). `web/src/editor/markdown` parses with remark + GFM (in verified chunks, because micromark slows down sharply as one parse holds more lists and quotes), maps each top-level block to an editor node only when the mapping is exact (otherwise a verbatim block written back from its original bytes), and saves by matching nodes with `eq()`: unchanged blocks byte for byte, changed lists/quotes item by item (a tick is a text patch: `[ ]`↔`[x]` plus the ` ✅ date` token), everything else in the canonical style; each changed region is re-parsed and compared before it is accepted, falling back to less preservation and finally to canonical text reported as `exact: false` (never dropped).
Why: Identity, local edits, one-line ticks and canonical re-parse equality hold on a 57-file corpus × LF/CRLF/BOM/NFD, 520 seeded supported documents and 800 adversarial documents (1,309 tests); no case dropped content. Tiptap hosts verbatim blocks as plain atom nodes, so the ProseMirror-only fallback is not needed.
Limits accepted for M2: loading a 2 MB note takes ~5 s on the 2-vCPU build container (parser-bound; saves ~25 ms; a one-block edit in a 5,000-block note ~5 ms) – the note screen shows a loading state, and a worker or a fast path is revisited only if real notes need it. Verbatim (source mode only): headings 4–6, HTML (blocks, inline, comments), math, footnotes, reference-style links and definitions, `:::` containers, Obsidian callouts, code fences with more than a language, lists mixing tasks and plain items, ordered task lists, ragged tables, wikilinks inside link text/alt text/across emphasis. Empty paragraphs and trailing hard breaks have no Markdown form and are not saved. Canonical-style exceptions: `***` for a rule where `---` would turn into front matter or a setext heading, autolinks only when they parse back, adjacent new lists switch marker.
Spec sections affected: §4.9, F3 (implementation).

## 2026-10-19 M2: right panel, tags view and search palette
Context: SPEC F5/F6/F8 describe behaviour; the palette's full AC set (filters, commands, performance) belongs to M3.
Decision:
- Right panel order follows design.md screen 2: Mục lục, Liên kết đến đây, Nhắc đến chưa liên kết (collapsed and fetched only when opened). It reflects the last saved text (refreshed ~200 ms after any vault event), not unsaved typing. Links open the note at `&line=N`, a 1-based file line that counts the front matter (same as the server's backlink lines). A successful "Liên kết" shows a 4 s confirmation toast.
- Tags view nests by `/`; a parent nobody tagged directly is a group without a count (clicking it still searches `tag:<parent>`).
- Search palette (M2 subset): empty query lists the open tabs by last activation, then the server's recently modified notes, up to 8 (a per-vault "recently opened" history comes with M3); "Tạo '<q>'" appears only when `<q>` is a valid note name (not for filter queries); rows show the full parent folder path; the result list is a tagged union so M3's `>` command mode adds a kind without a rewrite.
- Tests: the web Vitest project runs with `fsModuleCache: false`, because the persistent module cache keys the translation index on its own content and would hide new `locales/*.json` files from `import.meta.glob`.
Why: Matches the design order and keeps M3's palette work additive.
Spec sections affected: F5, F6, F8 (M2 subset).

## 2026-10-19 M2: editor behaviour
Context: SPEC F3/F4/F6 describe the writing surface; several details were open.
Decision:
- The Tiptap editor runs on the converter's own schema instance (swapped in before creation; an extension that changed the node or mark set would throw), so saves keep node identity. History depth 200. StarterKit's trailing node is off (a click below a final non-text block adds a line instead).
- Extra input rules: `- [ ] `/`- [x] ` turns a fresh one-item bullet list into a task list (inside a longer bullet list the text stays, since mixed lists are verbatim); a fully typed `[[…]]`/`![[…]]` becomes a link node. Mod+Enter ticks the task at the caret. Enter/Shift+Enter in a table cell move to the cell below (a row is added when needed).
- Slash menu items come from one registry ("Ảnh" arrives with attachments in M4); inside lists or table cells only the items that fit there are offered. "Bảng" inserts a header row plus two rows, two columns.
- `[[` popup: fuzzy, diacritic-insensitive, top 8 with folders, templates left out; "Tạo '<text>'" inserts the link and creates `0 Inbox/<text>.md` in the background with a "Mở" toast. A path-form ghost link is not created on click (SPEC §4.4 creates title-form ghosts only); links to non-note files show a toast until the M4 viewer exists.
- Tag pills open search on click or Ctrl/⌘+Enter (plain Enter stays a new line); a lone `#` at a line start shows no list until a letter follows. `@words` filters the date quick choices. Popups open only when their trigger is freshly typed.
- Whitespace Markdown cannot hold (at paragraph/heading/cell edges, after a hard break, at the inner edge of a bold/italic/strike run) is dropped or moved outside the run when an edited block is written, instead of being encoded as `&#x20;`; spaces before a `\` hard break stay. A literal `[` in an edited paragraph is written as `\[` (Markdown-correct, renders the same).
Why: Typing feels natural while every save stays representable and re-reads exactly as shown.
Spec sections affected: F3, F4, F6 (interpretations).

## 2026-10-19 M2: note session and conflict details
Context: SPEC §4.10/§5 fix the contract (revisions, drafts, save states, three-version conflict); behaviour details were open.
Decision:
- The save indicator shows "Bản nháp" for unsaved changes (also while a draft is being written) and nothing right after opening; "Đã lưu" appears only after the server confirmed a save. Drafts are written at most every 300 ms (throttled, so typing never goes more than 300 ms without a draft); hiding or closing the page writes drafts and saves at once. Retries back off 1/2/4/8/15/30 s; a WebSocket resync retries at once; validation-type errors wait for "Thử lại".
- A restored draft autosaves like normal typing; "Bỏ bản nháp" asks first and writes the original disk text back if the draft was already saved. A conflict where mine equals the disk resolves by itself. "Tải lại" first sets mine aside in a separate IndexedDB store (a screen to browse those copies comes later). A property patch that meets a 409 with no local edits reloads silently with a toast. A non-UTF-8 note that has a draft opens the conflict screen instead of dropping the draft. A tab whose note was deleted elsewhere stays open while it has unsaved text, so the conflict screen can re-create the note.
- Source mode keeps each untouched line's own line ending and hides the property bar. Removing a property offers a 10 s undo. Status/type values are shown localized; the file keeps the English values. The course picker writes the path form when the title is not unique.
- Large notes are parsed on the main thread (see the editor spike limits).
Why: Never lose typed text, never write when nothing changed, and always tell the truth about what is on disk.
Spec sections affected: §4.10, §5 Data safety, F3, F7, F20 (interpretations).

## 2026-10-19 M2 review round: rules added while fixing confirmed findings
Context: Two independent reviews (data safety; UI/spec/accessibility in a real browser) found defects whose fixes needed rules SPEC does not spell out.
Decision:
- **Converter.** Unchanged blocks are matched by node identity first, then by `eq()` classes with a linear-space diff (Myers within a budget, patience anchors beyond), so edits far apart never rewrite the blocks between them. Two neighbouring lists that would merge after a deletion get a marker no neighbour uses (`-*+`, `.)`), patched one character per top-level item; verbatim lists are never re-marked. The save check covers the text after the last block. A tick's `✅` token goes at the end of the item's first source line (soft or hard break). After a save that had no exact Markdown form, the editor reloads the saved text so it shows what is on disk.
- **Front matter patches** keep a comment at the end of the edited key's line and never take comment lines that follow a value (they belong to nobody).
- **Link-mention** writes the alias separator as `\|` inside GFM table rows.
- **Drafts** are keyed per window (vault + path + window id); a window removes only its own draft; opening a note restores the newest draft from any window. Source-mode switches and title renames run in the note's operation queue; a rename adopts the note as relink left it (typing done meanwhile is merged line by line, overlapping lines open the conflict screen). Versions set aside by "Tải lại" are reachable from a banner ("Xem": review, restore through keep-mine, or discard).
- **A new note's template heading** (`# <default name>`) takes the title when the note is named the first time, as an undoable editor edit (`MarkdownEditorHandle.edit`).
- **Focus** never falls to `<body>`: after a route change it goes to the note editor, else the active tab, else the main region; after a toast action it returns where it was; collapsing a pane that held focus moves it to the main region. Toast countdowns freeze while a modal is open. Undo conflicts name the note(s) that changed.
- **Accessibility**: due dates show their relative text next to the chip (not only colour or a tooltip); Tab/Shift+Tab nest and lift list items (elsewhere Tab leaves the editor, no trap); the status/type list opens on the current value with arrow keys; tree rows read name first, then the hint; folder and note context menus offer every F2 action ("Chuyển vào Archive" for non-standard folders, "Ghi chú mới"/"Thư mục mới" in the note's folder); "Ghi chú mới" stays pinned at the bottom of the left pane.
- **Search palette** offers "Tạo '<q>'" whenever no result already has exactly that title.
- **E2E tests** trash the notes they created (`afterEach`), wait until the caret really sits in the editor before Ctrl+End, and simulate an unreachable server inside the page (a closing tab's last save would otherwise bypass Playwright's network emulation).
Why: Never change bytes nobody edited, never lose typed text, and keep every action reachable by keyboard with the result announced.
Spec sections affected: §4.9, §4.10, §4.12, §5, F2, F3, F5, F7, F8, F20 (interpretations, additive).

## 2026-10-19 M3: Word-like formatting toolbar and underline (owner request)
Context: The owner asked for formatting "like Word": buttons for bold, italic, underline and the rest, plus Word keyboard shortcuts. SPEC F3 describes Markdown input rules and a `/` menu only, and Markdown has no underline.
Decision: Asked the owner (2026-10-19): a slim **toolbar fixed at the top of the note** (undo/redo, text style, bold, italic, underline, strike, code, bullet/numbered/task lists, quote, code block, divider, table, web link, note link, clear formatting, source mode) with Word-style shortcuts (`Ctrl+B/I/U`, `Ctrl+Alt+0–3`, `Ctrl+Shift+7/8/9`, `Ctrl+Shift+S`, `Ctrl+E`, `Ctrl+Shift+B`, `Ctrl+Alt+C`, `Ctrl+\`, `Ctrl+Z/Y`); `Ctrl+K` stays the app search. **Underline is stored as `<u>…</u>`** (owner's choice): exactly `<u>`/`</u>` pairs inside one block become a supported mark (P3); any other inline HTML stays verbatim as before. The toolbar fades in writing focus like the side panes. Built in M3 together with the shortcut sheet.
Why: The owner's explicit request; `<u>` renders as underline in Obsidian and GitHub, so the files stay portable.
Spec sections affected: F3 (additive UI), §4.9 P3 (one more supported construct), F22 (editor shortcuts listed in the sheet).

## 2026-10-20 M3: server additions
Context: SPEC §9 lists the M3 routes in outline; F9/F11/F12/F13/F16 leave details open.
Decision:
- Deadline items, task entries and project summaries carry the note `revision` (the `expectedRevision` of view mutations). `PATCH /note/task` `{path, expectedRevision, line, expectedText, done? | due?}` → `{revision, lineText}`; 409 `CONFLICT` with `reason: 'revision' | 'line-changed'` (a missing file is `revision` with `currentRevision: null`); 400 `not-a-task | invalid-date | done-or-due | patch-verify`. A tick writes the same line the editor writes; ticking a ticked task writes nothing; unticking removes every ✅ token; `due: null` removes every 📅 token; a date goes in place of the first 📅 token, else before the first ✅, else at the line end (before trailing blanks; before a hard-break backslash); an edit that would leave the line no longer a task is refused. Not journaled (one revision-checked line).
- `POST /note/reschedule` `{path, expectedRevision, target: {kind:'note'} | {kind:'task', line, expectedText}, date}` → `{revision, journalId: string | null}`: a journaled single-file rewrite (op `reschedule`, before/after copies) so the 10 s undo is `POST /journal/:id/undo`; the same date writes nothing (`journalId: null`, no undo toast).
- `POST /capture` → `0 Inbox/<name>.md`: name = first non-empty line without Markdown prefixes, 40 code points, `\ / : * ? " < > |`, control characters and `[ ] # ^` → space (they would make the title unlinkable), dots/spaces trimmed at both ends; empty or reserved → `Ghi nhanh YYYY-MM-DD HH-mm` (always Vietnamese); body NFC, LF, one final newline; unique with ` 2`, ` 3`.
- Daily: `GET /daily?date=` (404, never creates), `POST /daily` (201 with `cursor`, 409 `EXISTS`), `GET /daily/neighbors` returns **vault paths** of the nearest existing daily notes. `{{date}}`/`created` of a daily note are its own date. Template variables in the UI language (dayjs `vi`/`en`): `{{date}}`, `{{date:<fmt>}}` (empty format = ISO), `{{time}}`, `{{time:<fmt>}}`, `{{yesterday}}`, `{{tomorrow}}`, `{{title}}`; unknown variables stay as written; `{{cursor}}` is removed and its UTF-16 offset returned as `cursor` (also from `POST /note`). A missing/non-UTF-8 Daily template falls back to `type: daily` + `created`.
- Graph: `GET /graph` (no filters in Phase 1), `GET /graph/local?path=&depth=1|2` (whole-graph degree; a note that is not drawn gets an empty graph; unknown path 404). Group by first folder (case-insensitive); a raw source is a node only when a drawn note links to it; edges are one per pair of resolved links.
- Index schema 4 (automatic rebuild): `#tag` right after `<u>`/`</u>` counts; task text keeps a `</u>` or code span before a date token (older bug).
Why: Every view mutation stays revision-checked and minimal; undoable reschedules reuse the journal.
Spec sections affected: §4.6, §4.7, §4.12, §9, F9, F11, F12, F13, F14, F16 (additive, interpretations).

## 2026-10-20 M3: web behaviour
Context: SPEC F8–F13, F16, F22 and design.md screens 1, 3–6 leave interaction details open.
Decision:
- Shared layer: `useLiveQuery` refetches (150 ms debounce) on vault events, resync, rebuild done and local day change (midnight timer, `visibilitychange`, focus), drops stale answers; `DeadlineItemRow` ticks with a real checkbox (note items tick `status: done/doing`), shows urgency as dot + text, `onDone` after the server confirmed. A 400 `not-a-task` is treated as a conflict (the line moved). Recently opened notes (per vault, 50) feed the palette's empty query. Alt+Q works inside plain form fields too; overlays suspend it. `Alt+,` is not registered until Settings exist (M4).
- Today: summary sentence order overdue → week → today, zero parts omitted ("Tuần này có 2 deadline."); the inline connection banner replaces it when offline; the strip shows 60 days (7 or 14 visible by available width), the line draws once per page load; per-vault memory for "Để sau" on "Đánh dấu dự án xong?", the declined sample-data prompt and the tasks view's "Bao gồm Archive"; "Tạo" creates "Đồ án mới" from the Course project template (`status: todo`).
- Calendar: month view only (design mentions weeks; SPEC F11 is month only); PageUp/PageDown keep the day number clamped to the month; a keyboard move onto a neighbouring month's day switches month; items behind "+n" are rescheduled with "Dời ngày…" in the day pane; no touch drag (the menu is the touch path). URL `?month=&day=`.
- Palette: commands from one registry gated by `IMPLEMENTED_FEATURES`; tab commands say "thẻ"; commands run after the palette closed; filter values suggested while typing (folders exclude Templates/Attachments); the `palette:keystroke-to-results` measure includes the 120 ms debounce.
- Capture overlay: no dimmed backdrop; a click outside closes it only when empty; text on `--blush` uses `--ink` (the `--ink-2`/`--blush` pair is below 4.5:1 in the light theme). Daily notes get a navigation row (nearest existing day, else "Tạo ngày …"); created daily notes have no undo toast.
- Graph: grid hit testing (no `d3-quadtree` dependency); 120 layout ticks with a 2.5 s budget then live settling; drift is a 3 px sine sway (≈ 0.05 px/frame); orphans 50 %, archived 55 %, dimmed nodes 20 %; double-click = two clicks within 400 ms; non-`.md` files show a toast until the M4 viewer; `?focus=<path>` selects a node, `?debug=fps` shows the frame rate; Esc clears the selection.
- Editor toolbar: Ctrl+Alt+0–3 apply a style (Word) rather than toggle; "Xóa định dạng" keeps links and block styles; registry keys are always taken in the editor (no browser default such as view-source runs); the source-mode toggle moved into the toolbar. A change that only adds/removes top-level empty paragraphs is not an edit (empty paragraphs have no Markdown form). `{{cursor}}` on a blank line becomes an empty paragraph that writes nothing until typed in. Underline content that starts with a line break has no exact form and is saved canonically (`exact: false`, nothing dropped).
Why: Predictable behaviour, every action reachable by keyboard, nothing written that the user did not change.
Spec sections affected: F8, F9, F10, F11, F12, F13, F14, F16, F22, design.md screens 1, 3–6 (interpretations).

## 2026-10-21 M3 review rounds: rules added while fixing confirmed findings
Context: Two independent reviews (data safety; UI/spec/accessibility in a real browser) and the e2e run found defects whose fixes needed rules SPEC does not spell out. The owner also asked for names on the brain map.
Decision:
- **Task line patches** decide whether the task's paragraph continues (hard-break backslash, two trailing spaces) from the block scanner (quotes, lists, lazy lines, HTML), never a regex guess; after every patch the task paragraph is rendered before and after and must be identical apart from the token written or removed (else `patch-verify`, nothing written). Unticking and `due: null` remove every blank before a token, except one blank after a line-ending backslash when the paragraph continues, so tick → untick restores the original bytes. 📅/✅ tokens inside code, HTML, wikilinks/embeds and Markdown links are not dates (index and patch share the rule; index schema 5); a reschedule rewrites the token the index reads. The editor's tick follows exactly the same rules (a parity test feeds the same lines to both): ticking an open task that carries a ✅ token sets its date in place.
- `POST /note/reschedule` also returns `lineText` for task targets. The web remembers, per note, the revisions its own writes replaced and uses the newest for the next mutation; the memory is dropped on any 409, a journal undo, a foreign `note:changed`, rename/delete/folder change or resync (revisions are content hashes, so a file can return to an old revision).
- Capture names drop format characters (bidi, zero-width) and lone surrogates, cut at 40 graphemes, and treat `COM0`/`LPT0` as reserved. `POST /note` refuses a non-UTF-8 template (`template-not-utf8`); `POST /daily` falls back to the minimal daily note on any template read problem.
- Today: the summary counts each item once (overdue; open items due today…Sunday; open tasks due today plus today's undated Daily tasks); at most 5 overdue tasks then "Xem tất cả n việc quá hạn"; at most 6 project cards then "Xem thêm n đồ án"; progress shown as a percentage with "3/5 việc" as its value text; a placeholder of the strip's exact size holds the layout while loading; strip labels wrap over the three reserved lines; the caption names the visible range once scrolled; "Đánh dấu xong" offers a 10 s undo (back to `status: doing`, revision-checked).
- Deadline rows: the title is the "open note" control; below 26rem the urgency, note and actions move to a second line; ticked rows stay visible (dimmed) for the visit in Today **and** the tasks view.
- Calendar: empty days say "Ngày này chưa có việc nào."; cell names list 3 titles then "và n việc khác"; below 900 px opening a day scrolls the pane into view. Weekdays and months are written in sentence case everywhere ("Thứ tư, 21/10/2026").
- Brain map (owner's choice): with nothing selected the most-linked visible notes show quiet names (`--ink-2`), about 15 at the default zoom and more as she zooms in (×zoom², up to 60), never overlapping each other or the controls; hovered, selected and lit names win; the glow is one layer (radius + 4 px).
- Palette commands rank exact label, label prefix, word prefixes, keywords, then the closer label, then registry order. The toolbar shows its hints in a visible tooltip on hover and focus; its undo/redo are "Hoàn tác chỉnh sửa"/"Làm lại chỉnh sửa". The shortcut sheet also lists the screen-local keys (strip, calendar, graph, Ctrl+Enter tick).
- Shortcuts: a blocked app Ctrl combination (Ctrl+K, Ctrl+/ while typing in an overlay) still prevents the browser default; Alt combinations pass through (AltGr). A pane toggle pressed before the per-vault pane settings load is kept.
Why: Never change what the user did not touch, never lose a tick, and keep every screen readable at 360 px and by keyboard.
Spec sections affected: §4.6, §4.9, §4.10, F9, F10, F11, F12, F13, F14, F16, F22 (interpretations, additive).

## 2026-10-21 M4: libraries and building blocks
Context: SPEC §8 lists `simple-git` and `vite-plugin-pwa`; it names no zip or multipart library. Rule 10 asks for the simplest implementation.
Decision:
- **No `vite-plugin-pwa`:** a hand-written service worker (`web/src/pwa/service-worker.ts`) built by a ~100-line Vite plugin (`web/vite-plugin-service-worker.ts`) with a `BUILD_ID` and the precache list. It gives exact control over "shell only" caching (the shell HTML carries the session token and is rendered per request) and avoids a plugin whose peer range does not cover Vite 8.
- **No `simple-git`:** git runs through `execFile` with an argument array (never a shell), a serial queue and hardened `-c` flags (see the history entry).
- **`fflate` 0.8.3** for backup zips (streaming, pure JS; 0.8.3 fixes a ZIP64 parsing advisory). It cannot write ZIP64, so an export above 4,000,000,000 bytes or 65,000 entries is refused with `too-large`.
- **`@fastify/multipart` 10.1.2**, registered only inside the plugin scopes of `POST /api/attachments` and `POST /api/backup/restore`; the app's JSON body limit stays 10 MB.
- **`node-notifier` 10.0.1** as the toast fallback (the moderate `uuid` advisory concerns `v3/v5/v6` with a caller buffer, which node-notifier never calls; 11.0.0 was under two weeks old).
- **`pdfjs-dist` 6.4.299** for the viewer.
- Per-vault background services are **vault plugins** (`server/src/app-context/vault-plugins.ts`): the vault host starts them after a vault opens and closes them before it closes; routes look their plugin up per request.
Why: Fewer moving parts, behaviour we can test, nothing that weakens the CSP.
Spec sections affected: §8 (library list), F17, F20, F21.

## 2026-10-21 M4: settings, vault switch, backup, run at login
Context: SPEC F18 lists what Settings holds; switching, backup and run-at-login details are left open.
Decision:
- Settings gain `reminders.time` (default 08:00), `system.runAtLogin`, and `ai` (provider, per-provider API keys, models, folder scope; `enabled`/`embeddings` cannot be turned on before Phase 3: `ai-not-available`). `GET /api/settings` is an allowlisted view; keys only as `…last4` (keys must be 16–512 printable ASCII). `PUT /api/settings` takes partial bodies checked by a strict validator (unknown keys → 400 `unknown-field`; Fastify's validator would silently drop them), saves one change at a time and updates the live settings in place; a UI change is broadcast as `settings:changed`. Port 1024–65535, applied at the next start (`restartRequired`).
- **Vault switch in process:** a vault host owns the open context, one WebSocket hub for all vaults and the plugins; routes get a delegating context. `POST /api/vault/switch {path|null}` needs an existing absolute folder (an empty one becomes a new vault), gates new requests, lets running ones finish (≤ 10 s), closes plugins and vault, opens the new one and **reopens the previous vault on any failure** (400 `VAULT_UNUSABLE` with a reason). `vaultPath` is saved only after success; clients reload on `vault:switched`. Optional header `x-sb-vault-id`: a stale id gets 409 `vault-switched`, so a save queued behind a switch never lands in the other vault.
- **Backup:** the zip holds every file of the vault except `.secondbrain/cache`, `.secondbrain/logs`, `.git` and temp files (so `vault.json`, `state/`, `trash/` are in), empty folders included, symlinks skipped, never anything outside the vault (no settings, token or keys). `.git` is left out on purpose: history would double the size of every attachment. Restore goes into a missing or empty folder outside the vault and the app folders, through a temp sibling folder, with path-guard rules on every entry and zip-bomb caps (4 GB, 200,000 entries); with `open` the app switches to it. A restored vault gets a **fresh vault id** (a new id in its `vault.json`, written before the copy is moved into place; every other byte is as backed up): it is a new location next to the original, and the stale-window guard (`x-sb-vault-id`) must tell a window of the original from one of the copy, otherwise a save queued in a window of the original lands in the copy. Browser drafts and tabs are therefore not shared between the two.
- **Run at login:** `%APPDATA%\…\Startup\Second Brain.lnk` → `wscript.exe "<app>\launcher\start-hidden.vbs"` (no window, no browser), created with PowerShell's `WScript.Shell`, removed by deleting that one file; `GET` reports the file on disk. Not offered off Windows.
- `POST /api/logs/reveal` is the dedicated route for the log folder (note and file routes still refuse `.secondbrain/`). New error codes `VAULT_UNUSABLE` (400), `UNAVAILABLE` (503).
Why: F18.3 requires that a failed switch keeps the current vault and that no state mixes; F18.5 requires a backup that restores intact and never carries secrets.
Spec sections affected: §4.13, F18, F21.4, §9 (additive routes and codes).

## 2026-10-21 M4: reminders
Context: SPEC F17 defines thresholds, dedupe and catch-up; timing details are open.
Decision:
- The server evaluates at start, every 60 s and after a late tick or a new local date (wake). Per item and due date only the latest threshold whose time has come fires; earlier unfired ones are recorded as superseded (never shown). A fire time passed by more than 5 minutes is a catch-up (`missed`). Catch-up window: the 3- and 1-day thresholds while `due ≥ today`; the due-day one until the end of the next day (titled "Đã quá hạn"); older items get no toast (they are on Today anyway).
- More than 3 reminders in one pass → one summary toast "Bạn có n deadline sắp tới" that opens Today.
- The store (`state/reminders.json`) is written **before** the toast with `toast: 'failed'` and rewritten with the real outcome, so a crash never repeats a toast. Task reminders also match by note + text + due date + threshold, so editing lines above a task does not remind it again; renaming a note can.
- Windows toast: Windows PowerShell 5.1 by absolute path, the toast XML passed base64-encoded (user text is never script code), `activationType="protocol"` deep link `http://localhost:<port>/#/note?path=…` (the app's route instead of SPEC's `#/note/<path>`), the AppUserModelID of Windows PowerShell (the app has none registered); `node-notifier` as fallback; other platforms `unsupported`. Texts in the UI language at fire time.
- `GET /api/reminders` lists entries not dismissed, fired in the last 7 days, whose item is still open with the same due date; dismissing has no WS event.
Why: One toast per real reminder, never a flood after a long sleep, never a repeat after a crash.
Spec sections affected: F17 (interpretations), §9.

## 2026-10-21 M4: attachments, documents view, opening files
Context: SPEC §4.8 and F15 give placement and uniqueness; names and edge cases are open.
Decision:
- Upload names: Windows-invalid, control and `[ ] # ^` characters → space (they would break `[[name]]`), format characters dropped, dots/spaces trimmed, ≤ 120 code points, reserved names → `Tệp đính kèm YYYY-MM-DD HH-mm.<ext>`. Unique across the whole vault, compared case-insensitively after NFC against every file **and every note title** (a title wins over a file name when a link resolves); uploads to one vault run one at a time. Images → `Attachments/<YYYY-MM>/`; pdf → papers, ppt/pptx/key/odp → slides, everything else (an uploaded `.md` too) → other.
- `GET /api/files?download=1` forces a download. `POST /api/files/open-external` opens a vault file with the OS app, never folders and never programs/scripts (Microsoft's unsafe-attachment list plus sh, command, desktop…), checked on the name and on the real target of a link.
- `GET /api/resources` reads size/mtime with one `lstat` of the indexed path (metadata only, never follows a link); `referencedBy` counts resolved, non-ambiguous links, no self-links.
- Editor: files of one drop upload in order; one "Lưu vào" choice per drop, preselected from the last choice per vault (else by type); a link on an empty line or between blocks gets its own paragraph, inside text it goes inline, inside code it becomes a paragraph after the block; a drop outside the text (title, property bar, margins) goes to the end of the note (otherwise the browser would open the file and leave the app). Upload placeholders are decorations, never saved. The slash menu gains "Ảnh". Embedded images: `![[x.png|300]]` / `|300x200` set the size (as in Obsidian), other aliases are alt text; non-image embeds render as cards; Markdown image sources are resolved relative to the note then the vault root, `data:image/` shown as is, any other scheme or `//` never fetched. Blob URLs are cached per vault and revision and revoked 30 s after last use.
Why: Links to attachments must resolve unambiguously and nothing from the vault may run in the app origin.
Spec sections affected: §4.4, §4.8, F15 (interpretations), §9.

## 2026-10-21 M4: version history with git
Context: SPEC F20 asks for git in the vault with a `.gitignore`; F1.1 says an empty folder gets exactly the standard entries.
Decision:
- Ignore rules go to **`.git/info/exclude`**, not a `.gitignore`, so the user's folder gets no new file; `.git/info/attributes` gets `* -text -filter -ident -working-tree-encoding` so a `.gitattributes` in the vault can never change the stored bytes (a restored version is byte-exact). Identity is set repo-locally only when none resolves; global/system config never written. Hooks off (`core.hooksPath` = the null device), fsmonitor, signing and pagers off, inherited `GIT_*` variables dropped, `safe.directory` for the vault. Never a command that changes the working tree; a restore is a revision-checked vault write followed by a commit `restore: <path> @ <short>`.
- The first commit after `git init` runs in the background; auto-commit every 10 minutes and on close (≤ 10 s); a stale `index.lock` (> 10 min) is removed; failures are logged as codes and never block saving. `.secondbrain/state/**` is part of the history (durable state). Attachments are committed too, so the repository grows with them (a size cap may come later).
- Routes: `GET /api/history/status`, `GET /api/history?path=`, `GET /api/history/version`, `POST /api/history/restore`; 503 `UNAVAILABLE` with a reason when history is off.
Why: History must never surprise the user's folder or rewrite a file she did not ask to restore.
Spec sections affected: F1.1, F20 (interpretations), §9.

## 2026-10-21 M4: PWA and launcher
Context: SPEC F21 lists the launcher, the PWA and its checklist.
Decision:
- Service worker: navigations network first (4 s), the shell cached only from a 200 same-origin `text/html` response; assets cache first; `/api`, `/ws` and everything else never intercepted. Registered only in production builds on `http://localhost:<port>`; checks for a new build hourly and on every WebSocket reconnect; "Có bản mới của app." with "Tải lại" (10 s) reloads that window once.
- Manifest with relative URLs and `launch_handler.client_mode: focus-existing`; icons rendered from `favicon.svg` by `scripts/gen-icons.ts`.
- Launcher: `login` action (no browser, silent when running), failures in `.secondbrain/logs/launcher.log` and one message box; the port-busy dialog names the process holding the port; the installed app (Start-menu shortcut with `--app-id=`) is opened instead of a browser tab, except after a port change (an installed PWA belongs to its origin: Settings tells the owner to reinstall it).
- The cached shell contains the session token (same origin only, like the page); a token change without a port change leaves an offline-started window with the old token until reload.
Why: The app must open like a real app, offline included, and say clearly why when it cannot start.
Spec sections affected: F21, §8.

## 2026-10-21 M4: Settings screen, reminders in the app, language switch
Context: SPEC F17, F18, F19 and design.md §1 (few settings) leave interaction details open.
Decision:
- Settings is one calm page: Giao diện, Nhắc nhở, Kho ghi chú, Ứng dụng, AI, Kết nối Claude (MCP). No global Save: choices save on change, text fields (name, port, reminder time, model names) on blur/Enter (Esc restores), the API key only on Enter or "Lưu khóa" and the field empties after saving; "Đã lưu" shows 2 s. UI preferences apply before the request and revert if it fails; other windows follow `settings:changed`.
- AI and MCP are honest about Phase 3: "AI có thể nối sau vài bước, ở bản sau."; the MCP section is one sentence, no config snippet (no MCP server exists in this build). AI folder scope: no stored list = every top folder except `3 Resources` and `4 Archive`.
- Vault switch from the client: open notes are saved and their drafts written first; after any switch (here, another window's `vault:switched`, or a 409 `vault-switched`) drafts are written and the page reloads. Every `/api` request (uploads and file fetches included) sends `X-SB-Vault-Id`. Restore always opens the restored vault; its hint says the restored copy is a separate vault (its own tabs and drafts).
- Port: "Cần khởi động lại để dùng cổng mới." plus a line to reinstall the installed app (it belongs to the old origin).
- Reminders: the list (`/reminders`) and the sidebar badge refresh on the `reminder` event, vault events, reconnect and when the window comes back into view. A browser notification is shown **only when the server's Windows toast was not shown** (SPEC F17 lists both channels; one alert per reminder avoids a double alert on Windows), in exactly one window (Web Lock `sb-reminders-leader`, else a BroadcastChannel claim), tagged with the reminder key; click opens the note. Permission is never requested without a click; denied → the list only and a one-time hint per vault. Texts are relative to today ("Còn n ngày", "Ngày mai đến hạn", "Hôm nay đến hạn", "Đã quá hạn"; "Đã nhắc lúc HH:mm" / "Nhắc bù lúc HH:mm").
- Language switch (F19.2): the routed screen is rebuilt in the new language (except Settings itself, so focus stays on the chosen radio); toasts already on screen are re-translated.
- The palette's light/dark command makes the theme an explicit choice. "Thoát Second Brain" asks first and saves open notes before stopping. Navigation: Nhắc nhở below Lịch, Tài liệu after Thẻ, Cài đặt pinned at the bottom of the left pane.
Why: Every change visible at once and nothing lost when the vault or language changes.
Spec sections affected: F17, F18, F19, F21, F22 (interpretations).

## 2026-10-21 M4: PDF viewer, documents view, opening files, history UI
Context: SPEC F15, F20, F23 leave the viewer and history UI open; the CSP forbids eval and WebAssembly.
Decision:
- pdf.js 6.4.299 runs from its **legacy build** (the modern build calls `Map#getOrInsertComputed`, missing in Chromium 141), with WebAssembly off: JPEG 2000/JBIG2 use pdf.js's JavaScript decoders through a same-origin dispatcher module; no `unsafe-eval`/`wasm-unsafe-eval` added. The document is loaded from an `ArrayBuffer` fetched with the token. Standard fonts and CMaps are not bundled (PDFs without embedded fonts use system fonts; CJK may look off). pdf.js (~2.4 MB) loads only when a PDF opens.
- Viewer: opens at "Vừa chiều rộng", zoom 25–400 %, keys only while focus is in the viewer, page/zoom remembered per file for the session, reload in place on change, "Không tìm thấy tệp …" with "Đóng thẻ" on deletion (the tab stays), full main height.
- Tabs gain `kind: 'note' | 'file'` (saved; old tabs load as notes; unknown kinds dropped). A plain click on a PDF replaces the active tab like a note link.
- `openVaultFile`: PDF → viewer tab; images, HTML and every other file → token-fetched blob saved with `<a download>` (never a navigation or frame) and a toast with "Mở bằng ứng dụng khác".
- "Tài liệu" groups papers, slides, web, other, other `3 Resources` subfolders, the `3 Resources` root, then `Attachments/<month>` newest first.
- History: a dialog without a route (tree menu "Lịch sử phiên bản", a right-pane "Lịch sử" section that loads on expand, palette "Xem lịch sử phiên bản"); the diff reads from the current note to the chosen version; restoring an identical version is disabled; a 409 reloads the list and the note; git missing → "Lịch sử cần Git. Cài Git for Windows để bật."
Why: Documents open in the app without weakening the CSP; history is reachable but never in the way.
Spec sections affected: F15, F16 (source nodes open), F20, F23 (interpretations).

## 2026-10-21 M4 review rounds: rules added while fixing confirmed findings
Context: Two independent reviews (data safety/security; UI/spec/accessibility in a real browser) and the e2e run found defects whose fixes needed rules SPEC does not spell out.
Decision:
- **A restored backup is a new vault with its own id** (replaces the earlier "keeps its id" rule): the stale-window guard (`x-sb-vault-id`) must tell the original and the copy apart, or a save meant for one lands in the other. The copy keeps what had already been reminded: the reminder keys in `state/reminders.json` move to the new id during the restore.
- **Backup export holds the vault's write queue** while it builds the zip into a temp file under `.secondbrain/cache/` (no rename, move, trash or save can interleave; reads are never blocked), then streams the finished file with `content-length`. Saves made meanwhile wait (on a multi-GB vault, about a minute); the export needs free space for the zip; every skipped file is counted in `x-sb-backup-unreadable` and Settings warns; a read error inside a file fails the export (500) instead of sending a truncated zip.
- **A history restore never loses the replaced text:** pending changes are committed first and HEAD must hold exactly the bytes being replaced; otherwise the current text is copied to the trash (reason `history-restore`); if even that fails nothing is written (500 `copy-failed`).
- An unreadable `reminders.json` (anything but "missing") is never overwritten: writes are refused, no toast fires, the read is retried next tick.
- A vault switch or restore target that is, contains or sits inside the open vault is refused (`overlaps-vault`, `target-inside-vault`). "Mở bằng ứng dụng khác" also refuses macro-enabled Office types. A blob URL of a vault file is never navigated to or framed (an SVG would run its scripts there).
- **A window started before the server recovers in place, never by reload:** the WebSocket emits `resync` after any open that follows a closed or refused socket (also the first), the vault check is retried until `/health` answers, then per-vault state is read and everything refetches; a note that failed to open shows "Chưa mở được ghi chú…" with "Thử lại". No per-vault state is read while the vault is unknown (the tab strip is empty meanwhile).
- Settings: action buttons stay focusable while busy (`aria-disabled`) and confirmations come before the busy state, so focus returns to the trigger; the reminder time is a 24-hour `HH:mm` text field; Esc clears a field's error; after a switch or restore a 4 s toast names the vault folder. Reminders: "Bỏ qua tất cả" asks first (dismissing has no undo on the server); focus moves to the next row after "Bỏ qua".
- Secondary text on `--accent-soft` surfaces uses `--ink` (`--ink-2` on `--accent-soft` is below 4.5:1 in five of six theme/palette sets); the contrast check includes `--ink`/`--accent-soft` and a CSS guard test refuses `--ink-2` text on `--accent-soft`.
- The shortcut sheet lists the PDF viewer keys as screen-local keys, from the viewer's own key list. English texts with counts use plural forms.
Why: Never lose or misplace the user's text, never repeat a reminder, and make every screen recover and stay readable by itself.
Spec sections affected: §4.10, §4.11, §4.13, F17, F18, F20, F21, F22.2, design.md §2.5, §7 (interpretations).

## 2026-10-21 Milestone order: AI (M6) before Phase 2 (M5) (owner request)
Context: SPEC §0 rule 2 and §12 build M5 (Phase 2) before M6 (Phase 3, AI). After M4 the owner asked to have the AI features first (auto-sorting the Inbox, suggestions, chat with her notes).
Decision: The next milestone is **M6** (F32 MCP server with permissions and the ingest manifest, F33 in-app AI, F34 graph "AI touched" effect), then **M5** (Phase 2). Pulled forward from M5 because M6 needs it: **F30 PDF text extraction** (`read_source` returns page-numbered text and `extractionQuality`; F32.4 depends on it). Left for M5: the "não hôm nay" widget on Today (F24) – F34's count in that widget is added when the widget exists; F34's graph animation and side-panel list ship with M6. Milestone ids stay as in SPEC; version tags are chosen at each release (M4 = v1.0). Every other rule (DoD, AI proposes and the user accepts, nothing sent without consent) is unchanged.
Why: The owner's explicit choice; M6 depends on Phase 1 only, apart from PDF text extraction.
Spec sections affected: §0 rule 2, §12 (order), F30 (moved), F34 (widget count deferred).

## 2026-10-21 M6: building blocks and process model
Context: SPEC §8 lists `@modelcontextprotocol/sdk`, `@anthropic-ai/sdk`, `openai` and `pdf-parse`; rule 10 asks for the simplest implementation; F32 requires one process owning every job.
Decision:
- **`@modelcontextprotocol/sdk` 1.32.1** with **`zod` 4.6.5** for the MCP server (Streamable HTTP, stateless: a new `McpServer` + transport per POST, `enableJsonResponse`; GET/DELETE `/mcp` → 405) and the stdio bridge.
- **No provider SDKs:** Anthropic, OpenAI and Gemini are called with `fetch` (one module each, one shared SSE parser), so all three behave the same, the network is injectable in tests and nothing new reaches the bundle. Base URLs can be overridden by `SB_AI_{ANTHROPIC,OPENAI,GEMINI}_URL` (e2e mock server only).
- **No `pdf-parse`:** PDF text uses the `pdfjs-dist` 6.4.299 **legacy build** already used by the viewer (now also a server dependency), inside a `worker_threads` worker (1 GB heap cap, console discarded, `useWasm: false`, CMaps/fonts from the package folder, never the network).
- Per-vault services get two hooks: `AppContext.onEvent(listener)` (every client event of the change router, after the index has the change) and `VaultPluginHost.globalStateDir` (`<home>/.secondbrain`, for the machine-wide AI usage file). Plugin order: sources, reminders, history, ai.
- The stdio entry `server/dist/mcp-stdio.js` is a **thin bridge** (stdio ↔ `http://127.0.0.1:<port>/mcp` with the session token as Bearer); it imports no vault, index, watcher, reminder, history or AI module (tested), starts the server through the launcher (`start-hidden.vbs`) when it is down, and never writes anything but protocol to stdout.
Why: Fewer moving parts, one process, every network call testable.
Spec sections affected: §8 (library list), F30, F32, F33.

## 2026-10-21 M6: PDF text (F30, pulled forward from M5)
Decision:
- Supported: `.pdf` (page by page), `.md`/`.txt`/`.html` (one page). Caps: 50 MB file, 500 pages (more → first 500, quality at most `low`, reason `too-large`), 60 s per file, 100,000 characters per PDF page. Quality: `none` below 20 non-space characters (or encrypted/damaged/timeout), `low` when ≥ 30 % of pages have < 40, else `ok`. A worker crash is `none`/`damaged`. Every outcome is cached by content hash under `.secondbrain/cache/sources/` (deleting it retries everything).
- Title: PDF metadata title unless it looks like a file name ("Microsoft Word - …", `untitled`), else the file name; the fallback is applied at read time.
- Background: supported files in `3 Resources` and every PDF anywhere, 2 s debounce per file, a cheap rescan after folder changes and index rebuilds. Only PDFs under `3 Resources` are **searchable** (attachments are not searchable, §4.2); attachment PDFs can still be read by `read_source`.
- Index schema 6: `source_docs`, `source_pages`, `sources_fts` (same normalization as notes); rebuild refills from the cache. Search: note title matches first, then note bodies and PDF pages merged by bm25 (note first on a tie), one result per PDF with its best `page`; `folder:` applies to PDFs, `tag:`/`type:`/`due:` exclude them.
- `IndexService.retrieve()` for AI: OR of up to 32 terms (stop words vi+en removed), note titles weighted ×10, one hit per PDF.
Why: PDF text must help search and AI without ever slowing a save or the UI.
Spec sections affected: §4.2 (raw sources searchable incl. PDF text), §4.14, F15, F30.

## 2026-10-21 M6: MCP server (F32)
Decision:
- Permission table in one pure module; refusals are `FORBIDDEN` with `details.rule` (`claude-md-read-only`, `sources-read-only`, `templates-read-only`, `attachments-read-only`, `wiki-index-via-wiki_index_update`, `wiki-log-append-only`, `wiki-pages-only`, `inbox-create-only`, `daily-today-only`, `wiki-via-write_wiki_page`, `no-create-outside-wiki-and-inbox`, `note-edits-off`, `notes-only`). **`write_note`** is added to SPEC's tool list: the only way to change a user/archived note, and only with Settings "Cho phép AI sửa ghi chú cá nhân" (`mcp.allowNoteEdits`, default off); never creates.
- Every tool result is bounded (owner question about context size): `read_note` and `read_source` at most 60,000 characters per call with `nextOffset`/`nextPage`; `list_notes` default 200 (max 500) with `nextOffset`; `search_notes` default 20; `wiki_lint` lists at most 100 entries each plus full `counts`.
- Ingest manifest `state/ingest/<sourceId>.json`; run id `<sourceId>.<ulid>`; ≤ 20 runs kept (the newest success never dropped); a running run blocks `ingest_begin` even with `force` (force only overrides "already ingested"); runs older than 1 h are failed once per vault before its first MCP request. `ingest_complete`: source changed/missing → run failed (`source-changed`); quality `none` → `NEEDS_REVIEW`, run failed; missing outputs leave the run running; the **server** appends `## [YYYY-MM-DD] ingest | <title>` and broadcasts `ai:touched`; a second call for a succeeded run returns the same result and appends nothing.
- Appends (`wiki_log_append`, `append_to_daily`) only add bytes at the end at the revision just read (retried on conflict), keep the file's line endings; a log line is 1–500 characters with no line break of any kind.
- `wiki_lint`: links from `index.md`, `log.md` and `CLAUDE.md` do not count against "orphan"; missing concepts count ghost-link occurrences (case-insensitive); works without the sources plugin.
- Logs: `MCP <tool> <CODE> <ms> ms`, never arguments. MCP is not limited by the in-app AI folder scope: it is the owner's own Claude working on her vault under the permission table.
- `GET /api/mcp/config` gives the Claude Desktop snippets (stdio with the absolute `node` and bridge paths, `--home` only for an unusual home; HTTP with `"type": "http"` and the token). On Windows the bridge starts the server through the launcher, which uses the default home.
Why: Permissions enforced by the server, not by prompts; an interrupted ingest can always be retried without duplicates.
Spec sections affected: F32 (tool list + `write_note`, interpretations), §9.

## 2026-10-21 M6: in-app AI platform (F33)
Decision:
- Settings: `ai.consent`/`ai.embeddingsConsent` = `{ at, provider } | null` (a consent counts only for the provider it named; changing provider asks again), `ai.embeddingProvider` (`openai` | `gemini`; Anthropic has no embeddings API), `ai.monthlyTokenLimit` (default 2,000,000; 10,000–100,000,000), `mcp.allowNoteEdits`. Switching on without a counting consent → 400 `consent-required`. Changing a provider without naming a model resets that model to the new provider's default.
- Defaults (one file, easy to change; checked against the providers' docs on 2026-10-21): chat `claude-haiku-5-5`, `gpt-5-mini`, `gemini-3.5-flash-lite`; embeddings `text-embedding-3-small` (512 dims), `gemini-embedding-001` (768 dims).
- Errors: `AI_DISABLED` 409, `AI_NO_KEY` 409, `AI_BUDGET` 429, `AI_PROVIDER_ERROR` 502 with `reason` (`network`, `timeout`, `auth`, `rate-limit`, `quota`, `bad-request`, `server`, `malformed`, `aborted`); provider text, keys and prompts never in errors or logs. 30 s to the first byte, 120 s total.
- Budget: machine-wide `<home>/.secondbrain/ai-usage.json` per local month (13 months kept); a request is refused when used + estimate would pass the limit; embeddings count too.
- Scope: default every top folder except `3 Resources`, `4 Archive`, `Templates`, `Attachments`, plus root notes; templates, attachments and control docs (except `wiki/index.md`) are never sent.
- Embeddings: `.md` notes only (PDF text stays BM25); the embedded text is title (+ heading) + chunk; 5 minutes after a note's last change; backlog at once on enable/model change; batches ≤ 64; backoff 1 min, 5 min, 30 min, 2 h; `auth`/`quota` stop until settings change; a batch that would pass the limit pauses the jobs. Embeddings also need AI enabled: AI off means no network at all.
- `POST /ai/embeddings/rebuild` answers like `assertReady('embed')`.
Why: Nothing leaves the machine without consent, a key and budget; costs stay predictable.
Spec sections affected: F18, F33 (interpretations).

## 2026-10-21 M6: in-app AI answers (F33, S5)
Decision:
- Intent: one JSON call (English prompt, temperature 0) with today's date, the week and the in-scope course/project titles; strict validation; local rules decide when the call fails or the JSON is unusable. With no in-scope note at all, the rules decide and nothing is sent.
- Deadline questions: the server renders the list from the deadline service (grouped by day, overdue first with how late, links `[[path|title]]`), the model only writes ≤ 2 sentences from the counts; if that call fails the list is still sent. "This week" = Today's `deadlinesThisWeek` items. Items of out-of-scope notes are dropped with a count and notice.
- Text questions: OR-BM25 candidates → chunk BM25 (terms under 5 letters whole-word only) + embeddings when available → reciprocal-rank fusion → 12 chunks, ≤ 24,000 characters; control docs are never sources. Citations `[S<n>]` become links of the retrieved set only; model-written `[[…]]` links are kept only when they resolve inside that set; PDF citations add "(tr. n)".
- Actions: summarize/improve/explain; link suggestions from ≤ 15 note candidates; tag suggestions counted over in-scope notes (her spelling first); Inbox placement only for notes directly in `0 Inbox` (`keep: true` = leave it). Names use the quick-capture rules (own sanitizer, not cut at 40). Nothing changes on the server: the web applies accepted proposals through the normal operations.
- Today line: one sentence ≤ 160 characters, cached per vault, day and language; GET never generates.
- `POST /ai/search` needs AI ready even in BM25 mode.
Why: Exact answers for dates, honest citations, proposals only.
Spec sections affected: F33 (interpretations), §9 (routes added: `/ai/today-summary`, `/ai/save-answer`, `/ai/search`).

## 2026-10-21 M6: paper format and template upgrade (owner request)
Context: the owner asked for richer paper notes: the problem with input/output, how existing methods solve it in plain words, the gap that motivates the paper, datasets, experiments, limits.
Decision: `Templates/Paper.md` and the paper-page format in the `CLAUDE.md` skeleton use Tóm tắt, Bài toán (Input, Output), Các cách hiện có, Khoảng trống và động lực, Phương pháp, Dữ liệu, Thí nghiệm, Kết quả (theo tác giả), Hạn chế và hướng tiếp theo, Nhận xét / Nhận xét của AI, Liên quan (SPEC's four wiki section names kept exactly). "Cập nhật mẫu" (`GET /api/templates/upgrades`, `POST /api/templates/upgrade`) replaces `Templates/Paper.md` and `CLAUDE.md` only when they are byte-identical to a previously bundled version; the old copy goes to the trash (reason `template-upgrade`); edited files are never touched.
Why: The owner's request without ever overwriting what she wrote (G5).
Spec sections affected: F14, F32 (page format, additive).

## 2026-10-21 M6: AI in the web app (chat, editor, Inbox, Settings, graph, search)
Context: SPEC F33/F34 and design.md screen 7 describe the surfaces; details are open.
Decision:
- **Chat ("Hỏi")**: the Ask screen `#/ask` (sidebar "Hỏi AI", palette "Hỏi AI…") and a collapsible "Hỏi" section first in the note panel (one conversation per note, nothing persisted, streams live outside components so collapsing never cuts an answer). History sent: finished pairs only, last 10 messages, each ≤ 8,000 characters. Answers render through a small Markdown subset (never HTML); links resolve against the answer's own set first, then the vault; PDF links open at "(tr. n)". Every AI message is labelled "Trợ lý AI"; when ready, the screen says what is sent to which provider. design.md's "Mở trong Claude" button is not offered (a page cannot reliably open Claude Desktop): the no-key state explains API key vs "Kết nối Claude". The SSE `error` event carries `details.reason` (a code only).
- **Today line**: shown only when AI is ready, once per local day per window (`POST` at most once, never retried), labelled "AI"; nothing on errors or offline.
- **Editor AI menu**: a toolbar button "AI" (Sparkle) before the source-mode switch and `Alt+A`; disabled with its reason (readiness, scope, source mode, read-only, no selection). What is sent: the selection as Markdown (words only inside one block; a verbatim block's source). Results in a non-modal popover (a bottom sheet below 40rem): summaries/explanations insert `> **Tóm tắt (AI):** …` / `> **Giải thích (AI):** …` as one undo step; "Thay" refuses when the selected text changed; links in title form (path form when not unique); tags merged into `tags:` through the revision-checked property patch (diacritic-insensitive dedupe, her spelling kept).
- **Inbox tidying**: "Gợi ý chỗ để" (note header and tree menu) and the palette's "Dọn Inbox với AI" dialog (one request at a time, never automatic); move + rename together is **one** `POST /note/rename` into the new folder (one journal entry, one undo toast); only checked parts are applied.
- **Settings**: turning AI or embeddings on always opens its consent dialog (focus starts on "Để sau"; Esc/outside = "Để sau"), turning off keeps the stored consent; the consent copy also names deadline titles (Today line) and, for embeddings, search text and re-sending edited notes; the folder list gains "Ghi chú ở gốc kho" (root notes) and hides Templates/Attachments (never sent); monthly limit accepts "2.000.000"; the MCP section shows the stdio snippet in full and the HTTP one collapsed with the token as `••••last4` on screen (full only when copied); "Cập nhật mẫu" sits under "Khôi phục mẫu gốc".
- **Graph "AI vừa chạm"**: each `ai:touched` event is kept (last 5) and played once, the first time the map shows it: the source grows in at the nearest canvas edge (drawn as its own hollow dot when not on the map), signals leave 150 ms apart (300 ms travel), each page lit 10 s with a halo and its name; the rest is not dimmed; one refetch when nodes are missing; the side panel lists "AI vừa cập nhật" (newest first, pages in the AI's order) with a polite live-region sentence; reduced motion lights everything at once.
- **Palette**: footer label "Tìm theo từ khóa (BM25)" or "Từ khóa và theo nghĩa" (hybrid and ready); a "Theo nghĩa" group at the end (one row per file, deduplicated, filters never sent, aborted on change); PDF hits show "tr. N" and open the viewer at that page (`#/file?path=…&page=N`, applied once per navigation, invalid → page 1).
- **Documents**: the text state shows only when not `ok` ("Đang đọc chữ…", "Đọc được một phần chữ", "Không đọc được chữ" + a hint by reason).
- Shared client: `ApiRequestInit.signal` (AI actions and semantic search abort through the shared client, so a vault switch is handled everywhere).
Why: AI proposes and she decides; every surface says what it sends; nothing animates without meaning.
Spec sections affected: F8, F15, F16, F18, F22 (`Alt+A`), F33, F34, design.md §4 screen 7 (interpretations).

## 2026-10-21 M6 review round A: rules added while fixing confirmed findings
Context: An independent security/privacy review proved one High, five Medium and four Low defects; every fix has a regression test.
Decision:
- **Linked paths**: every MCP write (and "Lưu thành ghi chú") checks the **real** place of the path (`VaultService.realPath`: folder links, junctions, Windows 8.3 names resolved) and refuses with `FORBIDDEN`, rule `linked-path`, when it differs from the request beyond NFC/case. The owner's own app writes (capture, daily, notes) still follow links inside the vault, unchanged.
- **Budget reservations**: requests in flight hold their estimate (chat and embeddings); the check counts recorded + held tokens and is repeated when the stream starts (`AI_BUDGET` from the stream then). The estimate stays characters/4 + the output allowance; Vietnamese text runs ~2–3 characters per token, so one admitted request may overrun by the difference (providers report the real usage, which is what is recorded).
- **PDF worker memory**: heap 512 MB + young 32 MB; decoded buffers capped at 256 MB + 3× the file size by a 20 ms watchdog; exhaustion → `none`/`too-large`. On Linux freed worker memory is kept by the allocator (RSS levels off around 0.6–1.1 GB after repeated bombs); a child process would isolate it fully (later, if needed).
- `htmlToText` is a linear scan (identical output); citations are validated **without honouring escapes** and re-checked until stable; the web link parser follows the server's rules exactly.
- The default AI scope never includes hidden top folders (`.name`); an explicit list can.
- Ingest: `logLine` is stored before the append; a retry appends only when the log does not already end with it. Server-written log lines turn control characters and Unicode line/paragraph separators into spaces.
- The Today line counts only in-scope items. One usage store per file; usage arriving after a vault switch goes to the current store (or straight into the file).
Why: Permissions must hold whatever the folder structure; the cap and the server must hold under load and hostile files.
Spec sections affected: §5, F30, F32, F33 (interpretations).

## 2026-10-21 M6 review round B: rules added while fixing confirmed findings (server side)
Decision:
- **Topics in deadline questions**: an item belongs to a course/project when its note is that note, has `course:` pointing to it, links to it, **or** the topic title appears as whole words in the item's or its note's title (case- and diacritic-insensitive, đ = d). When no in-range item matches, the answer says "Không thấy việc nào gắn với <X>. Đây là <n> việc trong khoảng này:" and lists all of them (no model call). Known limits: a short title can over-match ("Toán" in "an toàn"); a Daily note linking a course counts for all its tasks.
- Structured rows show links inside task text as plain words (one link per row, to the item's note); Daily tasks say "(trong daily note dd/mm)"; English dates use the long format ("Wednesday, October 21"). Zero items → notice `no-items` (no "Lưu thành ghi chú").
- `out-of-scope-hidden` on text answers only when hidden matches come from outside `3 Resources` (excluded by default anyway).
- `/ai/search` lists vector hits only from cosine 0.25 (search only; to recheck with real keys, Gemini's baseline is higher); snippets are the index's plain text.
- The stdio bridge prefers the port of a live server from `<home>/.secondbrain/server.json` (pid alive and `/api/health` answers), else `settings.json`.
- The paper-page format asks for `- Nguồn: [[<file>.pdf]]` first under `## Liên quan`, so the brain map keeps the paper → PDF edge; the previous skeleton hash is a known old version for "Cập nhật mẫu".
Spec sections affected: S5, F32 (page format), F33 (interpretations).

## 2026-10-21 M6 review round B: rules added while fixing confirmed findings (web side)
Decision:
- Every "sent to" sentence also names the embedding provider when search by meaning is on (chat, note panel, "Gợi ý liên kết", Inbox dialogs, embeddings consent); other editor actions do no retrieval and do not say it.
- `no-consent` (provider changed) has its own text everywhere: "Bạn vừa đổi nhà cung cấp AI. Mở Cài đặt, mục AI, bấm Xem và đồng ý."
- Focus traps wrap Tab/Shift+Tab from an element outside the focusable list and keep Esc working while focus is outside (innermost trap only). Consent dialogs open at the top (`preventScroll`).
- Text the app writes (not found, zero items, errors before any AI text) is not labelled "Trợ lý AI" and offers no "Lưu thành ghi chú"; citations in text answers render grouped in parentheses as accent links.
- Provider names come from one place ("Anthropic (Claude)", "OpenAI", "Google Gemini"); Vietnamese says "khóa API" everywhere.
- On an Inbox note, "Gợi ý chỗ để" sits under the title; the title input ends with an ellipsis instead of being cut.
- The graph's ghost source dot and its name keep clear of the legend and other overlays.
- Documents: `low` says pages have little text (pictures, slides), the scan wording is kept for `none`.
Spec sections affected: §5 (accessibility), F33, F34, design.md §7 (interpretations).
