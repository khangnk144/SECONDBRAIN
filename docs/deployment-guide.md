# Deployment Guide (local, Windows)

The app runs only on the owner's Windows laptop. "Deployment" means: start it reliably, stop it, and (from M4) install it as a desktop app. From M5 it can also run as one file, `Second Brain.exe`, with a tray icon (see "Single executable" below).

## Requirements (install once)
- **Node.js 24 LTS** from https://nodejs.org (the app needs ≥ 22.12). Check in PowerShell: `node -v` → `v24…`. Needed to run from source and to **build** the exe; the exe itself runs without Node (it carries the Node it was built with).
- **Git for Windows** from https://git-scm.com/download/win (note history and the optional GitHub push; Git Bash for agent hooks).
- Windows PowerShell 5.1 (part of Windows) runs the tray icon, the toasts and the message boxes.

## Start and stop
- **Start:** double-click `D:\SECONDBRAIN\Mở Second Brain.cmd`.
  It checks Node, runs `npm install` when dependencies are missing or the lockfile changed, runs `npm run build` when the build is missing or older than the sources, starts the server **hidden** (no console window to close by accident), waits for `http://127.0.0.1:4747/api/health`, then opens `http://localhost:4747/` in the default browser. Double-clicking again while it runs only opens the app; it never starts a second server.
  While it installs, builds and starts, it holds `D:\SECONDBRAIN\.secondbrain\launcher.lock`. A second double-click during that time says "đang khởi động, chờ chút" and simply opens the app when it is ready (it waits up to 10 minutes) instead of building in parallel. A lock left by a closed window (its process is gone, or it is older than 15 minutes) is taken over automatically.
- **Stop:** open Command Prompt in `D:\SECONDBRAIN` and run `"Mở Second Brain.cmd" stop` (in PowerShell: `& '.\Mở Second Brain.cmd' stop`). It first asks the server to shut down cleanly (`POST /api/shutdown` with the session token from `settings.json`) and waits up to 10 seconds. Only if the server does not answer does it force-stop the process recorded in `.secondbrain\server.json` — and only after checking that its command line is `node … server\dist\index.js`, so an unrelated program that happens to reuse the PID is never touched.
- The console window closes by itself when everything worked; it stays open with a message when something went wrong.
- **Start quietly at login (M4):** `"Mở Second Brain.cmd" login` starts the server without opening a browser and stays silent when it already runs. "Chạy khi đăng nhập Windows" in Settings puts `Second Brain.lnk` in the Startup folder; it runs `wscript.exe app\launcher\start-hidden.vbs`, which calls the `login` action with no window. Problems at login show one message box and are written to `D:\SECONDBRAIN\.secondbrain\logs\launcher.log`.
- **Quit from the app:** Settings → "Thoát Second Brain" (same as `stop`), or the tray icon → "Thoát Second Brain" (it asks first).
- **Tray icon and Ctrl+Alt+Q (M5):** while the server runs (launcher or exe), a Second Brain icon sits in the notification area: left click opens the app; right click offers "Mở Second Brain", "Ghi nhanh", "Thoát Second Brain". `Ctrl+Alt+Q` in any program opens a small "Ghi nhanh vào Inbox" box (Enter saves, Shift+Enter is a new line, Esc closes; if saving fails the text stays and the reason is shown). Settings → Ứng dụng → "Biểu tượng khay và phím tắt toàn hệ thống" turns both off (default on). If another program already holds `Ctrl+Alt+Q`, Settings says so and the tray's "Ghi nhanh" still works.
- The launcher's `stop` also stops a running `Second Brain.exe` (its forced stop recognises the exe by its program name). Use one way of starting at a time: both use the same home folder and port.

Launcher files:
- `app\launcher\start-second-brain.ps1` — the logic. It **must stay UTF-8 with BOM and CRLF line endings**: Windows PowerShell 5.1 reads a BOM-less file as ANSI, which garbles the Vietnamese messages and can break quoting. `.editorconfig` and the `launcher files` test guard this; if you edit it in an editor, save as "UTF-8 with BOM".
- `app\launcher\Mở Second Brain.cmd` — wrapper next to the script (works from that folder too).
- `app\launcher\root-wrapper.cmd` — the copy that lives at `D:\SECONDBRAIN\Mở Second Brain.cmd`. The delivery step installs it there. If it is ever missing: copy `app\launcher\root-wrapper.cmd` into `D:\SECONDBRAIN` and rename the copy to `Mở Second Brain.cmd` (File Explorer: right-click → Copy, paste in `D:\SECONDBRAIN`, F2 to rename).

## Where things are
| What | Where |
|---|---|
| Global settings (port, UI prefs, session token, later API keys) | `D:\SECONDBRAIN\.secondbrain\settings.json` — never share this file |
| Running server info (PID, port) | `D:\SECONDBRAIN\.secondbrain\server.json` |
| Launcher lock while installing/building/starting | `D:\SECONDBRAIN\.secondbrain\launcher.lock` (removed automatically) |
| Server log (no note content, no tokens; rotated at 5 MB) | `D:\SECONDBRAIN\.secondbrain\logs\server.log` before a vault opens, then `vault\.secondbrain\logs\app.log` (Settings → "Mở thư mục log") |
| Launcher log (login start, port busy) | `D:\SECONDBRAIN\.secondbrain\logs\launcher.log` |
| Reminders already sent | `vault\.secondbrain\state\reminders.json` |
| Run-at-login shortcut | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Second Brain.lnk` (runs the launcher's `login` action, or `"…\Second Brain.exe" --login` when the app runs as the exe) |
| Notes | `D:\SECONDBRAIN\vault\` (created in M1) |
| The single executable (M5) | `D:\SECONDBRAIN\Second Brain.exe` (built by `app\launcher\Tạo bản exe.cmd`; the build output is `app\dist-exe\Second Brain.exe`) |
| Exe runtime (extracted on the first start, reused afterwards) | `%LOCALAPPDATA%\SecondBrain\runtime\<16 hex>\app\…` — safe to delete while the app is stopped; the next start extracts it again |
| Exe first-start record (shortcuts made) | `D:\SECONDBRAIN\.secondbrain\install.json` |
| Desktop and Start-menu shortcuts (exe) | `Second Brain.lnk` on the Desktop and in the Start menu, made once on the first exe start |
| Scheduled backups (default folder) | `D:\SECONDBRAIN\Backups\Second Brain <vault folder> <YYYY-MM-DD HHmm>.zip` (or the folder chosen in Settings) |
| Scheduled backup records and lock | `D:\SECONDBRAIN\.secondbrain\backups.json`, `backup.lock` (only the zips listed there are ever deleted by "keep") |
| Telegram/email messages waiting or sent | `vault\.secondbrain\state\notify-outbox.json` (titles, paths, dates; never a token or password) |
| "Học kỳ này" page state | `vault\.secondbrain\state\semester-page.json`; the page itself is `vault\Học kỳ này.md` |
| Bot token, SMTP password, GitHub token | only in `D:\SECONDBRAIN\.secondbrain\settings.json`; the app shows them as `…last4` and never logs them or puts them in backups |

## Developer commands (in `D:\SECONDBRAIN\app`)
| Command | What it does |
|---|---|
| `npm install` | install dependencies |
| `npm run dev` | server + Vite dev middleware at `http://localhost:4747` (reloads on change) |
| `npm run build` then `npm start` | production build and run (what the launcher does) |
| `npm test` | all unit/integration tests (server, web, tooling) |
| `npm run lint` | ESLint (incl. i18n and raw-color rules) + raw-color scan + i18n parity + contrast check |
| `npm run test:e2e` | build, then Playwright against a temporary home on port 4799. First time on Windows: `npx playwright install chromium` |
| `npm run gen-vault -- --out <folder>` | synthetic 5,000-note vault for performance tests (refuses the real vault, the vault set in `settings.json`, folder names ending in a dot or space, and non-empty folders) |
| `npm run build:exe` | builds the app when it is stale, then writes `dist-exe/Second Brain.exe` (Linux: `dist-exe/second-brain`); `--skip-build` packs the existing `dist` folders, `--out <dir>` changes the output folder. It refuses to pack a tree that does not build |
| `SB_TEST_SEA=1 npx vitest run scripts/build-exe.sea.test.ts` | smoke test of the built executable (Linux in the build container): first start with extraction, health, UI shell, a note created and found, second start, `--stop`, re-extraction of a damaged runtime (about a minute) |
| `npx tsx scripts/bench-index.ts --log-lines 150000` | index and API benchmark on a generated 5k vault, with `events.jsonl` grown to a year of heavy use (Today with a growing log, graph history) |

## Troubleshooting
- **"Chưa tìm thấy Node.js" / "Node.js … đã cũ":** install Node.js 24 LTS, close the window, double-click the launcher again.
- **Port 4747 busy** (another app uses it): a message box names the program that holds the port. Close it, or change the port in Settings and start again (the launcher reads the port from `settings.json`). After a port change, install the app again: an installed app belongs to its old address.
- **"running scripts is disabled on this system":** always start through the `.cmd` file; it runs PowerShell with `-ExecutionPolicy Bypass` for this script only. Do not change the machine-wide policy.
- **App opens but says it cannot reach the server:** run the launcher again; if it keeps failing, read `D:\SECONDBRAIN\.secondbrain\logs\server.log`.
- **After updating the code:** just double-click the launcher; it reinstalls/rebuilds when needed.
- **"Tiến trình … không phải máy chủ Second Brain":** `server.json` points at a PID now used by another program. Nothing was stopped; restart Windows if the app still seems to run.
- **Launcher messages look garbled (`Ä‘`):** `start-second-brain.ps1` lost its BOM; re-save it as UTF-8 with BOM.
- **"Windows đã bảo vệ PC của bạn" when opening `Second Brain.exe`:** the exe is not signed, so Windows may warn before running it. Click "Thông tin bổ sung" (More info), then "Vẫn chạy" (Run anyway).
- **"Relocation corrupted: BlockSize is out of bound…" while building the exe:** a message of the injection tool's file parser, not an error; the build continues.
- **The exe shows a message box at start:** it says why (port busy, another Second Brain folder already on the port, the vault cannot be opened). There is no console window in the exe, so problems are shown this way and written to the log.
- **"Chưa tạo được bản exe" / the copy fails:** if Second Brain is running as the exe, quit it from the tray first (the running file cannot be replaced), then double-click `Tạo bản exe.cmd` again.
- **After a Node.js upgrade:** build the exe again (it carries the Node and the SQLite addon it was built with).
- **No tray icon:** Settings → Ứng dụng shows the helper's state; turn "Biểu tượng khay và phím tắt toàn hệ thống" off and on to restart it (after 3 crashes in an hour it waits for that).
- **Scheduled backup says "Lỗi: …":** the sentence names the cause (folder missing, e.g. an unplugged USB drive; disk full; folder inside the vault); the app retries every hour until a backup succeeds.

## Install as an app (M4)
Open `http://localhost:4747` in Chrome or Edge → Settings → "Cài đặt app" (or the install icon in the address bar). The app gets its own window and desktop icon (PWA, SPEC F21). Double-clicking the launcher later brings that window to the front instead of opening a browser tab. "Chạy khi đăng nhập Windows" in Settings starts the server at login so the icon works after a reboot. When the server is not running, the installed app still opens and shows "Chưa kết nối với máy chủ…"; it reconnects by itself once the server is up. After an update the app shows "Có bản mới của app." with "Tải lại".

## Backups and history (M4, M5)
- Settings → "Xuất bản sao lưu…" downloads a zip of the vault (notes, attachments, `.secondbrain/state`, trash; never the settings file, the token or API keys). "Khôi phục thử…" restores a zip into a new empty folder and opens it as a separate vault.
- With Git for Windows installed, the app keeps a history of every note in `vault\.git` (a snapshot every 10 minutes and when the app stops). Open a note's "Lịch sử phiên bản" to compare and restore. Without Git the app works the same, only history is off.
- **Scheduled backups (M5):** Settings → Kho ghi chú → "Sao lưu tự động" → "Sao lưu tự động hằng ngày" (off by default). Every day at the chosen time (default 21:00) the server writes the same zip as "Xuất bản sao lưu…" to the backup folder (default `D:\SECONDBRAIN\Backups`, created when needed; a chosen folder, e.g. on a USB drive, is never created by the app) as `Second Brain <vault folder> <YYYY-MM-DD HHmm>.zip`. If the laptop was off or asleep at that time, one catch-up backup runs within a minute of the next start or wake when the last success is more than 24 hours old. A failure shows "Lỗi: …" in Settings and is retried every hour. "Giữ lại bao nhiêu bản" (default 14, 3–60) deletes only older zips the app wrote and recorded; her own files, renamed copies and zips in an earlier folder are never touched. "Sao lưu ngay" makes one at once; "Mở thư mục" opens Explorer at the newest zip. A folder inside the vault or the app is refused. Saves wait while the zip is built; the vault drive needs room for one zip and the target for one more.
- **GitHub push (M5, optional):** under "Đẩy lên GitHub", give a private repository address (`https://github.com/<name>/<repo>.git`) and a fine-grained token limited to that repository with Contents: Read and write. "Đẩy ngay" commits pending changes and pushes the version history (`vault\.git`) to branch `main` (or the one set under "Nhánh"); with the switch on, each scheduled backup pushes too. The token is passed to git only in its environment for that one command: it is never written to `vault\.git\config`, logs or backups, and no Git Credential Manager window opens. Errors say what happened (key refused, no network, the repository already has other changes). Without Git the push is disabled with a hint.

## Single executable, tray and shortcuts (M5)
- **Build it:** double-click `D:\SECONDBRAIN\app\launcher\Tạo bản exe.cmd`. It runs `npm install` when needed and `npm run build:exe` (which builds the app first when it is stale), then copies the result to `D:\SECONDBRAIN\Second Brain.exe`. It ends with `Xong: "D:\SECONDBRAIN\Second Brain.exe"`; on an error the window stays open with the reason. Quit a running exe first (tray → "Thoát Second Brain"), because a running file cannot be replaced. Build it again after a Node.js upgrade.
- **Run it:** double-click `D:\SECONDBRAIN\Second Brain.exe`. The exe is not signed, so Windows SmartScreen may say "Windows đã bảo vệ PC của bạn": click "Thông tin bổ sung" (More info), then "Vẫn chạy" (Run anyway). There is no console window; the app opens in the default browser once the server listens. The home folder is the exe's folder (`D:\SECONDBRAIN`), so it uses the same vault, settings and port as the launcher. A second double-click only opens the app.
- **First start:** the exe extracts its runtime (server, built UI, production libraries, the SQLite addon; about 4,800 files) to `%LOCALAPPDATA%\SecondBrain\runtime\<hash>\` and reuses it afterwards; each start checks the files (sizes, and a hash of the server code and native addons) and extracts again when something is damaged. Runtimes of older builds are removed once no running Second Brain uses them. The first start also puts `Second Brain.lnk` on the Desktop and in the Start menu, pointing at the exe (once, recorded in `.secondbrain\install.json`; an installed-app shortcut with the same name is left alone; Settings → Ứng dụng → "Tạo lại lối tắt trên màn hình" makes them again). If "Chạy khi đăng nhập Windows" was on, its Startup shortcut now runs `"…\Second Brain.exe" --login`.
- **Command-line options:** `"Second Brain.exe" --stop` asks the running server to stop (exit code 0 when stopped or not running, 1 when it failed; it never kills a process); `--login` starts quietly without opening a browser (used by run at login); `--mcp-stdio` runs the Claude Desktop bridge (Settings → "Kết nối Claude (MCP)" shows the exe snippet automatically; restart Claude Desktop after switching from the node snippet); `--home <folder>` uses another home.
- **Tray and hotkey:** see "Start and stop" above; they work the same with the launcher.
- Settings → Ứng dụng → "Cách app đang chạy" says "Đang chạy bằng ứng dụng .exe" with the file path, or "Đang chạy từ mã nguồn" with how to make the exe.

(Update this file whenever the start-up procedure changes.)
