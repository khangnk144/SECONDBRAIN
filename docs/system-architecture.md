# System Architecture

Planned architecture: `../../SPEC.md` §8 (modules), §4 (data model), §9 (REST API), F32 (MCP). This file describes the architecture **as built**. Update it at the end of each milestone with what actually exists and any deviations (also log deviations in `../DECISIONS.md`).

## Planned shape (summary)
```
Browser (React + Vite PWA)
   │  REST /api/*  +  WebSocket /ws
   ▼
Node.js server (Fastify, 127.0.0.1:4747)
   ├── VaultService ── atomic fs ops on D:\SECONDBRAIN\vault
   ├── Watcher (chokidar) → Indexer → SQLite (.secondbrain/index.sqlite, FTS5)
   ├── Git (auto-commit in vault), Reminders, Settings
   ├── MCP server (stdio + streamable HTTP)      [Phase 3]
   └── AI providers + retrieval + embeddings     [Phase 3]
```
Data flow: UI → REST → VaultService writes file → watcher → indexer → WS `note:changed` → UI refresh. The UI never writes files directly; MCP tools call the same services as REST.

## As built (after M0, 2026-10-18)

```
app/
├── package.json            npm workspaces (server, web); scripts dev/build/start/test/test:e2e/lint/typecheck/gen-vault
├── vitest.config.ts        one run, three projects: server (node), web (jsdom), tooling (scripts + lint rules)
├── eslint.config.js        flat config + local plugins from eslint-rules/
├── playwright.config.ts    e2e against the built server on port 4799 with a temp home
├── server/src/
│   ├── index.ts            CLI entry: --dev --home --port (env SB_HOME/SB_PORT); exit 0 already running, 2 port busy, 64 bad args
│   ├── config/             app paths (home = parent of app/), CLI args, global settings.json (atomic, token on first run, corrupt-file backup)
│   ├── runtime/            start-server (listen 127.0.0.1, server.json, signals), probe for an already-running instance
│   ├── security/           Host allowlist 421, Origin check 403, session token 401 (constant time), baseline headers + CSP
│   ├── http/               buildApp() factory used by index.ts and every test; JSON error helper
│   ├── api/                GET /api/health (public), GET /api/settings (ui prefs + port, never secrets)
│   ├── ws/                 /ws?token= sends {type:"hello"}
│   ├── shell/              UI shell: prod = web/dist + placeholder injection; dev = Vite middleware (@fastify/middie)
│   ├── logging/            rotating file logger (5 MB, 3 files), one line per request, no query strings or tokens
│   └── fs/                 atomic write (temp file in the same dir + fsync + rename)
├── web/
│   ├── index.html          placeholders __SB_TOKEN__ __SB_BOOT__ __SB_LANG__ __SB_THEME__ __SB_PALETTE__ __SB_FONT_SIZE__ (filled by the server)
│   └── src/
│       ├── app/            hash router, 3-pane layout, sidebar (search placeholder, nav, folders empty state), right panel
│       ├── features/       today (greeting + summary placeholder), placeholders for tasks/calendar/graph, not found
│       ├── i18n/           i18next init, vi.json (default), en.json, lint-allowlist.json
│       ├── lib/            boot config from meta tags, API client (X-SB-Token), UI prefs store + <html> attributes, greeting, dates
│       └── styles/         tokens.css (only file with colors: dark/light × dau-tam/hoa-dao/oai-huong, font sizes), base, layout, sidebar
├── eslint-rules/           i18n/no-literal-ui-strings, colors/no-raw-color (+ RuleTester tests)
├── scripts/                check-contrast, check-raw-colors, check-i18n-parity, gen-vault (5k notes / 51 MB / 20k links / 3k tasks)
└── launcher/               start-second-brain.ps1 (start/stop, hidden server, health probe), Mở Second Brain.cmd, root-wrapper.cmd
```

**Request path today:** browser → `http://localhost:4747` → security hook (Host → Origin → token → 127.0.0.1 shell redirect) → `/api/*` routes, `/ws`, or the UI shell. The shell is rendered per request with the session token in a meta tag; the web app reads it and sends it as `X-SB-Token`.

## As built (after M1, 2026-10-19)

```
server/src/
├── vault/          VaultService (vault-service.ts → read/write/rename/trash ops), write queue, disk-name mapping (NFC/NFD, case),
│                   journal (store, runner, step actions, validation), trash (store, ops), open-vault (layout, identity, housekeeping),
│                   vault-watcher.ts (chokidar → VaultChange 'external'), vault-types.ts (contract)
├── fs/             atomic write (short .sb-<hex>.tmp names, mode kept, no-clobber link), move with EXDEV copy fallback, realpath fallback
├── security/       path-guard.ts (syntax + realpath containment) + the M0 Host/Origin/token hooks
├── templates/      bundled templates + CLAUDE.md skeleton (TS strings)
├── markdown/       parseNote (fast-* scanner, mdast fallback), normalize-text, content-classes, link-catalog/resolve-link, relink
├── index/          open-index (service + change queue), schema, builder, rebuild-and-swap, database-swap, writer/reader/mutations,
│                   reconcile, link re-resolution, search (parser, FTS query, snippets, due filter), deadline service + today view,
│                   event log, index-relink-planner
├── lib/            local-date (calendar dates in local time)
├── app-context/    createAppContext: vault → index → deadlines → relink planner → watcher → change router → WS hub
├── api/            vault routes (note, note operations, journal, queries, listing/tree, files, maintenance incl. sample data)
├── ws/             hub + server event shapes
├── sample-data/    opt-in sample set (Vietnamese notes, wiki pages, 3 one-page PDFs via a tiny PDF writer)
└── (M0) config, runtime, http, shell, logging
```

**Data flow:** REST mutation → VaultService (queue, revision check, journal) → `VaultChange` (origin app) → change router → index update → WS event. Outside edits: chokidar → `VaultChange` (origin external) → same router (echoes of app writes dropped only when the index already agrees). Rename/move with relink: the planner (inside the write queue) waits for pending index updates, plans edits from the index catalog + candidates, the journal applies them and the rename.

**Files on disk:** `<vault>/.secondbrain/{vault.json, cache/index.sqlite, state/{events.jsonl, journal/, drafts/, ingest/, sample.json}, trash/, logs/app.log}`; global `<home>/.secondbrain/{settings.json, server.json, logs/server.log}`.

## As built (after M2, 2026-10-19)

```
server/src/
├── api/            + note-frontmatter-routes (PATCH /note/frontmatter), note-mention-routes (GET /note/mentions,
│                   POST /note/link-mention), folder-routes (create/rename/trash), reveal-route, link-targets route;
│                   rename/move accept dryRun; PUT /note conflictCopy; POST /note unique/content
├── markdown/       + frontmatter-patch (YAML-aware line patches with verify step)
├── mentions/       unlinked mentions scan (index candidates → exact scan outside code/links/HTML) and link-mention patch
├── vault/          + previewRename/previewMove/previewRenameFolder, renameFolder/trashFolder (journal op kinds
│                   folder-rename/folder-trash: one directory move), writeKeepingConflictCopy, patchWith
└── index/          schema v3 (link context offsets for backlink highlights)

web/src/
├── editor/
│   ├── schema/     Tiptap node/mark definitions only (wikilink atom, verbatimBlock atom, lists with `loose`)
│   ├── markdown/   block-preserving converter: loadMarkdown → {doc, snapshot}; saveMarkdown(WithSnapshot) matches
│   │               top-level nodes with eq(), keeps unchanged bytes, patches ticks as text, re-parses every changed
│   │               region before accepting it; verbatim blocks for unsupported constructs; chunked remark parse
│   ├── extensions/ input rules, task item view + toggle, wikilink view/follow, inline decorations (tags, date chips),
│   │               paste, table keys, writing focus
│   ├── popups/     slash menu (registry), [[ autocomplete, # tags, date picker, "Chọn đích…" menu, template insert
│   └── markdown-editor.tsx   <MarkdownEditor> (props + handle: focus, replaceDoc, getDoc)
├── features/
│   ├── note/           note screen (title rename, save indicator, banners, source mode, editor host)
│   ├── note-session/   one session per open note outside React: base text/revision, snapshot, serial queue for
│   │                   save / property patch / rename / conflict actions, autosave 500 ms, retries, outside changes
│   ├── drafts/         IndexedDB drafts {vaultId, path, baseRevision, text, ts} + "kept" copies from "Tải lại"
│   ├── conflict/       three-version conflict screen (Tải lại / Giữ bản của tôi / So sánh with a line diff)
│   ├── properties/     property bar: chips, typed editors, YAML parsed locally, edits via PATCH /note/frontmatter
│   ├── sidebar/        WAI-ARIA tree (roving focus, context menu, inline rename, drag to move), Inbox badge
│   ├── tabs/ toasts/ dialogs/ journal/ connection/   shell pieces (tab bar, toast host, modal primitives, banners)
│   └── backlinks/ mentions/ outline/ tags/ search/   right panel sections, tags view, Ctrl+K palette
├── lib/            typed api/*, ws client + event bus (resync on reconnect), per-vault storage, zustand stores
│                   (vault, tree, tabs, panes, toasts, search UI, writing focus, link targets), shortcuts registry,
│                   note-operations (dry run → confirm → journaled operation → 10 s undo toast)
└── i18n/           vi.json/en.json core + locales/<area>.<lang>.json merged under <area>
```

**Save path:** editor transaction → session marks dirty → draft (≤ 300 ms) → autosave 500 ms after the last change:
`saveMarkdownWithSnapshot(doc, snapshot)` → if equal to the base text nothing is written → `PUT /note {content,
expectedRevision}` → VaultService (revision check, atomic write) → watcher/index → WS `note:changed` (the session
ignores its own echo) → backlinks/tags/tree refresh. 409 or an outside change while dirty → conflict screen.

## As built (after M3, 2026-10-21)
- **Server.** New routes in `server/src/api/`: `note-task-routes.ts` (`PATCH /note/task`, `POST /note/reschedule`), capture and daily routes, graph routes (`server/src/graph/vault-graph.ts` builds nodes/edges from the index). Task line patches live in `server/src/markdown/task-line-patch.ts` with `task-paragraph.ts` (paragraph continuation from the block scanner and a before/after render check) and `task-token-mask.ts` (tokens in code/HTML/links are not dates). Reschedule is a journaled single-file rewrite (`server/src/vault/journaled-rewrite-ops.ts`, op `reschedule`). Template variables (dayjs, UI language from the global settings) are shared by `POST /note` and `POST /daily`, which return the `{{cursor}}` offset. Deadline items carry the note revision. Index schema 5.
- **Web data layer.** `lib/api/*` mirrors (deadlines, capture/daily, graph), `lib/use-live-query.ts` (refetch on vault events, resync, rebuild and local day change; stale answers dropped), `lib/local-day.ts`, `lib/recent-notes-store.ts`, `lib/capture-flow.ts`, `lib/daily-flow.ts`, UI stores for the capture overlay and the shortcut sheet, `lib/commands/` (command registry gated by `IMPLEMENTED_FEATURES`). `features/deadline-items/` holds the shared row, the actions (tick, note done, reschedule with undo) and `own-write-revisions.ts`, which carries a note's newest revision between back-to-back writes and drops it on conflicts, undo or foreign changes.
- **Screens.** `features/today/` (strip model + roving focus, popover, kept rows, projects, sample-data card, placeholder), `features/tasks/`, `features/calendar/` (month model, grid with roving focus, day pane, drag and picker rescheduling, URL state), `features/graph/` (model, seeded d3-force layout with a time budget, canvas view with grid hit testing, palette from tokens, motion, labels incl. hub names, side panel, legend, local graph section), `features/capture/`, `features/daily/`, `features/shortcut-sheet/`. The graph route is "immersive" (side panes hidden for the visit without changing stored preferences).
- **Editor.** `editor/formatting/formatting-commands.ts` is the one registry for the toolbar, its key bindings and the shortcut sheet; the toolbar is a WAI-ARIA toolbar with tooltips. The converter maps exact `<u>…</u>` pairs to the underline mark; `done-token-rules.ts` keeps the editor tick identical to the server's; `source-offset-caret.ts` maps a source offset (UTF-16) to an editor position for `{{cursor}}`.
- **Tests.** E2E specs for S1, S2 (minus notifications), dense Today, keyboard-only runs, the shortcut matrix, the graph, and opt-in performance specs (`SB_PERF=1`, second server on port 4798).

## As built (after M4, 2026-10-21)
- **Vault host and plugins.** `server/src/app-context/vault-host.ts` owns the open vault context, one WebSocket hub for every vault, a request gate (requests wait during a switch) and the per-vault plugins (`vault-plugins.ts`: started after a vault opens, closed before it closes). Routes receive a delegating context that always resolves to the open vault. `POST /api/vault/switch` reopens the previous vault on any failure; `x-sb-vault-id` on a request refuses a stale window (409 `vault-switched`). `server/src/index.ts` passes the two plugins: reminders and history.
- **Settings.** `server/src/config/` holds the settings store (one change at a time, updated in place) and the strict validator for `PUT /api/settings`; the public view is an allowlist (API keys only as `…last4`). `server/src/system/` creates/removes the run-at-login `.lnk` through PowerShell.
- **Backup.** `server/src/backup/`: the export is built under the vault's write queue into a temp zip in `.secondbrain/cache/` (fflate) and then streamed; the restore extracts a multipart zip into a temp sibling folder with path-guard checks on every entry and size caps, gives the copy a new vault id (reminder keys follow), renames it into place and switches to it.
- **Reminders.** `server/src/reminders/`: plan (thresholds, catch-up, superseded keys), store (`state/reminders.json`, written before the toast, never overwritten when unreadable), evaluation every 60 s and after wake, Windows toast via `-EncodedCommand` PowerShell with a node-notifier fallback, vi/en texts; routes `GET /api/reminders`, `POST /api/reminders/dismiss`; WS `reminder`.
- **Attachments and files.** `server/src/attachments/` (names, vault-wide uniqueness incl. note titles, placement, resources listing with `referencedBy`, open with the OS refusing programs and macro files); routes `POST /api/attachments` (multipart in its own scope), `GET /api/files?download=1`, `GET /api/resources`, `POST /api/files/open-external`.
- **History.** `server/src/git/`: hardened `execFile` runner (no shell, hooks off, inherited `GIT_*` dropped), repository preparation (`.git/info/exclude`, `.git/info/attributes` byte-exact), auto-commit every 10 minutes and on close, stale lock removal, `git log --follow` parsing, restore = commit pending changes → revision-checked write → commit.
- **Web.** `features/settings/` (sections, live UI prefs, `settings:changed`, vault switch + reload, backup forms), `features/reminders/` (store, screen, badge, one notification per reminder across windows), `features/viewer/` (pdf.js legacy build without WebAssembly or eval, lazy pages, text layer, keys, `openVaultFile` implementation), `features/resources/` ("Tài liệu"), `features/history/` (dialog host, diff, restore), `editor/attachments/` (drop/paste upload, chooser, link insertion, image views via `lib/vault-file-blob.ts`), `lib/vault-boot.ts` (recovery in place when the app opened before the server), tabs with `kind: 'note' | 'file'`.
- **PWA.** `web/src/pwa/` (service worker source with pure routing/strategy functions, registration + update toast, install prompt store and button), `web/vite-plugin-service-worker.ts` (emits `dist/sw.js` with `BUILD_ID` and the precache list), `web/public/manifest.webmanifest` + icons (`scripts/gen-icons.ts`); the server serves `sw.js`/manifest with `no-cache`.
- **Launcher.** `launcher/start-second-brain.ps1` actions `start`, `stop`, `login`; `launcher/start-hidden.vbs` (run at login, no window); `launcher.log`; port-busy dialog naming the process; opens the installed app when there is one.
- **Tests.** E2E specs for S3b, S2 (reminders), Settings, vault switch and backup round trip, S6 minus the reboot, both languages, the PWA checklist parts Chromium can drive and version history; helpers start their own servers on 47690–47697.
