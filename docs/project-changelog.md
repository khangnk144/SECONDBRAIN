# Project Changelog

One entry per milestone (newest first). Format:

```
## [M<n>] <YYYY-MM-DD> — <title>
- Added: …
- Changed: …
- Fixed: …
- Known gaps: …
```

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
