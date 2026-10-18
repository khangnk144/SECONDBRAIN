# Milestone 0 – Scaffold

Date: 2026-10-18 · SPEC v1.1 §12 row M0 · Plan: `plans/2026-10-18-m0-scaffold/plan.md`

## What was built
- **Workspace:** npm workspaces `server` + `web`, TypeScript strict, Node `>=22.12` (`.nvmrc` 24), ESLint (flat) + Prettier, Vitest with three projects (server, web, tooling), Playwright e2e, `.gitattributes` (LF, CRLF for `.cmd`/`.ps1`).
- **Server** (`server/src`): Fastify on `127.0.0.1`, canonical origin `http://localhost:4747`; global settings with a session token created on first run; Host allowlist (421), Origin check (403), token (401), origin-form request targets only (400), CSP + security headers, `GET /api/health`, `GET /api/settings`, `POST /api/shutdown`, `WS /ws`; UI shell with token/prefs injected per request (prod from `web/dist`, dev through Vite middleware); rotating log without tokens or query strings; single-instance and port-busy handling; atomic writes with Windows rename retry.
- **Web** (`web/src`): React 18 + Vite dark shell "Đêm tím": 3-pane layout, sidebar skeleton (search placeholder, Hôm nay / Việc cần làm / Lịch / Bản đồ não, folders empty state), Today placeholder with the time-of-day greeting for khangnie; `tokens.css` with dark/light × Dâu tằm/Hoa đào/Oải hương and font sizes 14/16/18; Be Vietnam Pro + JetBrains Mono bundled; i18n vi (default) + en.
- **Checks:** ESLint rules `i18n/no-literal-ui-strings` and `colors/no-raw-color`, raw-color scan for CSS, i18n key parity, contrast check over every design.md §2.5 pair for 2 themes × 3 palettes (90 checks).
- **Tools:** `scripts/gen-vault.ts` (performance vault), Windows launcher `launcher/start-second-brain.ps1` + `Mở Second Brain.cmd` (hidden server, health wait, browser open, graceful `stop`, first-run lock).

## Acceptance criteria assigned to M0

| AC / DoD item | Verification |
|---|---|
| F19.1 lint rule flags literal UI strings (JSX text, `aria-label`, `title`, `placeholder`, toast/error calls) with an allowlist file | `eslint-rules/i18n-no-literal-ui-strings.test.ts` (RuleTester); allowlist `web/src/i18n/lint-allowlist.json`; `npm run lint` runs it with `--max-warnings=0` |
| F19.1 CI fails on vi/en key parity mismatch | `scripts/check-i18n-parity.test.ts`, `web/src/i18n/i18n-keys.test.ts`; `npm run lint` runs `scripts/check-i18n-parity.ts` |
| No raw colors outside `tokens.css` | `eslint-rules/no-raw-color.test.ts`, `scripts/check-raw-colors.test.ts` |
| Contrast ≥ 4.5:1 (text) / 3:1 (indicators) for every design.md §2.5 pair, all themes and palettes | `scripts/check-contrast.test.ts`; `npx tsx scripts/check-contrast.ts` → 90/90 pass |
| Security: Host allowlist | `server/test/security-host-allowlist.test.ts` (wrong Host → 421 on API, shell and WS; both allowed hosts pass; 127.0.0.1 shell → 302; API on 127.0.0.1 answered directly) |
| Security: Origin check on state-changing requests and WS | `server/test/security-origin-check.test.ts`, `server/test/websocket-auth.test.ts` |
| Security: session token | `server/test/security-session-token.test.ts` (missing/wrong → 401, encoded/cased paths cannot skip it), `server/test/websocket-auth.test.ts`, `server/test/security-request-target.test.ts` (absolute-form targets refused), `server/test/shutdown-route.test.ts` |
| Token never leaks | `server/test/global-settings.test.ts` (settings route), `server/test/request-logging.test.ts` (logs), e2e `settings API needs the session token and never returns it` |
| CSP and safe static serving | `server/test/ui-shell.test.ts`; e2e checks there are no CSP violations or console errors |
| DoD: `npm run dev` serves a dark empty shell at the canonical origin with sidebar skeleton and Today placeholder | Manual run in the build container: `SB_HOME=<temp> npm run dev` → `http://localhost:4747/` renders dark theme (`rgb(28, 22, 34)`), Be Vietnam Pro loaded, no console errors, screenshots desktop 1280×800 and mobile 360×740. Same checks automated against the production build in `web/e2e/shell-smoke.spec.ts` |
| DoD: `npm test` and `npm run lint` green | see "Results" below |
| DoD: reference machine recorded | see below |

## Results (build container, Linux, Node 22.22)
| Command | Result |
|---|---|
| `npm test` | 25 files, 218 tests passed (server 71, web 35, tooling 112) |
| `npm run lint` | exit 0: ESLint `--max-warnings=0`, raw-color scan, i18n parity, contrast 90/90 |
| `npm run typecheck` | exit 0 (server, web, tooling) |
| `npx prettier --check .` | clean |
| `npm run test:e2e` | build + 3/3 Playwright tests passed (Chromium 141) |
| Built server, manual | absolute-form target → 400; `/api/settings` without token → 401; `settings.json` mode 600; `POST /api/shutdown` → 202, server stops, `server.json` removed; token appears 0 times in the log |
| `npm run gen-vault -- --out <tmp>` | 5,000 notes + 8 templates, 51.1 MB, 20,000 body links, 3,000 tasks, 402 projects (340 with deadline), 57 CRLF files, 22 NFD names, 5 duplicate-title pairs; 1.3–1.4 s; same seed + date → identical vault |
| Launcher (PowerShell 7.4 on Linux, built server) | start, start again (opens only), graceful stop, stop again, stale `server.json` pointing at an unrelated node process (left alive), lock wait / takeover / owner dying — all as specified |

## Reference machine (SPEC §5)
Owner's laptop `DESKTOP-H6C85Q7`, Windows x64.
- CPU: Intel Core Ultra 5 125U (read from the linked machine).
- GPU: integrated Intel Graphics of the Core Ultra 5 125U (to confirm: no discrete GPU known).
- RAM, disk type: **to fill in by the owner** (Settings → System → About). Not readable from this session.
Performance numbers for SPEC §5 start in M1 (indexer). Until then, the only measurement is the generator itself (container, 2 vCPU): see Results.

## Manual checks still to do on Windows
1. Double-click `D:\SECONDBRAIN\Mở Second Brain.cmd` → first run installs dependencies and builds (a few minutes) → the app opens at `http://localhost:4747` with the dark shell. Double-click again → only opens the browser.
2. `"Mở Second Brain.cmd" stop` → server stops.
3. Optional for developers: `npm run dev`, `npm test`, `npm run lint`, `npx playwright install chromium` then `npm run test:e2e`.
(The launcher was exercised with PowerShell 7 on Linux, not yet with Windows PowerShell 5.1; formal launcher AC F21.1–F21.4 belong to M4.)

## Independent review
A separate agent reviewed M0 read-only. Fixed before closing: absolute-form request targets bypassing the token check (now 400 + tests), i18n rule false negatives (template literals, concatenation, object/multi-argument toast calls, more attributes), named/modern color functions in the raw-color checks, gen-vault inside-vault check (`<vault>/..x`, trailing dots/spaces, custom `vaultPath`), skip link navigating the hash router, 403 error code, `<kbd>`/small text below 12 px, middle dots in the allowlist, settings file mode 0600, Windows rename retry, static allowlist (no NTFS alias of `index.html`), launcher `stop` (graceful API call, command-line check before any kill), first-run double-click lock, `.editorconfig` keeps the BOM of `.ps1`.

## Known gaps
- IPv6: another program bound to `[::1]:4747` could receive browser traffic for `localhost:4747` while the launcher's 127.0.0.1 probe still succeeds. Rare; revisit with the port-busy dialog in M4.
- Logs live in `<install root>/.secondbrain/logs/` until the vault exists (M1).
- `scripts/lib/gen-vault/vocabulary.ts` exceeds 200 lines (word lists only).
