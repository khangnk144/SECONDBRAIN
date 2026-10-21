# Milestone 3 – Today, tasks, calendar, search, capture, daily notes, brain graph, shortcuts

Date: 2026-10-20 · SPEC v1.1 §12 row M3 · Plan: `plans/2026-10-19-m3-today-calendar-graph/plan.md` (+ phase briefs, `reports/`)

## What was built
- **Today** (`web/src/features/today/`): greeting by time and name, one summary sentence (overdue, this week, today – no double counting), the 14-day strip over 60 days (overdue cell, dots coloured by the most urgent item with text, today ring, up to 2 wrapped labels + "+n", tooltip, popover with tick and open, roving keyboard focus, 7 or 14 days by available width, the line drawn once in 400 ms), "Hôm nay" (ticks update the summary at once, ticked rows stay dimmed for the visit, at most 5 overdue then a link to the tasks view), inline "Ghi nhanh", "Đồ án đang làm" cards (percent bar or "chưa có việc", "Đánh dấu dự án xong?" once), the opt-in sample-data card, the offline banner in place of the summary.
- **Việc cần làm** (`features/tasks/`): Quá hạn / Hôm nay / 7 ngày tới / Sau / Không có hạn, "Bao gồm Archive", ticked rows kept for the visit.
- **Lịch** (`features/calendar/`): month grid (Mon–Sun, 3 items then "+n", done struck through), day pane with items and the day's daily note ("Viết" / "Mở ghi chú ngày"), rescheduling by drag or "Dời ngày…" (date picker) with a 10 s journal undo, full keyboard operation, URL state.
- **Bản đồ não** (`features/graph/`): d3-force on canvas, colours from the graph tokens, hollow source nodes, dimmed orphans and archived notes, intro and slow drift (off under reduced motion), hover labels, click signal to depth 1 then 2, double-click opens, zoom/pan, keyboard side panel (search, neighbours, open), legend, local graph in the note's right pane.
- **Search & commands** (`features/search/`, `lib/commands/`): `>` command mode from one registry gated by implemented features, ranked matching, filter value suggestions, recently opened notes for the empty query, keystroke-to-results measure.
- **Ghi nhanh overlay** (`features/capture/`, `Alt+Q` anywhere), **daily notes** (`Alt+T`, navigation row with nearest day or "Tạo ngày …", caret at `{{cursor}}`), **shortcut sheet** (`Ctrl+/`, generated from the registries).
- **Word-like formatting toolbar** (owner request, `web/src/editor/formatting/`): fixed at the top of the note, Word shortcuts (`Ctrl+B/I/U`, `Ctrl+Alt+0–3`, `Ctrl+Shift+7/8/9`…), visible hints, "Thêm" menu when narrow; **underline stored as `<u>…</u>`** (a supported construct of the converter; other inline HTML stays verbatim).
- **Server** (`server/src/`): revisions on deadline items, `PATCH /note/task` (paragraph-aware line patch, byte-identical to the editor's tick), journaled `POST /note/reschedule`, `POST /capture`, daily routes, template variables in the UI language with `cursor`, `GET /graph`, `GET /graph/local`, index schema 5.
- **Shared web layer** (`lib/`, `features/deadline-items/`): API mirrors, live queries with day rollover, deadline actions with own-write revision tracking, shared item row, date picker dialog, flows and stores, recently opened notes, new shortcuts and routes (immersive graph).

## Acceptance criteria assigned to M3

| AC | Verification |
|---|---|
| F8.1 search ≤ 50 ms server p95; ≤ 200 ms keystroke-to-results after the debounce | `scripts/bench-index.ts` (search p95 30 ms on the 5k vault); e2e `performance-5k.spec.ts` "palette keystroke-to-results on 5k notes (F8.1)" (p95 84 ms after the 120 ms debounce, headless) |
| F8.3 `tag:đồ-án due:7d` only matching user notes/tasks; archive only with `class:archive` | e2e `keyboard-palette-capture.spec.ts` (2 of 6 candidates; `class:archive` adds the archived one); `features/search/palette-filters-recents.test.tsx`, `palette-query.test.ts`; server search tests (M1) |
| F8.4 every registered command works, keyboard reachable, none references an unimplemented feature | `lib/commands/command-registry.test.ts`, `features/search/palette-commands.test.tsx`, `command-matching.test.ts`; e2e `keyboard-palette-capture.spec.ts` (`>lịch`) |
| F9.1 a tick from editor, Today or tasks view patches exactly that line; 409 when the file changed, the UI refreshes and asks again | server `markdown/task-line-patch.test.ts` (line diffs, paragraph rendering unchanged), `api/note-task-api.test.ts` (stale revision, changed line → 409); `editor/extensions/task-tick-server-parity.test.ts` (editor tick = server tick, 53 rows); web `deadline-items/deadline-actions.test.ts`, `own-write-revisions.test.ts`, `deadline-item-row.test.tsx`; e2e `today.spec.ts` (only that line changes) |
| F9.2 identical task lines tick independently | server `task-line-patch.test.ts`, `api/note-task-api.test.ts` "(F9.1, F9.2, F10.4)", `parse-note-tags-tasks.test.ts` |
| F10.1 greeting for the five ranges | `lib/greeting.test.ts`, `features/today/today-screen.test.tsx` "(F10.1)" |
| F10.2 dense fixture at 360/720 px and 18 px: no overlap, "+n", overdue cell, popover lists all, sections stay aligned | e2e `dense-today.spec.ts` (bounding boxes at 360/720 × 16/18 px, popovers list 10/30, sections keep their place while loading); `features/today/today-strip.test.tsx`, `today-model.test.ts` |
| F10.3 keyboard only: Tab to strip, arrows, Enter popover, tick/open by keyboard | e2e `keyboard-today-calendar.spec.ts` (incl. the focus regression); `today-screen.test.tsx` "(F10.3)", `deadline-item-row.test.tsx` |
| F10.4 tick from Today patches the file, summary updates immediately | `today-screen.test.tsx` / `today-model.test.ts` "(F10.4)"; server `api/note-task-api.test.ts`; e2e `today.spec.ts` |
| F10.5 progress = done/total; 0 tasks → "chưa có việc" | `features/today/projects-section.test.tsx` "(F10.5)"; e2e `today.spec.ts` (3/5 = 60 %) |
| F10.6 Today API ≤ 200 ms p95 on the 5k vault | `scripts/bench-index.ts` (`GET /today` p95 56 ms); e2e `performance-5k.spec.ts` (85 ms from the browser) |
| F11.1 calendar items = deadline service for the month (done, archived) | `features/calendar/calendar-screen.test.tsx`, `calendar-month-model.test.ts`, `calendar-day-panel.test.tsx`; server `api/deadline-views-api.test.ts` "(F9.4, F14.3)" |
| F11.2 reschedule by drag or picker rewrites only the date, revision-checked, undo | server `api/reschedule-api.test.ts` (diff, journal, undo, undo after edit, interrupted run), `task-line-patch.test.ts` "(F11.2)"; web `calendar-reschedule.test.tsx`, `deadline-actions.test.ts`; e2e `course-project.spec.ts` (drag and "Dời ngày…" change only the date, "Hoàn tác" restores the bytes) |
| F11.3 fully keyboard-operable incl. rescheduling through the date picker | e2e `keyboard-today-calendar.spec.ts` "(F11.3)"; `calendar-keyboard.test.tsx`, `features/dialogs/pick-date-dialog.test.tsx` |
| F12.1 Alt+Q from any screen, ≤ 2 interactions, focus returns | e2e `keyboard-palette-capture.spec.ts` (Today, editor with caret mid-text, calendar); `features/capture/capture-overlay.test.tsx`, `lib/capture-daily-flows.test.ts` |
| F12.2 sanitized, unique, Vietnamese kept | server `api/capture-api.test.ts` "quick capture file names (F12.2)" (reserved names, separators, format characters, graphemes) |
| F12.3 Inbox badge within 1 s | e2e `today.spec.ts` (badge 2 → 3 in ≈ 400 ms); server `capture-api.test.ts` |
| F13.1 Alt+T creates once, second press only opens, GET for a missing date never creates | server `api/daily-notes-api.test.ts`; `lib/capture-daily-flows.test.ts`; e2e `keyboard-daily-graph.spec.ts` (404 twice and nothing created; second Alt+T leaves bytes and mtime) |
| F13.2 variables in the UI language | server `templates/template-variables.test.ts` "(F13.2, F14.2)" (vi and en) |
| F13.3 prev/next to the nearest existing daily note or offer to create | `features/daily/daily-nav-row.test.tsx`; e2e `keyboard-daily-graph.spec.ts` |
| F14.2 template variables substituted, caret at `{{cursor}}` | server `template-variables.test.ts`; `editor/markdown/source-offset-caret.test.ts` (all bundled templates, emoji, CRLF/BOM), `features/note/note-screen-cursor.test.tsx`, `lib/note-route-cursor.test.ts`; e2e `course-project.spec.ts` |
| F14.3 template tasks never on Today/Tasks/Calendar | server `api/deadline-views-api.test.ts` "(F9.4, F14.3)", `index/deadline-content-classes.test.ts` |
| F16.1 layout ≤ 3 s for 3,000 nodes / 6,000 edges; ≥ 30 fps | `features/graph/graph-layout.test.ts` "(F16.1)"; e2e `performance-graph-3k.spec.ts` (2.1–2.3 s, 37–56 fps headless with software rendering); reference-machine fps: manual (below) |
| F16.2 colours and legend from the tokens; orphans 50 %; sources hollow | `graph-model.test.ts`, `graph-palette.test.tsx`; server `api/graph-api.test.ts` |
| F16.3 hover label within a frame; click → exactly depth 1; double-click opens | `graph-selection.test.ts`, `graph-view.test.ts`; e2e `graph.spec.ts` |
| F16.4 keyboard only: find, read neighbours, open | `graph-side-panel.test.tsx`, `graph-screen.test.tsx`; e2e `keyboard-daily-graph.spec.ts` |
| F16.5 reduced motion: no intro, no drift, highlights work | `graph-view.test.ts`, `graph-screen.test.tsx`; e2e `graph.spec.ts` (pixel hash stable over 1 s) |
| F16.6 local graph shows the correct depth-1 neighbours | `local-graph-section.test.tsx`; server `api/graph-api.test.ts` "(F16.2, F16.6)" |
| F22.1 each shortcut works in the tab, not while an overlay input expects typing (except Esc) | e2e `shortcut-matrix.spec.ts` (matrix below); `lib/shortcuts/shortcut-registry.test.ts`. Installed-PWA column: manual on Windows with M4 (the PWA is built in M4) |
| F22.2 sheet generated from the registry, exactly the implemented shortcuts | `features/shortcut-sheet/shortcut-sheet.test.tsx`; e2e `shortcut-matrix.spec.ts` "(F22.2)" |
| F7.3 (UI half from M2) a new `deadline` on the strip and calendar within 1 s | e2e `course-project.spec.ts` (strip 165–227 ms, calendar 227–260 ms) |

DoD: **S1** – e2e `today.spec.ts` (sample-data prompt → greeting, strip, today's tasks, capture, projects; tick changes one line and the summary; capture lands in Inbox). **S2 except notifications** – e2e `course-project.spec.ts`. **Dense data** – `dense-today.spec.ts`. **Keyboard only** – `keyboard-*.spec.ts` (Today, calendar, palette, capture, daily, graph, toolbar). **Shortcut matrix** – recorded below.

### Shortcut matrix (browser tab; PWA column is checked on Windows in M4)
| Key | Action | Fires in tab | Blocked while typing in capture / palette input |
|---|---|---|---|
| Alt+1 / Alt+2 | left / right pane | ✓ | ✓ |
| Alt+N | new note | ✓ | ✓ |
| Alt+T | today's daily note | ✓ | ✓ |
| Alt+Q | quick capture (also inside the editor) | ✓ | ✓ |
| Alt+G | brain map | ✓ | ✓ |
| Alt+W / Alt+[ / Alt+] | close / previous / next tab | ✓ | ✓ |
| Ctrl+K | search and commands | ✓ | ✓ (the browser default is also blocked) |
| Ctrl+/ | shortcut sheet | ✓ | ✓ |
| Alt+S | source mode (on a note) | ✓ | ✓ |
| Esc | close overlay | ✓ | closes |
| Editor: Ctrl+B/I/U, Ctrl+Alt+0–3, Ctrl+Shift+7/8/9, Ctrl+Shift+S/B, Ctrl+E, Ctrl+Alt+C, Ctrl+\, Ctrl+Z/Y | formatting toolbar commands | ✓ (default prevented, Chromium) | – |

## Results (build container, Linux, Node 22.22, 2 vCPU Xeon 2.1 GHz, 8 GB)
| Command | Result |
|---|---|
| `npx vitest run` | 248 files, 3,360 passed, 3 skipped (Windows-only / generated-vault) |
| `npm run lint` | exit 0 (ESLint, raw colors, i18n parity, contrast 90/90) |
| `npm run typecheck` | exit 0 |
| `npx prettier --check .` | clean |
| `npx playwright test --repeat-each=2` | 64 passed, 8 skipped (opt-in performance specs), 0 flaky |
| `SB_PERF=1 npx playwright test web/e2e/performance-*.spec.ts` | 4 passed (numbers below) |

### Performance (5k generated vault: 5,000 notes, 51 MB, 20,000 links, 3,000 tasks; quiet machine)
| Metric | Measured | Budget |
|---|---:|---:|
| Cold full index | 8.4 s | 15 s |
| Incremental update p95 | 17 ms | 100 ms |
| Search server query p95 (F8.1) | 23 ms | 50 ms |
| Palette keystroke → results p95, after the 120 ms debounce (F8.1, headless) | 69 ms | 200 ms |
| `GET /api/today` p95 (F10.6) | 36 ms (81 ms from the browser) | 200 ms |
| Today route render (headless, software rendering) | p50 265 ms, p95 617 ms | 300 ms (soft) |
| `GET /api/graph` p95 (4,956 nodes / 20,797 edges) | 151 ms | 300 ms |
| Graph 2,912 nodes / 5,804 edges: response → drawn, fps (F16.1) | 1.8 s, 43–49 fps | 3 s, ≥ 30 fps |
| Graph 5k (4,956 / 20,699, larger than the SPEC size) | 3.2 s, 21–24 fps | – |
Unit-level F16.1: 3,000/6,000 layout in Vitest stays under 3 s (2.5 s budget then live settling). The reference-machine fps is a manual check below.

## Independent review
Two read-only reviewers. **A – data safety** (no Critical; 1 High, 2 Medium, 7 Low): a tick from a view could change how a task paragraph renders (hard-break detection inside quotes/HTML/ordered lines); the own-write revision chain broke after an undo returned a file to an old revision; the `{{cursor}}` caret was off after emoji; editor and server ticks differed on unusual ✅ tokens; reschedule could edit a 📅 inside a wikilink; capture names kept invisible/bidi characters; a non-UTF-8 template was copied with U+FFFD; a symlinked Daily template blocked Alt+T; a second drag before the reload conflicted falsely – all fixed with regression tests (L4 "untick writes doing" accepted and documented). **B – UI/spec/accessibility** (no High, 5 Medium, 16 Low): unreadable strip labels, cramped deadline rows, a half-transparent tooltip, wrong palette command on an exact name, ticked tasks vanishing from the tasks view, plus double-counted summary, long overdue lists, shortcut-sheet gaps, graph label overlap and large glows, toolbar hints only as `title`, weekday casing – all fixed. The e2e run found a strip focus loss (fixed) and three small races (fixed). Reports: `plans/2026-10-19-m3-today-calendar-graph/reports/review-a-data-safety.md`, `review-b-ui-spec.md`, `x-e2e-report.md`, fix reports `fs-*`, `fe-*`, `i-*`, `u1-*`, `u2-*`.

## Manual checks for the owner (Windows)
1. Close the running app, double-click `D:\SECONDBRAIN\Mở Second Brain.cmd` (the first start after this update rebuilds the app; the index rebuilds once for schema 5).
2. Today: the greeting, the summary, the 14-day strip (hover a dot, press Enter on a day), tick a task (it stays dimmed; untick works), type in "Ghi nhanh" + Enter, watch the Inbox count.
3. `Alt+Q` from a note, type, Enter: the caret returns where it was. `Alt+T`: today's daily note, "Ngày trước"/"Ngày sau". `Ctrl+K` then `>`: commands. `Ctrl+/`: the shortcut sheet.
4. Calendar: drag a task to another day, then "Hoàn tác"; open a day and use "Dời ngày…" with the keyboard only.
5. Brain map (`Alt+G`): names of the big notes, hover, click (signal to neighbours), double-click opens; the local graph in a note's right pane. Please note how smooth it feels (the 30 fps target on your laptop).
6. Formatting toolbar: Ctrl+B / Ctrl+I / Ctrl+U, Ctrl+Alt+1, Ctrl+Shift+8; hover a button for its hint; check in a normal Chrome/Edge window that Ctrl+U does not open "view source" and Ctrl+Shift+B does not toggle the bookmarks bar.
7. Still pending from M0: add the laptop's RAM and disk type to `MILESTONE-0.md`.

## Known gaps
- Today render p95 617 ms on the 5k generated vault in headless Chromium with software rendering (p50 265 ms; budget 300 ms soft) – re-measure on the reference machine; the generated vault is much denser than a real one.
- The installed-PWA column of the shortcut matrix and the reference-machine graph fps are manual Windows checks (the PWA itself arrives in M4).
- Graph filters, time scrubber, "não hôm nay" and AI concepts are Phase 2/3 (F24, F34). Concepts will appear as wiki pages (one dot each) once the MCP ingest exists (M6).
- Calendar has no week view (SPEC F11 is month only). No touch drag in the calendar (the item menu is the touch path).
- Unticking a note-deadline item always writes `status: doing`. Ticking a task from a view in a 2 MB note takes ~0.5 s (typical notes 15–35 ms).
- Underline content that starts with a line break has no exact Markdown form (saved canonically, nothing dropped).
- `graph-view.ts`, `deadline-actions.ts`, `today-strip.tsx` and `scripts/bench-index.ts` are a little over the ~200-line guideline.
