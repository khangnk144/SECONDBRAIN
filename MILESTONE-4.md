# Milestone 4 – Reminders, settings, attachments + PDF viewer, git history, launcher + PWA (v1.0 candidate)

Date: 2026-10-21 · SPEC v1.1 §12 row M4 · Plan: `plans/2026-10-21-m4-v1-release/plan.md` (+ phase briefs, `reports/`)

## What was built
- **Reminders** (`server/src/reminders/`, `web/src/features/reminders/`): a per-vault server scheduler reminds every open deadline item 3 days, 1 day and on the due day at the configured time (default 08:00), catches up once after sleep or a restart, shows one summary toast for a burst, never repeats (dedupe store written before the toast, never overwritten when unreadable). Windows toast through PowerShell with a node-notifier fallback, deep link to the note. In the app: "Nhắc nhở" screen and sidebar badge, and one Web Notification across open windows when the Windows toast was not shown.
- **Settings** (`/settings`, `Alt+,`; `server/src/config/`, `server/src/system/`, `web/src/features/settings/`): name, language, theme, palette and font size applied live (and in other windows); reminder time; vault switch in process (previous vault reopened on any failure, stale windows refused with `x-sb-vault-id`); rebuild with progress; backup export and "Khôi phục thử…" restore; template restore; sample-data delete; log folder; run at login (Startup shortcut); port; install app; quit; AI keys stored and shown only as `…last4`; honest Phase 3 copy for AI and MCP.
- **Attachments and documents** (`server/src/attachments/`, `web/src/editor/attachments/`, `features/{viewer,resources}/`): drop or paste files into a note or source mode, vault-wide unique names, images under `Attachments/<YYYY-MM>/`, documents under `3 Resources/<papers|slides|other>/` with a remembered chooser; inline images and file cards; the "Tài liệu" view with the notes that mention each file; a pdf.js viewer tab under the strict CSP (no eval, no WebAssembly); every other file only downloads or opens with the OS app.
- **Version history** (`server/src/git/`, `features/history/`): git in the vault with `.git/info/exclude` and byte-exact `.git/info/attributes`, repo-local identity only when none is set, auto-commit every 10 minutes and on shutdown, stale lock removal; "Lịch sử phiên bản" dialog with a diff and a revision-checked restore that first commits what it replaces; "Lịch sử cần Git…" when git is missing.
- **Backup** (`server/src/backup/`): consistent zip (built under the write queue), no secrets, restore with zip-slip guards into a new folder as a separate vault (own id, reminder history kept).
- **PWA and launcher** (`web/src/pwa/`, `web/vite-plugin-service-worker.ts`, `launcher/`): manifest and icons, shell-only service worker (offline shell with the backend banner, update toast), install button; launcher `login` action and `start-hidden.vbs`, port-busy dialog naming the process, the installed app brought to the front on a second launch, `launcher.log`.
- **i18n**: Vietnamese and English complete; a live language switch updates every visible string (toasts already on screen too).
- **Recovery**: a window opened before the server (installed app at login) recovers in place once the server is up.

## Acceptance criteria assigned to M4

| AC | Verification |
|---|---|
| F15.1 drop keeps the name or adds ` 2`, working `[[bài giảng 3.pdf]]`; two `image.png` in different months get distinct names and links | server `attachments/attachments-api.test.ts` "POST /api/attachments (F15.1)" (mocked months, NFD, case-only clashes), `attachment-file-name.test.ts`, `attachment-limits-api.test.ts`; web `editor/attachments/editor-attachment-upload.test.tsx`, `attachment-link-insert.test.ts`, `features/note/note-screen-attachments.test.tsx`, `source-mode-uploads.test.tsx`; e2e `attachments.spec.ts` "S3b …" |
| F15.2 images inline; missing file placeholder naming it; SVG only via `<img>` | web `editor/extensions/embed-rendering.test.tsx` "(F15.2, F15.3)", `lib/vault-file-blob.test.ts`; e2e `attachments.spec.ts` (blob URLs, "a missing image shows a placeholder naming the file; the note is never rewritten") |
| F15.3 PDF viewer in-app; HTML offered as download, never rendered in the app origin (header test) | server `attachments/files-and-resources-api.test.ts` "GET /api/files (F15.3)"; web `features/viewer/pdf-viewer.test.tsx`, `pdf-viewer-logic.test.ts`, `open-vault-file-in-app.test.ts` "(F15.3)"; e2e `attachments.spec.ts` (page drawn, next page, zoom, Alt+W; HTML link only downloads with `content-disposition: attachment`) |
| F15.4 files only from inside the vault (path guard on `/files`) | server `api/path-guard-through-api.test.ts` (rows for `/files`, `download=1`, open-external, history, attachments; junctions/symlinks), `api/settings-secrets-security.test.ts` |
| F17.1 thresholds at the configured time once per key; reschedule fires again; completing suppresses | server `reminders/reminder-scheduler.test.ts` "(F17.1)", `reminder-plan.test.ts`, `reminder-content-classes.test.ts` "(F17.1, F9.4)", `api/reminders-api.test.ts` |
| F17.2 sleep over 08:00 → one catch-up; never duplicated across restarts | server `reminders/reminder-catch-up.test.ts` "(F17.2)", `reminder-store-unreadable.test.ts`, `backup/backup-restore-vault-identity.test.ts` (a restored copy keeps its reminder history); e2e `settings-vault.spec.ts` "a restored copy does not remind again …" |
| F17.3 real toast with the window closed, click opens the note | **manual on Windows** (owner step 3 below); toast builder/fallback: `reminders/windows-toast.test.ts`, `toast-script.test.ts`; in-app part: web `features/reminders/reminder-notifications.test.ts` "(F17.3)"; e2e `reminders.spec.ts` "S2 …" (listed, badge, one Web Notification, dismissed) |
| F17.4 permission denied → no errors, in-app list still shows it | web `features/reminders/reminders-screen.test.tsx` "(F17.3, F17.4)" |
| F18.1 theme, palette, font size, language, name apply immediately without reload | web `features/settings/settings-screen.test.tsx` "(F18.1)"; server `api/settings-api.test.ts`; e2e `settings.spec.ts` "appearance, name and language apply without reload and persist" |
| F18.2 API keys only `…last4`; settings file not readable from `/files` | server `api/settings-secrets-security.test.ts` "(F18.2)", `api/settings-api.test.ts`; e2e `settings.spec.ts` "an API key is only ever shown as …last4" (every response body scanned) |
| F18.3 vault A → B → A with same-path notes and a draft; inaccessible folder fails and keeps A | server `api/vault-switch-api.test.ts` "(F18.3)", `vault-switch-journal.test.ts`, `vault-switch-overlap.test.ts`; web `features/settings/vault-reload.test.ts`, `vault-section.test.tsx`; e2e `settings-vault.spec.ts` "switching vault A → B → A …" |
| F18.4 rebuild during edits: progress, edits present after, searches served by the old index | server `index/index-rebuild.test.ts` (M1); web `vault-section.test.tsx` "(F18.4)"; e2e `settings.spec.ts` "rebuilding the index shows progress …" |
| F18.5 backup export → restore into a new folder → notes, attachments, links, reminders state, trash intact; no secrets | server `backup/backup-export-restore.test.ts` "(F18.5)", `backup-export-consistency.test.ts`, `backup-restore-safety.test.ts`, `backup-restore-vault-identity.test.ts`; e2e `settings-vault.spec.ts` "backup export → \"Khôi phục thử…\" …" |
| F18.6 run at login creates/removes the Startup shortcut (on disk) | server `system/run-at-login.test.ts` "(F18.6)" (temp Startup folder, quoting of the PowerShell text); **real `.lnk` on Windows: owner step 9** |
| F19.2 S1 and S3a in both languages; a switch updates every visible string without reload | e2e `languages.spec.ts`; web `app/app-language-switch.test.tsx`, `i18n/retranslate-text.test.ts`; lint parity + literal-string rule (F19.1, M0) |
| F20.3 auto commit after 10 minutes; restoring a version writes the old content and re-indexes; works without git or identity | server `git/history-plugin.test.ts`, `history-api.test.ts`, `history-versions.test.ts`, `history-locks-and-close.test.ts`, `history-byte-exact.test.ts`, `history-restore-keeps-latest.test.ts`, `shutdown-closes-plugins.test.ts`; web `features/history/history-dialog.test.tsx`; e2e `history.spec.ts`, `round-trip.spec.ts` |
| F21.1 launcher after a reboot opens within 5 s; second double-click focuses; `stop` ends it | **manual on Windows** (owner steps 1, 2); launcher static checks `scripts/launcher-files.test.ts`; PowerShell 7 smoke run on Linux (start twice → one server, login silent, stop graceful, concurrent login + start → one server) in `reports/pl-pwa-launcher-report.md` |
| F21.2 with run at login, the installed app opens with data after a reboot | **manual on Windows** (owner step 9); recovery when opened before the server: web `app/offline-boot-recovery.test.tsx`, e2e `pwa.spec.ts` |
| F21.3 PWA checklist | automated: manifest valid and linked, worker registered and controlling, offline shell + backend banner, reconnect in place, shell update toast – e2e `pwa.spec.ts`; web `pwa/*.test.ts(x)`; server `shell/pwa-static-files.test.ts`. **Manual:** install prompt in Chrome/Edge, installed window without browser chrome (owner steps 4–6) |
| F21.4 port in use → clear dialog; port change consistent | launcher port-busy dialog (smoke-run on Linux, **manual on Windows**: owner step 10); server `api/settings-api.test.ts` (configured vs running port, `restartRequired`); Settings hint to reinstall the app after a port change |
| F22.1 (PWA column carried from M3) | **manual on Windows** (owner step 6); browser-tab column: e2e `shortcut-matrix.spec.ts` (now with `Alt+,`) |

DoD: **S2 fully** – e2e `reminders.spec.ts` + M3 `course-project.spec.ts`; the real toast is owner step 3. **S3b** – e2e `attachments.spec.ts`. **S6 round trip of trust** – e2e `round-trip.spec.ts` (write, attach, deadline, tick, server killed mid-typing, restart: every word back; graceful stop: git snapshot); after a real reboot: owner step 11. **PWA checklist** – above. **Phase 1 complete → tag `v1.0`** once the owner's Windows checks below pass.

## Results (build container, Linux, Node 22.22, 2 vCPU, 8 GB)
| Command | Result |
|---|---|
| `npx vitest run` | 319 files, 3,840 passed, 3 skipped (Windows-only / generated-vault) |
| `npm run lint` | exit 0 (ESLint, raw colors, i18n parity, contrast 96/96) |
| `npm run typecheck` | exit 0 |
| `npx prettier --check .` | clean |
| `npx playwright test` | 45 passed, 4 skipped (opt-in performance specs); the 8 new spec files also passed with `--repeat-each=2`. One M2 spec read a relinked note before the undo had restored it (under load); it now waits for it. |
| `GET /api/resources` on the 5k vault + 800 files | p50 101 ms, p95 154 ms (budget 200 ms) |
| PDF viewer, 200-page PDF (headless Chromium) | opens in 1.2 s, End → page 200 in 0.19 s |

## Independent review
Two read-only reviewers. **A – data safety and security** (3 High, 2 Medium, 2 Low): a restored copy kept the source vault id so the stale-window guard let a save land in the copy; a note renamed during a backup export vanished from the zip without warning; a history restore could lose text saved since the last snapshot; a transient read error of `reminders.json` reset the dedupe store; switching to a folder inside the open vault scaffolded a vault in the user's notes; macro-enabled Office files could be opened with the OS – all fixed with regression tests that failed before; SVG blobs are never navigated to (rule). Verified fine: byte-exact git restore, git hardening, zip-slip guards, no secrets in responses/logs/backups, token/Origin/Host on every new route. **B – UI/spec/accessibility in a real browser** (1 High, 4 Medium, 11 Low): a window opened before the server never recovered; focus lost after cancelling confirms and dismissing reminders; "Bỏ qua tất cả" without a confirm; `--ink-2` on `--accent-soft` below 4.5:1; viewer keys missing from the shortcut sheet; English plurals, copy, native file picker, offline reminder time, toasts, hit areas, 360 px badge, port hint order – all fixed. The e2e run found a restored copy re-reminding (fixed) and a race in an M3 spec (test fixed). Reports: `plans/2026-10-21-m4-v1-release/reports/review-a-data-safety.md`, `review-b-ui-spec.md`, `x-e2e-report.md`, fix reports `fs-server-fixes-report.md`, `fu-ui-fixes-report.md`.

## Manual checks for the owner (Windows)
1. Close the running app (`D:\SECONDBRAIN\Mở Second Brain.cmd stop` or close the browser and run `stop`), then double-click `Mở Second Brain.cmd`. The first start after this update installs a few libraries and rebuilds (a few minutes). The app opens with your notes. Double-click again: no second server starts.
2. `Mở Second Brain.cmd stop` ends the server.
3. **Reminder toast (F17.3):** make a note with `deadline:` 3 days from today (or a task `📅` 3 days ahead), set Settings → Nhắc nhở → time to 2 minutes from now, **close the app window**, wait: a Windows notification appears; click it → the note opens. It is listed under "Nhắc nhở".
4. **Install the app:** in Chrome or Edge open `http://localhost:4747` → Settings → "Cài đặt app" → the browser's install dialog appears → install.
5. Open "Second Brain" from the Start menu: own window, no address bar or tabs, dark title bar, app icon.
6. In that window try the shortcuts: Alt+N, Alt+T, Alt+Q, Alt+G, Alt+1/Alt+2, Alt+W, Alt+[ / Alt+], Alt+, , Ctrl+K, Ctrl+/, Esc, F2 (tell me any that the window takes for itself).
7. With the installed app open, double-click the launcher: the same window comes to the front.
8. `stop`, then open the installed app: it still opens and shows "Chưa kết nối với máy chủ…"; start the launcher: within a few seconds your notes appear without reloading. Try once with Wi-Fi off too.
9. **Run at login (F18.6, F21.2):** Settings → turn on "Chạy khi đăng nhập Windows" (check that `Second Brain.lnk` appears in `shell:startup`), restart the computer, do not run the launcher, open the installed app: your notes are there.
10. **Port busy (F21.4):** `stop`, then in PowerShell `python -m http.server 4747 --bind 127.0.0.1` (or any program on port 4747), double-click the launcher: a message names the program on the port. Close it and start again.
11. **S6 after a reboot:** write a note, drop a PDF into it, set a deadline, tick a task, see them on Today and in Lịch, close everything, restart the computer, open the app: everything is there, including the last words typed.
12. Files: in "Tài liệu", "Mở bằng ứng dụng khác" opens a PDF/DOCX in its default app; "Hiện trong thư mục" and Settings → "Mở thư mục log" open Explorer; the PDF viewer draws pages in your Chrome/Edge.
13. Vault switch and restore with a `D:\…` path that has spaces and Vietnamese letters (e.g. "Khôi phục thử…" into `D:\Sao lưu\Thử khôi phục`).
14. Still pending from M0: add the laptop's RAM and disk type to `MILESTONE-0.md`.

## Known gaps
- Windows-only behaviour (real toast and click, `.lnk` creation, Explorer and default-app opening, message boxes, installed-PWA window, shortcut matrix in that window, reboot flows) is verified by tests and a PowerShell 7 smoke run on Linux, not yet on Windows – the owner steps above.
- Toasts come from Windows PowerShell's AppUserModelID (the notification may name "Windows PowerShell" as its sender); a registered app id comes with the `.exe` in Phase 2 (F29).
- The browser notification is shown only when the Windows toast was not shown (one alert per reminder).
- Attachments are part of the git history, so the repository grows with them; a size cap may come later.
- A backup export makes saves wait until the zip is built (about a minute on a multi-GB vault) and needs free space for the zip; no ZIP64, so exports above 4 GB or 65,000 entries are refused.
- pdf.js runs from its legacy build; PDFs without embedded fonts use system fonts (CJK may look off); standard fonts/CMaps are not bundled.
- An installed app belongs to its port: after a port change it must be installed again.
- Web Notifications could not be clicked in headless e2e (spied only); images "in different months" are covered by server tests with a mocked clock, not e2e.
