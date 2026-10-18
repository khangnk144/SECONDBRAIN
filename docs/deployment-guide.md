# Deployment Guide (local)

The app runs only on the owner's Windows laptop. "Deployment" means: start it reliably and install it as a desktop app.

## Requirements
- Node.js 24 LTS (https://nodejs.org)
- Git for Windows (provides Git Bash; also used for note history)

## Start
- Double-click `D:\SECONDBRAIN\Mở Second Brain.cmd` (created in M0): checks Node, installs dependencies on first run, starts the server **hidden** if not running (PID file; no console window), waits for `/api/health`, opens `http://localhost:4747`. `Mở Second Brain.cmd stop` stops it. Settings → "Chạy khi đăng nhập Windows" adds a Startup shortcut so the installed app icon works after a reboot.
- Developer mode: in `app/`, `npm install` then `npm run dev`.

## Install as an app
Open `http://localhost:4747` in Chrome or Edge → "Cài đặt app" button (or the install icon in the address bar). The app gets its own window and desktop icon (PWA, SPEC F21).

## Phase 2
Single-file `.exe` with an installer (SPEC F29), so Node.js is no longer required.

(Update this file whenever the start-up procedure changes.)
