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
