# Project Changelog

One entry per milestone (newest first). Format:

```
## [M<n>] <YYYY-MM-DD> — <title>
- Added: …
- Changed: …
- Fixed: …
- Known gaps: …
```

## [M5] 2026-10-23 — Bento mềm (new default) and Phase 2: graph timeline, "Học kỳ này", weekly review, scheduled backups, phone layout, single .exe + tray, Telegram/email
- Added (owner request): the Bento mềm style, now the default (`ui.style`, Settings → Giao diện → "Phong cách", applied without reload): floating 84 px rail, "Thư mục" pane or drawer (`Alt+1` per vault), top bar with search and "Ghi chú mới", Today as a 12-column tile grid (greeting, date, nearest deadline countdown, 14-day strip with urgency bars, tasks, project rings, "Não hôm nay", capture, 7-day writing bars) with one first-paint motion, every other screen in tiles; Bento tokens and 330 contrast checks. Yên tĩnh (calm) keeps the previous layout.
- Added: today's activity in `GET /api/today` (`days`, `doneYesterday`, `brain`) from the index and `events.jsonl`; event `note_edited` (once per note per day); one shared, incremental event-log reader.
- Added: brain map time scrubber with "Phát" (`GET /api/graph/history`, renames keep identity), filters by folder/tag/time with `GET /api/graph?folder=&tag=&since=` (remembered per vault, `#/graph?when=today`), 24 h pulse, "Não hôm nay" on Today.
- Added: opt-in "Học kỳ này" page at the vault root (courses with lecture counts, projects by course with deadline, days left and progress), rebuilt within 2 s, read-only in the app, guarded with `GENERATED_PAGE` (MCP included), never overwriting an outside edit or a note of hers.
- Added: weekly review on Sundays ("Tổng kết tuần" with "Dọn Inbox", "Để sau"), `#/review`, `GET /api/review/week`, palette commands.
- Added: daily scheduled backups (same zip as the export, catch-up, retry, retention of the app's own zips only, "Sao lưu ngay", status, "Mở thư mục") and an optional push of the version history to a private GitHub repo (token only in git's environment).
- Added: phone-size layout in both styles (bottom tab bar or sidebar drawer, right panel as a bottom sheet, full-width overlays, 40 px targets).
- Added: single executable (`npm run build:exe`, `launcher\Tạo bản exe.cmd`; Node SEA, runtime extracted once to `%LOCALAPPDATA%\SecondBrain\runtime\<hash>\`, no console window, `--stop`/`--login`/`--mcp-stdio`), Desktop and Start-menu shortcuts on the first start, tray icon and global `Ctrl+Alt+Q` capture box, run at login and the Claude Desktop snippet pointing at the exe; `GET /api/system`.
- Added: Telegram and email reminders (persisted outbox, one message per reminder and channel, backoff, masked secrets, "Gửi thử", consent lines), `POST /api/notify/test`, `GET /api/notify/status`.
- Changed: the git auto-commit message counts only her files (app state such as `events.jsonl` is committed, not counted); the exe never falls back to node-notifier for toasts; the launcher's forced stop recognises the exe; the route security test enumerates every registered route.
- Fixed (review A and the e2e run): morning catch-up of a missed backup, backups to FAT32/exFAT USB sticks and shares, a note of hers taken over by the semester page, Telegram/email retries for done/moved/deleted items, `/api/today` cost growing with the whole log, a torn log line swallowing the next event, the page's rebuilds and wiki pages counted as her writing, exe cleanup and runtime integrity, stale backup temp files, SMTP without TLS to remote hosts, the Telegram test hook, a 500 on an extreme review date, slow network work holding up reminders and shutdown; the untinted "Ngày" tile, grey strip bars, the graph filter forgotten after a reload.
- Known gaps: see `MILESTONE-5.md` (Windows checks for the exe, tray, hotkey, shortcuts, USB backups, GitHub, Telegram and Gmail). Review B (UI) and the e2e defects D1–D5 were fixed in the last round; final run 5,031 unit tests and 103 e2e tests green in both styles.

## [M6] 2026-10-21 — AI: MCP server for Claude Desktop, in-app AI, "AI vừa chạm", PDF text
- Added: PDF text extraction (worker thread with size/page/time/memory caps, quality flag, derived cache), PDF pages in search with page numbers, viewer opening at a page, text state in "Tài liệu"; index schema 6 with `retrieve()` for AI.
- Added: MCP server (`/mcp` Streamable HTTP with Bearer token, stdio bridge `server/dist/mcp-stdio.js` for Claude Desktop), 19 tools behind a server-enforced permission table, ingest manifest with idempotent completion and server-written log lines, `wiki_lint`, resources and prompts from `CLAUDE.md`, bounded results; Settings "Kết nối Claude (MCP)" with the config snippet and "Cho phép AI sửa ghi chú cá nhân".
- Added: in-app AI (Anthropic/OpenAI/Gemini over `fetch`): consent dialogs, folder scope, monthly token limit with reservations, status; chat "Hỏi" (Ask screen, note panel, palette) with structured deadline answers and validated citations, "Lưu thành ghi chú"; editor "AI" menu (`Alt+A`); Inbox tidying with journaled apply and undo; Today assistant line; search by meaning (embeddings with consent, quiet period, backoff, rebuild).
- Added: graph "AI vừa chạm" effect and accessible "AI vừa cập nhật" list.
- Changed (owner request): richer paper format in `Templates/Paper.md` and the `CLAUDE.md` page format; "Cập nhật mẫu" upgrades unedited old versions (old copy to the trash).
- Fixed (review rounds): writes through folder links, cost cap under concurrency, PDF deflate bombs, quadratic HTML stripping, escaped citation links, hidden folders in AI scope, duplicate ingest log line, course filter for plain-word tasks, honest "sent to" copy incl. the embedding provider, focus traps, re-consent wording, styling and copy details.
- Known gaps: see `MILESTONE-6.md` (Claude Desktop connection, one real ingest and a real API key are manual owner checks).

## [M4] 2026-10-21 — Reminders, settings, attachments + PDF viewer, history, launcher + PWA (v1.0 candidate)
- Added: server reminder scheduler (3 days, 1 day, due day at the configured time; catch-up after sleep or a restart; one summary toast for bursts) with Windows toasts (PowerShell, node-notifier fallback) and the in-app "Nhắc nhở" list, badge and one Web Notification across windows when no toast was shown.
- Added: Settings screen (appearance applied live, reminder time, vault switch in process, rebuild with progress, backup export/restore, template restore, sample-data delete, log folder, run at login, port, install app, quit, AI keys stored masked) and `GET/PUT /api/settings`; vault host with per-vault plugins and an `x-sb-vault-id` guard.
- Added: attachments (drop/paste into the editor and source mode, vault-wide unique names, inline images, file cards), "Tài liệu" view, pdf.js viewer tab under the strict CSP, downloads and "Mở bằng ứng dụng khác".
- Added: git version history in the vault (exclude/attributes in `.git/info`, auto-commit every 10 minutes and on shutdown, history dialog with diff and revision-checked restore).
- Added: PWA (manifest, icons, shell-only service worker with offline shell and update toast, install button), launcher `login` action, start-hidden.vbs, port-busy dialog naming the process, opening the installed app.
- Fixed (review rounds): restored copies get their own vault id (and keep their reminder history), consistent backups, history restores that keep the replaced text, unreadable reminder store never overwritten, no vault inside a vault, recovery in place when the app opened before the server, focus after confirms and dismissals, contrast on selected rows, viewer keys in the shortcut sheet, English plurals.
- Known gaps: see `MILESTONE-4.md` (manual Windows checks pending: real toast, run at login after a reboot, installed-app window, port-busy dialog, Explorer/default-app opening, S6 after a reboot).

## [M3] 2026-10-21 — Today, calendar, search, capture, daily notes, brain graph
- Added: Today (greeting, one-sentence summary, 14-day strip over 60 days with overdue cell, popovers and keyboard path, today's tasks, inline capture, projects in progress, sample-data prompt, inline offline banner), "Việc cần làm" view, month calendar with day pane and rescheduling by drag or date picker (journaled, 10 s undo).
- Added: brain map (d3-force on canvas, token colours, source nodes, intro/drift with reduced-motion support, hover/click/double-click, keyboard side panel, legend, hub names, local graph in the note pane).
- Added: `>` commands from one registry, filter suggestions, recently opened notes, `Alt+Q` capture overlay, `Alt+T` daily notes with navigation, `Ctrl+/` shortcut sheet; Word-like formatting toolbar with Word shortcuts and `<u>…</u>` underline (owner request); caret at `{{cursor}}`.
- Added (server): revisions on deadline items, `PATCH /note/task` (paragraph-aware, byte-identical to the editor tick), journaled `POST /note/reschedule`, `POST /capture`, daily routes, template variables in the UI language with `cursor`, `GET /graph`, `GET /graph/local`, index schema 5.
- Fixed (review round): tick rendering inside quotes/HTML, own-write revision chain after undo, emoji caret offset, editor/server tick parity, 📅 tokens in links, capture name characters, non-UTF-8 templates, Daily template fallback; strip labels, row layout, tooltips, palette ranking, kept ticked rows, summary counting, long lists, load jump, shortcut sheet, graph labels, toolbar hints, weekday casing, focus loss and startup races.
- Known gaps: see `MILESTONE-3.md` (Today render p95 on the dense 5k vault, PWA shortcut column and reference-machine fps are manual Windows checks, no calendar week view).

## [M2] 2026-10-19 — Editor, links and notes
- Added: block-preserving Markdown ⇄ Tiptap converter (unchanged blocks byte-identical, item-level list preservation, ticks as one-line patches, verbatim blocks for unsupported constructs, every changed region re-parsed before writing) – the M2 gate, passed first.
- Added: writing surface (input rules, slash menu, `[[` / `#` / date popups, wikilinks with ghost/ambiguous states, task checkboxes, list nesting, paste, focus mode); note screen (title rename with relink, autosave with truthful states, per-window IndexedDB drafts, three-version conflict screen, property bar, source mode).
- Added: sidebar tree (WAI-ARIA, keyboard, context menu, drag to move, Inbox badge), tabs, undo toasts through the journal, dialogs, unfinished-operation and connection banners, focus recovery, shortcut registry; right panel (outline, backlinks, unlinked mentions), "Thẻ" view, `Ctrl+K` palette.
- Added (server): front matter line patches, dry runs, unlinked mentions + link-mention, folder rename/trash (journaled), reveal in Explorer, conflict copy to trash, unique/content note creation, link targets, backlink highlights (index schema v3).
- Fixed (review round): distant edits, list merges, trailing-text check, soft-wrapped ticks, table-safe link-mention, front-matter comments, queue races (source mode, late saves, rename), per-window drafts, focus and keyboard paths, visible urgency text, flaky e2e.
- Known gaps: see `MILESTONE-2.md` (large-note load time, verbatim constructs, set-aside versions list, M3 items).

## [M1] 2026-10-19 — Vault & index
- Added: VaultService (revisions, write queue, atomic + no-clobber writes, text patches, trash with meta.json, operation journal with crash recovery and undo, path guard), first-start layout with 8 bundled templates and the `CLAUDE.md` skeleton.
- Added: Markdown layer (fast CommonMark-faithful scanner + remark fallback, front matter, wikilinks/tags/tasks with exact offsets, content classes, §4.4 link resolution, relink planner that keeps every link's meaning).
- Added: SQLite index with FTS5 diacritic-insensitive search, filters and snippets, incremental updates, reconcile, rebuild-and-swap, `events.jsonl`, deadline-items service (Today, strip, calendar, tasks, projects).
- Added: watcher for outside edits, change router + WebSocket events, REST routes for notes/search/today/calendar/tasks/tags/files/templates/journal/index/sample data, opt-in sample data, logs in the vault, `npm run bench:index`.
- Fixed (review round): no re-encoding of non-UTF-8 files, no clobbering on resumed renames, best-effort housekeeping, long names, rebuild races, YAML-safe relink, đ/d link identity, quadratic parsing.
- Known gaps: see `MILESTONE-1.md` (Windows-only paths tested on Linux, Markdown links not rewritten, transient event-log pairs on relink).

## [M0] 2026-10-18 — Scaffold
- Added: npm workspaces (server, web), TypeScript strict, ESLint + Prettier, Vitest (server/web/tooling projects), Playwright smoke e2e.
- Added: Fastify server on 127.0.0.1:4747 with Host allowlist, Origin check, session token, CSP and security headers; `/api/health`, `/api/settings`, `/ws`; rotating log; single-instance and port-busy handling.
- Added: React 18 + Vite dark shell (sidebar skeleton, Today placeholder with time-of-day greeting), design tokens for 2 themes × 3 palettes, bundled Be Vietnam Pro / JetBrains Mono, vi/en i18n.
- Added: lint rules for literal UI strings and raw colors, i18n parity check, contrast check (90 pairs), `gen-vault` performance fixture generator, Windows launcher (hidden server, start/stop).
- Known gaps: launcher not yet run on real Windows PowerShell 5.1; reference machine RAM/GPU/disk to confirm.

## [setup] 2026-10-18 — Project setup
- Added: SPEC.md, design.md, PLAN.md, Today screen mock, ClaudeKit agent setup (skills, agents, rules, hooks) tailored to this project.
