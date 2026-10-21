# Deployment Guide (local, Windows)

The app runs only on the owner's Windows laptop. "Deployment" means: start it reliably, stop it, and (from M4) install it as a desktop app.

## Requirements (install once)
- **Node.js 24 LTS** from https://nodejs.org (the app needs ≥ 22.12). Check in PowerShell: `node -v` → `v24…`.
- **Git for Windows** from https://git-scm.com/download/win (note history; Git Bash for agent hooks).

## Start and stop
- **Start:** double-click `D:\SECONDBRAIN\Mở Second Brain.cmd`.
  It checks Node, runs `npm install` when dependencies are missing or the lockfile changed, runs `npm run build` when the build is missing or older than the sources, starts the server **hidden** (no console window to close by accident), waits for `http://127.0.0.1:4747/api/health`, then opens `http://localhost:4747/` in the default browser. Double-clicking again while it runs only opens the app; it never starts a second server.
  While it installs, builds and starts, it holds `D:\SECONDBRAIN\.secondbrain\launcher.lock`. A second double-click during that time says "đang khởi động, chờ chút" and simply opens the app when it is ready (it waits up to 10 minutes) instead of building in parallel. A lock left by a closed window (its process is gone, or it is older than 15 minutes) is taken over automatically.
- **Stop:** open Command Prompt in `D:\SECONDBRAIN` and run `"Mở Second Brain.cmd" stop` (in PowerShell: `& '.\Mở Second Brain.cmd' stop`). It first asks the server to shut down cleanly (`POST /api/shutdown` with the session token from `settings.json`) and waits up to 10 seconds. Only if the server does not answer does it force-stop the process recorded in `.secondbrain\server.json` — and only after checking that its command line is `node … server\dist\index.js`, so an unrelated program that happens to reuse the PID is never touched.
- The console window closes by itself when everything worked; it stays open with a message when something went wrong.
- **Start quietly at login (M4):** `"Mở Second Brain.cmd" login` starts the server without opening a browser and stays silent when it already runs. "Chạy khi đăng nhập Windows" in Settings puts `Second Brain.lnk` in the Startup folder; it runs `wscript.exe app\launcher\start-hidden.vbs`, which calls the `login` action with no window. Problems at login show one message box and are written to `D:\SECONDBRAIN\.secondbrain\logs\launcher.log`.
- **Quit from the app:** Settings → "Thoát Second Brain" (same as `stop`).

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
| Run-at-login shortcut | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Second Brain.lnk` |
| Notes | `D:\SECONDBRAIN\vault\` (created in M1) |

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

## Troubleshooting
- **"Chưa tìm thấy Node.js" / "Node.js … đã cũ":** install Node.js 24 LTS, close the window, double-click the launcher again.
- **Port 4747 busy** (another app uses it): a message box names the program that holds the port. Close it, or change the port in Settings and start again (the launcher reads the port from `settings.json`). After a port change, install the app again: an installed app belongs to its old address.
- **"running scripts is disabled on this system":** always start through the `.cmd` file; it runs PowerShell with `-ExecutionPolicy Bypass` for this script only. Do not change the machine-wide policy.
- **App opens but says it cannot reach the server:** run the launcher again; if it keeps failing, read `D:\SECONDBRAIN\.secondbrain\logs\server.log`.
- **After updating the code:** just double-click the launcher; it reinstalls/rebuilds when needed.
- **"Tiến trình … không phải máy chủ Second Brain":** `server.json` points at a PID now used by another program. Nothing was stopped; restart Windows if the app still seems to run.
- **Launcher messages look garbled (`Ä‘`):** `start-second-brain.ps1` lost its BOM; re-save it as UTF-8 with BOM.

## Install as an app (M4)
Open `http://localhost:4747` in Chrome or Edge → Settings → "Cài đặt app" (or the install icon in the address bar). The app gets its own window and desktop icon (PWA, SPEC F21). Double-clicking the launcher later brings that window to the front instead of opening a browser tab. "Chạy khi đăng nhập Windows" in Settings starts the server at login so the icon works after a reboot. When the server is not running, the installed app still opens and shows "Chưa kết nối với máy chủ…"; it reconnects by itself once the server is up. After an update the app shows "Có bản mới của app." with "Tải lại".

## Backups and history (M4)
- Settings → "Xuất bản sao lưu…" downloads a zip of the vault (notes, attachments, `.secondbrain/state`, trash; never the settings file, the token or API keys). "Khôi phục thử…" restores a zip into a new empty folder and opens it as a separate vault.
- With Git for Windows installed, the app keeps a history of every note in `vault\.git` (a snapshot every 10 minutes and when the app stops). Open a note's "Lịch sử phiên bản" to compare and restore. Without Git the app works the same, only history is off.

## Phase 2
Single-file `.exe` with an installer (SPEC F29), so Node.js is no longer required.

(Update this file whenever the start-up procedure changes.)
