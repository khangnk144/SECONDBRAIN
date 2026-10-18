# Project Changelog

One entry per milestone (newest first). Format:

```
## [M<n>] <YYYY-MM-DD> — <title>
- Added: …
- Changed: …
- Fixed: …
- Known gaps: …
```

## [M0] 2026-10-18 — Scaffold
- Added: npm workspaces (server, web), TypeScript strict, ESLint + Prettier, Vitest (server/web/tooling projects), Playwright smoke e2e.
- Added: Fastify server on 127.0.0.1:4747 with Host allowlist, Origin check, session token, CSP and security headers; `/api/health`, `/api/settings`, `/ws`; rotating log; single-instance and port-busy handling.
- Added: React 18 + Vite dark shell (sidebar skeleton, Today placeholder with time-of-day greeting), design tokens for 2 themes × 3 palettes, bundled Be Vietnam Pro / JetBrains Mono, vi/en i18n.
- Added: lint rules for literal UI strings and raw colors, i18n parity check, contrast check (90 pairs), `gen-vault` performance fixture generator, Windows launcher (hidden server, start/stop).
- Known gaps: launcher not yet run on real Windows PowerShell 5.1; reference machine RAM/GPU/disk to confirm.

## [setup] 2026-10-18 — Project setup
- Added: SPEC.md, design.md, PLAN.md, Today screen mock, ClaudeKit agent setup (skills, agents, rules, hooks) tailored to this project.
