# Milestone 1 – Vault & index

Date: 2026-10-19 · SPEC v1.1 §12 row M1 · Plan: `plans/2026-10-18-m1-vault-index/plan.md` (+ `phase-a…d` briefs, `reports/`)

## What was built
- **Vault service** (`server/src/vault/`, `server/src/fs/`, `server/src/security/path-guard.ts`): one `VaultService` for every read and write of user data. SHA-256 revisions on every mutation (409 `CONFLICT` with the current revision/content), one write queue per vault, atomic writes (temp in the same folder + fsync + rename, Windows retry, no-clobber create via hard link), text-range patches, NFC/NFD and case-variant name mapping, trash with `meta.json` (never unlinks), operation journal with `before`/`after` copies, crash recovery ("Hoàn tất" / "Hoàn tác") and revision-checked undo, path guard (traversal, absolute/UNC, reserved names, trailing dots/spaces, ADS, `.secondbrain`, symlinks/junctions leading outside). Non-UTF-8 files and symlinks are never rewritten.
- **First start** (`openVault`): `vault.json`, the state layout, the folders of SPEC §3, 8 bundled templates (F14) and the `CLAUDE.md` skeleton for the Phase 3 wiki maintainer – nothing else. Housekeeping (leftover temp files, old journal entries, 30-day trash purge) is best-effort.
- **Markdown layer** (`server/src/markdown/`): `parseNote` (front matter, wikilinks/embeds/Markdown links with exact offsets, tags, tasks with `📅`/`✅`, headings, readable text) through a fast CommonMark-faithful scanner with a remark fallback (differential-tested), normalization (đ→d for search; NFC+lowercase for link identity), content classes (§4.2), link resolution (§4.4) and the relink planner (F4 rules + "never change what another link means").
- **Index** (`server/src/index/`): SQLite (better-sqlite3) with the §4.14 schema + additive tables, standalone FTS5 with diacritic-insensitive search, incremental updates with ghost/ambiguous re-resolution, reconcile on start, rebuild into a new file + atomic swap (queries keep using the old index; edits during the rebuild are queued), `events.jsonl` (§4.15), search with filters and snippets, the deadline-items service (Today, strip, calendar, tasks, projects) on local calendar dates.
- **Server wiring** (`server/src/app-context/`, `api/`, `ws/`, `vault/vault-watcher.ts`, `sample-data/`): vault opened at boot (default `<home>/vault`, refused if it overlaps the install), chokidar watcher for outside edits (rename detection, echo suppression), one change router to the index and the WebSocket hub, REST routes of SPEC §9 needed so far, `GET /files` with safe headers, opt-in sample data (22 files incl. 3 generated one-page PDFs), logs in `vault/.secondbrain/logs/app.log`.

## Acceptance criteria assigned to M1

| AC | Verification |
|---|---|
| F1.1 empty folder → exactly folders, templates, `CLAUDE.md`, `vault.json` | `server/test/vault/open-vault.test.ts`, `server/test/integration/boot-vault-layout.test.ts`; manual smoke run of the built server on a fresh home |
| F1.2 kill mid-write leaves the original intact | `server/test/vault/vault-kill-mid-write.test.ts` (child process SIGKILLed 6× while rewriting a 4 MB note), `vault-write-failures.test.ts` (crash between temp write and rename) |
| F1.3 outside edit reflected within 1 s | `server/test/integration/vault-watcher.test.ts`, `server/test/integration/external-edits.test.ts` (search, `GET /note`, tree and WS events within 1 s; outside edit → WS p95 189 ms). Sidebar rendering itself is F2.3 (M2) |
| F1.4 trash with `meta.json`, same base names, other drive (copy fallback), never unlink | `server/test/vault/vault-trash.test.ts`, `vault-trash-no-unlink.test.ts` (EXDEV simulated) |
| F1.5 path guard → 400 `INVALID_PATH` for read, write, rename target, file serving; junction outside rejected | `server/test/vault/path-guard.test.ts`, `vault-path-safety.test.ts`, `server/test/api/path-guard-through-api.test.ts` (guard table × 5 routes, symlink escapes, `.secondbrain` and global settings unreachable). Junction variant runs on Windows only (skipped here; symlink variant passes) |
| F1.6 Vietnamese/NFD/space names, case-only rename, rename onto existing → 409 | `server/test/vault/vault-unicode-names.test.ts`, `vault-long-names.test.ts` |
| F1.7 interrupted rename-relink → reported, "Hoàn tất"/"Hoàn tác" | `server/test/vault/vault-journal-recovery.test.ts` (crash after every step k), `vault-journal-conflicts.test.ts`, `vault-rename-resume-no-clobber.test.ts`, `server/test/api/journal-recovery-api.test.ts` (restart → `GET /api/journal/pending`, WS `journal:pending`, `/complete` and `/undo` over HTTP) |
| F1.8 disk full / permission denied → `WRITE_FAILED` with path, original intact | `server/test/vault/vault-write-failures.test.ts`, `vault-io-errors.test.ts`, `server/test/api/error-reporting-api.test.ts` (500 `WRITE_FAILED`, no absolute path or stack in the body) |
| F14.1 bundled templates created once, never overwritten, restore re-creates missing only | `server/test/vault/bundled-templates.test.ts` |
| F8.2 (API level) diacritic-insensitive search, NFD = NFC, special characters never error, empty query → recents | `server/test/index/fts-query.test.ts`, `index-search.test.ts`, `server/test/api/search-and-rebuild-api.test.ts` |
| F8.5 identical results and snippets after create/edit/delete/rename + rebuild | `server/test/index/index-rebuild.test.ts`, `index-rebuild-races.test.ts` (changes racing an explicit and an open-time rebuild), `server/test/api/search-and-rebuild-api.test.ts` |
| F9.3 urgency with a mocked clock (midnight, month/year, wake after sleep) | `server/test/index/deadline-clock.test.ts` (suite pinned to `Asia/Ho_Chi_Minh`; also run with `TZ=America/New_York`: 250/250 index + markdown tests pass) |
| F9.4 content-class fixture: Today, Calendar, Tasks, items agree | `server/test/index/deadline-content-classes.test.ts`, `server/test/markdown/content-classes.test.ts` |
| F9.5 one item per deadline-only note, two for note + task on the same day, no duplicate ids | `server/test/index/deadline-item-identity.test.ts` |
| Path-guard and security integration | `server/test/api/vault-routes-security.test.ts` (every M1 route: missing/wrong token 401, foreign Origin 403, wrong Host 421, WS without token), `path-guard-through-api.test.ts` |
| DoD: rebuild-and-swap works | `index-rebuild.test.ts`, `index-rebuild-races.test.ts`, `database-swap.test.ts` (failed open after swap restores the previous index) |

Groundwork tested early (their AC belong to M2): link resolution matrix F4.2 (`resolve-link.test.ts`), relink F4.3/F4.4 (`relink.test.ts`, `relink-meaning.test.ts`, `index-relink-planner.test.ts`), tag parsing F6.1/F6.2, invalid YAML F7.2.

## Results (build container, Linux, Node 22.22, 2 vCPU)
| Command | Result |
|---|---|
| `npm test` | 87 files, 834 passed, 3 skipped (2 Windows-only, 1 needs `SB_GEN_VAULT`) |
| `TZ=America/New_York npx vitest run --project server server/test/index server/test/markdown` | 28 files, 250 passed |
| `npm run lint` | exit 0 (ESLint `--max-warnings=0`, raw colors, i18n parity, contrast 90/90) |
| `npm run typecheck` | exit 0 |
| `npx prettier --check .` | clean |
| `npm run test:e2e` | build + 3/3 Playwright tests |
| Built server, manual | fresh home → exact vault layout; sample data → Today shows urgent/soon/ok + 1 overdue + project 3/5; Notepad-style edit found by `phuong trinh vi phan` in < 1 s; rename "Giải tích 1" relinks 2 notes incl. `course:` front matter; graceful shutdown |

## Performance (SPEC §5) – `npm run bench:index` on the generated 5k vault
Vault: 5,000 notes, 51.1 MB, 20,000 links, 3,000 tasks. Machine: build container (Xeon 2.8 GHz, 2 cores, 8 GB, Node 22). The owner's laptop (Core Ultra 5 125U) is the reference machine; numbers there come with the M4 Windows run.

| Metric | Measured | Budget |
|---|---:|---:|
| Cold full reindex | 9.2 s | 15 s |
| Warm open (index exists, reconcile) | 0.33 s | – |
| Incremental update of one file, p95 | 17 ms | 100 ms |
| Open note, service path p95 / API p95 | 1.7 ms / 4.2 ms | 150 ms |
| Search, server query p95 (service / API) | 26 ms / 30 ms | 50 ms |
| Today, service p95 / API p95 | 26 ms / 76 ms | 200 ms |
| Outside edit → WS event, p95 | 189 ms | 1 s |
| Tree API, p95 | 292 ms | – |
Parsing alone: 1.5–1.9 s for the 5k vault (full remark parse: ~45 s); a 2 MB single-paragraph note parses in ~0.3 s. Index file ≈ 2.8× the vault text size.

## Independent review
Two separate agents reviewed M1 read-only (data safety/security; parsing/index/deadline correctness), verifying each suspicion with scratch scripts. All confirmed findings were fixed with regression tests before closing: non-UTF-8 notes re-encoded by relink/save, interrupted case-only rename able to clobber a new file, boot failing on housekeeping, long names unwritable, `..`-prefixed names treated as outside, unmapped state-write errors, error swallowing in `readIfFile`, links left resolved to notes deleted during a rebuild, relink silently retargeting other links (rename into an existing title, moved note's own links), YAML quoting broken by relink, dead links for titles with `#`/brackets, `đ`/`d` conflated in link identity, quadratic parsing of long paragraphs, date tokens read from inline code, tags inside wikilinks, slow fallback for footnotes/reference links, plus the plausible risks (vault overlapping the install, no-clobber create, realpath fallback, symlink writes, journal JSON validation, error logs without messages). Reports: `plans/2026-10-18-m1-vault-index/reports/`.

## Manual checks still to do on Windows (owner)
1. Double-click `D:\SECONDBRAIN\Mở Second Brain.cmd` → the first start after this update reinstalls libraries and rebuilds (a few minutes); the app opens as before and `D:\SECONDBRAIN\vault\` now exists with the standard folders (`0 Inbox` … `Attachments`, `wiki\…`), `Templates\` (8 files) and `CLAUDE.md`.
2. Open `D:\SECONDBRAIN\vault\0 Inbox`, create a `.md` file with Notepad, then check `http://localhost:4747/api/health` still answers (the UI for notes arrives in M2/M3).

## Known gaps
- Windows-only behaviour (junctions, case-variant canonical paths, rename retries under antivirus) is covered by tests that skip on Linux; it gets exercised on the owner's machine in the M4 Windows run.
- Markdown links `[x](y.md)` are not rewritten on rename/move (SPEC limitation), including a moved note's own relative links. A link that was ambiguous before a rename and becomes unique afterwards starts resolving (not pinned).
- A relinked rename logs a transient ghost `link_added`/`link_removed` pair per affected note in `events.jsonl` (same millisecond).
- Obsidian `%%comments%%` and `$math$` are not excluded from link/tag scanning (SPEC excludes code and HTML only).
- No-clobber create falls back to check-then-rename on file systems without hard links (FAT/exFAT).
- `GET /tree` reads the disk (~0.3 s on 5k notes); fine for M2, revisit if the sidebar feels slow.
- Reference machine RAM/disk still to be filled in `MILESTONE-0.md` by the owner.
