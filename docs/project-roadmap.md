# Project Roadmap

Milestones and Definition of Done are defined in `../../SPEC.md` §12. This file tracks **status only**. Update it at the end of every milestone (and when a milestone starts).

| M | Scope (short) | Status | Started | Done | Report |
|---|---|---|---|---|---|
| M0 | Scaffold: Node 24, workspaces, TS, lint (+ i18n AST rule, no-raw-color), vitest, Playwright, tokens.css (2 themes × 3 palettes) + contrast script, fonts bundled, security middleware, launcher scripts, gen-vault | Done | 2026-10-18 | 2026-10-18 | `MILESTONE-0.md` |
| M1 | Vault service (atomic, revisions, trash, journal, path guard), templates, CLAUDE.md skeleton, indexer + FTS (đ-aware normalization), deadline-items service, events.jsonl, watcher, WS, opt-in sample data | Not started | | | |
| M2 | Editor spike (preservation contract) first; then sidebar, editor + source mode, wikilinks + relink, backlinks, tags, properties, tabs, autosave/drafts/undo, conflict UI | Not started | | | |
| M3 | Tasks, Today + 14-day strip (overflow rules), calendar, search palette, capture, daily, graph basic (+ keyboard panel), shortcuts | Not started | | | |
| M4 | Server reminders + Windows toast, settings (backup export/restore, vault switch, run-at-login), i18n complete, attachments + PDF viewer, git history, launcher + PWA checklist → **v1.0** | Not started | | | |
| M5 | Phase 2: graph advanced, MOC, weekly review, scheduled backup, mobile polish, `.exe` + tray, PDF text search, Telegram/email → v1.1 | Not started | | | |
| M6 | Phase 3: MCP server (permissions, ingest manifest, provenance), in-app AI (structured questions, citations, consent), graph AI effect → v2.0 | Not started | | | |

Status values: Not started · In progress · Done · Blocked (reason).

## Notes
- 2026-10-18: SPEC v1.1 (after external review `../gopy.md`), design.md, ClaudeKit setup completed. Next: M0.
- 2026-10-18: M0 done (218 tests, lint, e2e green; independent review findings fixed). Pending owner checks on Windows: launcher double-click, reference machine RAM/disk. Next: M1.
