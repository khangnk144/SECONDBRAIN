# Project Changelog

One entry per milestone (newest first). Format:

```
## [M<n>] <YYYY-MM-DD> — <title>
- Added: …
- Changed: …
- Fixed: …
- Known gaps: …
```

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
