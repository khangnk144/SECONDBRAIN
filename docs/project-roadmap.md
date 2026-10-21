# Project Roadmap

Milestones and Definition of Done are defined in `../../SPEC.md` §12. This file tracks **status only**. Update it at the end of every milestone (and when a milestone starts).

| M | Scope (short) | Status | Started | Done | Report |
|---|---|---|---|---|---|
| M0 | Scaffold: Node 24, workspaces, TS, lint (+ i18n AST rule, no-raw-color), vitest, Playwright, tokens.css (2 themes × 3 palettes) + contrast script, fonts bundled, security middleware, launcher scripts, gen-vault | Done | 2026-10-18 | 2026-10-18 | `MILESTONE-0.md` |
| M1 | Vault service (atomic, revisions, trash, journal, path guard), templates, CLAUDE.md skeleton, indexer + FTS (đ-aware normalization), deadline-items service, events.jsonl, watcher, WS, opt-in sample data | Done | 2026-10-18 | 2026-10-19 | `MILESTONE-1.md` |
| M2 | Editor spike (preservation contract) first; then sidebar, editor + source mode, wikilinks + relink, backlinks, tags, properties, tabs, autosave/drafts/undo, conflict UI | Done | 2026-10-19 | 2026-10-19 | `MILESTONE-2.md` |
| M3 | Tasks, Today + 14-day strip (overflow rules), calendar, search palette, capture, daily, graph basic (+ keyboard panel), shortcuts; owner request: Word-like formatting toolbar + `<u>` underline | Done | 2026-10-19 | 2026-10-21 | `MILESTONE-3.md` |
| M4 | Server reminders + Windows toast, settings (backup export/restore, vault switch, run-at-login), i18n complete, attachments + PDF viewer, git history, launcher + PWA checklist → **v1.0** | Done (tag `v1.0` after the owner's Windows checks) | 2026-10-21 | 2026-10-21 | `MILESTONE-4.md` |
| M6 | **Next** (owner moved it before M5). Phase 3: MCP server (permissions, ingest manifest, provenance), in-app AI (structured questions, citations, consent), graph AI effect; plus F30 PDF text extraction pulled from M5 | Not started | | | |
| M5 | After M6. Phase 2: graph advanced (incl. "não hôm nay"), MOC, weekly review, scheduled backup, mobile polish, `.exe` + tray, Telegram/email (PDF text extraction already done in M6) | Not started | | | |

Status values: Not started · In progress · Done · Blocked (reason).

## Notes
- 2026-10-18: SPEC v1.1 (after external review `../gopy.md`), design.md, ClaudeKit setup completed. Next: M0.
- 2026-10-18: M0 done (218 tests, lint, e2e green; independent review findings fixed). Pending owner checks on Windows: launcher double-click, reference machine RAM/disk. Next: M1.
- 2026-10-19: M1 done (834 tests, lint, typecheck, e2e green; two independent reviews, all confirmed findings fixed). Next: M2 – start with the editor spike (F3.1/F3.2 on the corpus) before the rest.
- 2026-10-19: M2 done (editor spike passed first; 2,671 tests, lint, typecheck, 30/30 e2e incl. S3a; two independent reviews, all confirmed findings fixed). Pending owner check on Windows: write/link/rename flow, Reveal in Explorer. Next: M3.
- 2026-10-21: M3 done (3,360 tests, lint, typecheck, 64 e2e ×2 incl. S1, S2 minus notifications, dense Today, keyboard-only runs and the shortcut matrix; two independent reviews, all confirmed findings fixed; owner additions: formatting toolbar with Word shortcuts, `<u>` underline, hub names on the brain map). Pending owner checks on Windows: see `MILESTONE-3.md`. Next: M4.
- 2026-10-21: M4 done (full unit/integration suite, lint, typecheck, 45 e2e incl. S2 minus the real toast, S3b, S6 minus the reboot, F19.2 in both languages, PWA checklist parts, backup round trip; two independent reviews, all confirmed findings fixed). Pending owner checks on Windows: see `MILESTONE-4.md`; then tag `v1.0`.
- 2026-10-21: Owner moved the AI milestone (M6) before Phase 2 (M5); F30 PDF text extraction goes with M6 (see `DECISIONS.md`). Next: M6, from the F32–F34 acceptance criteria in SPEC (+ F30).
