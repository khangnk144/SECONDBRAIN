# Decisions

Record any deviation from `../SPEC.md` or `../design.md` here **before** making it (SPEC §0 rule 5). Format:

```
## <YYYY-MM-DD> <short title>
Context: …
Decision: …
Why: …
Spec sections affected: …
```

## 2026-10-18 Agent tooling: ClaudeKit subset in app/
Context: The owner has a local copy of ClaudeKit (`D:\Claude_Kit`) with 88 skills.
Decision: Install 45 relevant skills plus agents, rules and hooks into `app/.claude` and `app/.codex`; drop media, payments, mobile, 3D, shadcn/Tailwind, Postgres and other irrelevant skills. Project rules in `CLAUDE.md` override skill defaults.
Why: Fewer, relevant skills mean better routing and less context noise; the kit lives in `app/` so the vault's own `CLAUDE.md` (Phase 3, AI wiki schema) never mixes with coding rules.
Spec sections affected: none.

## 2026-10-18 Node engines `>=22.12` instead of `>=22`
Context: SPEC §1.3 pins Node 24 LTS with engines `>=22`. Vite 8 and Vitest 5 require Node `^22.12` or `>=24`.
Decision: `engines.node` is `>=22.12`; `.nvmrc` stays `24`. The launcher checks for 22.12+.
Why: Node 22.0–22.11 cannot run the build toolchain; the locked target (Node 24) is unaffected.
Spec sections affected: §1.3 (engines range only).

## 2026-10-18 Library major versions
Context: Latest majors at M0 time: React Router 8 (needs React 19), TypeScript 7 (native port, not yet supported by typescript-eslint).
Decision: React 18.3.1 (locked by SPEC) with react-router 7.18; TypeScript 5.9.3. All versions pinned exactly in package.json.
Why: Stay on the stack SPEC §8 names while keeping lint/test tooling compatible.
Spec sections affected: none (§8 asks for pinned versions).

## 2026-10-18 Launcher location
Context: SPEC §3 places `Mở Second Brain.cmd` at the install root; §8 lists it under `app/launcher/`.
Decision: The logic lives in `app/launcher/start-second-brain.ps1` (tracked in git). `D:\SECONDBRAIN\Mở Second Brain.cmd` is a thin copy of `app/launcher/root-wrapper.cmd` that calls it.
Why: Keeps the launcher versioned with the code while the owner still double-clicks a file at the root.
Spec sections affected: §3, §8, F21 (no behavior change).

## 2026-10-18 Dev-mode CSP relaxation
Context: SPEC §5 requires `default-src 'self'` and no inline scripts on the UI shell. In `npm run dev`, Vite injects the React refresh preamble as an inline script and CSS as `<style>` tags, and HMR uses its own websocket.
Decision: Production (`npm start`, launcher) uses the strict CSP. Dev mode only adds `'unsafe-inline'` to `script-src`/`style-src` and the HMR websocket to `connect-src`.
Why: HMR is needed for development; the owner never runs dev mode.
Spec sections affected: §5 Security (dev mode only).

## 2026-10-18 Server log location before a vault exists
Context: SPEC §5 puts logs in `vault/.secondbrain/logs/`. M0 has no vault yet.
Decision: Until the vault service exists (M1), the server logs to `<install root>/.secondbrain/logs/server.log` (5 MB rotation, no tokens, no query strings, no note content). M1 moves logging into the vault.
Why: The launcher needs a log to show when startup fails.
Spec sections affected: §5 Logs (temporary).

## 2026-10-18 Commit messages
Context: The system default adds AI co-author trailers; `.claude/rules/development-rules.md` says commit messages carry no AI references.
Decision: Follow the repo rule: conventional commits plus `milestone N: <summary>`, no AI trailers.
Why: The owner's repo rules take precedence.
Spec sections affected: none.

## 2026-10-18 Extra API error codes and headers
Context: SPEC §9 lists error codes for vault/AI operations; the M0 security layer needs codes for its own refusals.
Decision: Add `UNAUTHORIZED` (401, missing/wrong token), `MISDIRECTED_REQUEST` (421, Host not allowed) and `INTERNAL` (500). Every response also carries `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin`. The 127.0.0.1 → localhost redirect applies to the UI shell only; `/api/*` is answered directly on both allowed hosts (the launcher probes `http://127.0.0.1:<port>/api/health`).
Why: Same `{error:{code,message}}` shape for every refusal; the extra headers cost nothing for a same-origin app; on Windows `localhost` may resolve to `::1` first while the server binds `127.0.0.1` only.
Spec sections affected: §5, §9 (additive).

## 2026-10-18 Vite config loading in dev
Context: With Vite's default config loader, the bundled temp copy of `vite.config.ts` is written and deleted next to the sources, which made `tsx watch` restart the server in a loop.
Decision: The dev server starts Vite with `configLoader: 'runner'`.
Why: Stable `npm run dev`.
Spec sections affected: none.

## 2026-10-18 Web shell details left open by design.md
Context: design.md gives Vietnamese copy only; §4 says the left pane becomes a sliding menu below 900 px (mobile polish is Phase 2 per SPEC F28).
Decision: English greetings "Good morning / Good midday / Good afternoon / Good evening / Up late, {{name}}." Below 900 px the sidebar becomes a top bar with horizontally scrolling nav (folders hidden) until the Phase 2 drawer. `tokens.css` keeps design.md values but is Prettier-formatted (lowercase hex, single-quoted attribute selectors); the contrast checker parses both quote styles.
Why: Keeps M0 small without breaking narrow layouts.
Spec sections affected: F10 (EN copy), F28 (interim), design.md §4/§10 (formatting only).

## 2026-10-18 gen-vault output details
Context: SPEC §5 asks for a generated 5,000-note vault.
Decision: The generator writes its counts to `<out>/.secondbrain/gen-vault-summary.json` (so the indexer never sees it as a note) and refuses non-empty folders and anything inside `<install root>/vault`. `scripts/lib/gen-vault/vocabulary.ts` exceeds 200 lines because it is only word lists.
Why: Deterministic, safe fixture for the M1+ performance checks.
Spec sections affected: §5 Performance, §11.

## 2026-10-18 POST /api/shutdown and origin-form-only requests
Context: The launcher's `stop` could only kill the process (no graceful shutdown on Windows, where `Stop-Process` is a hard kill), and F20 will need a clean shutdown for the auto-commit; F21 needs "Thoát Second Brain". The independent review also showed that an absolute-form request target (`GET http://localhost:4747/api/settings`) slipped past the path-based token check.
Decision: Add `POST /api/shutdown` (token, Origin and Host rules like every `/api` route; any body ignored; 202 then graceful close and `server.json` removal). The launcher calls it first and only falls back to `Stop-Process` after checking the PID's command line. Every request whose target does not start with `/` is refused with 400 `VALIDATION` before any other check.
Why: Graceful stop now, one code path for the later Settings button; closes a token bypass for non-browser local clients.
Spec sections affected: §9 (new route), §5 (stricter), F21.

## 2026-10-18 Launcher kept as one PowerShell file; lint skip pattern for message kinds
Context: `launcher/start-second-brain.ps1` grew to ~345 lines (start, stop, lock, graceful shutdown). The i18n rule checks every argument of toast/notify/error helpers.
Decision: Keep the launcher as one file (splitting it would mean dot-sourcing several UTF-8-with-BOM files on Windows PowerShell 5.1). In message-helper calls, identifier-like ASCII arguments (`'info'`, `'save-ok'`, `'fieldName'`, camelCase allowed) are treated as kinds/keys, not UI text.
Why: Fewer moving parts on the owner's machine; no false positives on variant arguments.
Spec sections affected: none (code-size guideline only).
