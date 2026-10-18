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

## As built
(Not started. Fill in after M0.)
