# Second Brain — app source

Local-first personal knowledge app: Markdown notes with wikilinks and backlinks, deadlines on a 14-day strip, calendar, brain graph, quick capture, daily notes, and AI (MCP server + in-app chat). Single user, Windows first, Vietnamese/English UI.

**Status:** M0 (scaffold) done. Next milestone: **M1 – vault & index** (see `docs/project-roadmap.md` and `MILESTONE-0.md`).

## Read first

- `../SPEC.md` (v1.1) — what to build and when each feature is done (source of truth)
- `../gopy.md` — external review of SPEC v1.0; its points are resolved in v1.1 (read it once for the reasoning behind the data contracts)
- `../design.md` — visual design and CSS tokens
- `CLAUDE.md` — how agents work in this repo

## Layout

```
D:\SECONDBRAIN\
├── vault\          user notes (data; the app reads/writes here; created in M1)
├── .secondbrain\   global settings (port, UI prefs, session token), server.json, logs
├── app\            this folder: source code
│   ├── server\     Node.js + Fastify (+ SQLite from M1)
│   ├── web\        React + Vite
│   ├── scripts\    lint/contrast/i18n checks, gen-vault
│   ├── eslint-rules\ local lint rules (UI strings, raw colors)
│   ├── launcher\   Windows launcher (start/stop)
│   ├── docs\       project docs for agents
│   ├── plans\      implementation plans (ClaudeKit)
│   ├── .claude\    ClaudeKit skills, agents, rules, hooks for Claude Code
│   └── .codex\     ClaudeKit skills for Codex
├── SPEC.md · design.md · PLAN.md · llm-wiki.md · preview-hom-nay.html
```

## Run

Double-click `D:\SECONDBRAIN\Mở Second Brain.cmd` (first run installs dependencies and builds; takes a few minutes). Stop with `"Mở Second Brain.cmd" stop`.

Developers:

```bash
npm install
npm run dev        # http://localhost:4747 (Vite middleware, reloads on change)
npm test           # vitest: server + web + tooling
npm run lint       # eslint + raw-color scan + i18n parity + contrast
npm run test:e2e   # build + Playwright (on Windows first run: npx playwright install chromium)
npm run gen-vault -- --out <empty temp dir>   # 5,000-note performance vault (never inside ../vault)
```

More: `docs/deployment-guide.md`.

## Requirements

Node.js 24 LTS (engines ≥ 22), Git for Windows. Optional: Python 3 (a few agent skills).
