# System Architecture

Planned architecture: `../../SPEC.md` §8 (modules), §4 (data model), §9 (REST API), F32 (MCP). This file describes the architecture **as built**. Update it at the end of each milestone with what actually exists and any deviations (also log deviations in `../DECISIONS.md`).

## Planned shape (summary)
```
Browser (React + Vite PWA)
   │  REST /api/*  +  WebSocket /ws
   ▼
Node.js server (Fastify, 127.0.0.1:4747)
   ├── VaultService ── atomic fs ops on D:\SECONDBRAIN\vault
   ├── Watcher (chokidar) → Indexer → SQLite (.secondbrain/index.sqlite, FTS5)
   ├── Git (auto-commit in vault), Reminders, Settings
   ├── MCP server (stdio + streamable HTTP)      [Phase 3]
   └── AI providers + retrieval + embeddings     [Phase 3]
```
Data flow: UI → REST → VaultService writes file → watcher → indexer → WS `note:changed` → UI refresh. The UI never writes files directly; MCP tools call the same services as REST.

## As built (after M0, 2026-10-18)

```
app/
├── package.json            npm workspaces (server, web); scripts dev/build/start/test/test:e2e/lint/typecheck/gen-vault
├── vitest.config.ts        one run, three projects: server (node), web (jsdom), tooling (scripts + lint rules)
├── eslint.config.js        flat config + local plugins from eslint-rules/
├── playwright.config.ts    e2e against the built server on port 4799 with a temp home
├── server/src/
│   ├── index.ts            CLI entry: --dev --home --port (env SB_HOME/SB_PORT); exit 0 already running, 2 port busy, 64 bad args
│   ├── config/             app paths (home = parent of app/), CLI args, global settings.json (atomic, token on first run, corrupt-file backup)
│   ├── runtime/            start-server (listen 127.0.0.1, server.json, signals), probe for an already-running instance
│   ├── security/           Host allowlist 421, Origin check 403, session token 401 (constant time), baseline headers + CSP
│   ├── http/               buildApp() factory used by index.ts and every test; JSON error helper
│   ├── api/                GET /api/health (public), GET /api/settings (ui prefs + port, never secrets)
│   ├── ws/                 /ws?token= sends {type:"hello"}
│   ├── shell/              UI shell: prod = web/dist + placeholder injection; dev = Vite middleware (@fastify/middie)
│   ├── logging/            rotating file logger (5 MB, 3 files), one line per request, no query strings or tokens
│   └── fs/                 atomic write (temp file in the same dir + fsync + rename)
├── web/
│   ├── index.html          placeholders __SB_TOKEN__ __SB_BOOT__ __SB_LANG__ __SB_THEME__ __SB_PALETTE__ __SB_FONT_SIZE__ (filled by the server)
│   └── src/
│       ├── app/            hash router, 3-pane layout, sidebar (search placeholder, nav, folders empty state), right panel
│       ├── features/       today (greeting + summary placeholder), placeholders for tasks/calendar/graph, not found
│       ├── i18n/           i18next init, vi.json (default), en.json, lint-allowlist.json
│       ├── lib/            boot config from meta tags, API client (X-SB-Token), UI prefs store + <html> attributes, greeting, dates
│       └── styles/         tokens.css (only file with colors: dark/light × dau-tam/hoa-dao/oai-huong, font sizes), base, layout, sidebar
├── eslint-rules/           i18n/no-literal-ui-strings, colors/no-raw-color (+ RuleTester tests)
├── scripts/                check-contrast, check-raw-colors, check-i18n-parity, gen-vault (5k notes / 51 MB / 20k links / 3k tasks)
└── launcher/               start-second-brain.ps1 (start/stop, hidden server, health probe), Mở Second Brain.cmd, root-wrapper.cmd
```

**Request path today:** browser → `http://localhost:4747` → security hook (Host → Origin → token → 127.0.0.1 shell redirect) → `/api/*` routes, `/ws`, or the UI shell. The shell is rendered per request with the session token in a meta tag; the web app reads it and sends it as `X-SB-Token`.

## As built (after M1, 2026-10-19)

```
server/src/
├── vault/          VaultService (vault-service.ts → read/write/rename/trash ops), write queue, disk-name mapping (NFC/NFD, case),
│                   journal (store, runner, step actions, validation), trash (store, ops), open-vault (layout, identity, housekeeping),
│                   vault-watcher.ts (chokidar → VaultChange 'external'), vault-types.ts (contract)
├── fs/             atomic write (short .sb-<hex>.tmp names, mode kept, no-clobber link), move with EXDEV copy fallback, realpath fallback
├── security/       path-guard.ts (syntax + realpath containment) + the M0 Host/Origin/token hooks
├── templates/      bundled templates + CLAUDE.md skeleton (TS strings)
├── markdown/       parseNote (fast-* scanner, mdast fallback), normalize-text, content-classes, link-catalog/resolve-link, relink
├── index/          open-index (service + change queue), schema, builder, rebuild-and-swap, database-swap, writer/reader/mutations,
│                   reconcile, link re-resolution, search (parser, FTS query, snippets, due filter), deadline service + today view,
│                   event log, index-relink-planner
├── lib/            local-date (calendar dates in local time)
├── app-context/    createAppContext: vault → index → deadlines → relink planner → watcher → change router → WS hub
├── api/            vault routes (note, note operations, journal, queries, listing/tree, files, maintenance incl. sample data)
├── ws/             hub + server event shapes
├── sample-data/    opt-in sample set (Vietnamese notes, wiki pages, 3 one-page PDFs via a tiny PDF writer)
└── (M0) config, runtime, http, shell, logging
```

**Data flow:** REST mutation → VaultService (queue, revision check, journal) → `VaultChange` (origin app) → change router → index update → WS event. Outside edits: chokidar → `VaultChange` (origin external) → same router (echoes of app writes dropped only when the index already agrees). Rename/move with relink: the planner (inside the write queue) waits for pending index updates, plans edits from the index catalog + candidates, the journal applies them and the rename.

**Files on disk:** `<vault>/.secondbrain/{vault.json, cache/index.sqlite, state/{events.jsonl, journal/, drafts/, ingest/, sample.json}, trash/, logs/app.log}`; global `<home>/.secondbrain/{settings.json, server.json, logs/server.log}`.
