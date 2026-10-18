# Second Brain — app source

Local-first personal knowledge app: Markdown notes with wikilinks and backlinks, deadlines on a 14-day strip, calendar, brain graph, quick capture, daily notes, and AI (MCP server + in-app chat). Single user, Windows first, Vietnamese/English UI.

**Status:** not started. Next milestone: **M0 – scaffold** (see `docs/project-roadmap.md`).

## Read first

- `../SPEC.md` (v1.1) — what to build and when each feature is done (source of truth)
- `../gopy.md` — external review of SPEC v1.0; its points are resolved in v1.1 (read it once for the reasoning behind the data contracts)
- `../design.md` — visual design and CSS tokens
- `CLAUDE.md` — how agents work in this repo

## Layout

```
D:\SECONDBRAIN\
├── vault\          user notes (data; the app reads/writes here)
├── app\            this folder: source code
│   ├── server\     Node.js + Fastify + SQLite (to be created in M0)
│   ├── web\        React + Vite (to be created in M0)
│   ├── docs\       project docs for agents
│   ├── plans\      implementation plans (ClaudeKit)
│   ├── .claude\    ClaudeKit skills, agents, rules, hooks for Claude Code
│   └── .codex\     ClaudeKit skills for Codex
├── SPEC.md · design.md · PLAN.md · llm-wiki.md · preview-hom-nay.html
```

## Run (after M0)

```bash
npm install
npm run dev        # http://localhost:4747
npm test
```

Or double-click `Mở Second Brain.cmd` in `D:\SECONDBRAIN` (created in M0).

## Requirements

Node.js 24 LTS (engines ≥ 22), Git for Windows. Optional: Python 3 (a few agent skills).
