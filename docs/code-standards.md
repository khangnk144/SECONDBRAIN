# Code Standards

Starting conventions for this codebase. Refine as the code grows; keep consistent with `../../SPEC.md` §8 (architecture) and §11 (testing).

## Language & tooling
- TypeScript everywhere, `strict: true`. Node 24 LTS (engines ≥ 22). npm workspaces: `server`, `web`.
- ESLint + Prettier (default Prettier style, 100 col). `npm run lint` must pass before commit.
- Vitest for unit/integration, Testing Library for React, Playwright for e2e.

## Files & naming
- kebab-case file names, long and descriptive (`vault-atomic-write.ts`, `today-deadline-strip.tsx`).
- ~200 lines max per file; split by responsibility.
- React components: one component per file, named export, PascalCase component name.
- Tests next to the area they test under `test/` (server) or `src/**/__tests__` (web); fixtures under `server/test/fixtures/`.

## Server
- All file access goes through `VaultService`; never `fs` directly from routes.
- Every path from a request is resolved and checked against the vault root (path-traversal guard) before use.
- Writes are atomic (temp file in the same directory + rename). Every mutation carries `expectedRevision` (SHA-256 of file bytes) and returns 409 on mismatch. Deletion = move to `vault/.secondbrain/trash/` with `meta.json`. Multi-file operations go through the journal (SPEC §4.12).
- Errors: `{ error: { code, message } }` with the codes in SPEC §9. No stack traces to the client.
- No note content in logs.
- Bind to `127.0.0.1` only; Host allowlist, Origin check and the session token header on every `/api`, `/ws` and `/mcp` request (SPEC §5).

## Web
- Styling: plain CSS using the custom properties from `styles/tokens.css` (generated from design.md §10). No raw hex/rgb in components; no Tailwind.
- All user-facing text via `t('…')` (i18next). Keys added to both `vi.json` and `en.json` in the same change.
- State: one store per domain (vault, note, today, search, graph, settings). Server events via WebSocket invalidate stores.
- Accessibility: every interactive element reachable by keyboard; visible focus; `aria-*` on custom controls; respect `prefers-reduced-motion`.

## Data safety
- Never modify the real vault (`../vault`) from tests or scripts.
- Markdown preservation contract (SPEC §4.9): unchanged blocks are written back byte-identical; line-level changes (tasks, properties, links) are textual patches, never editor round-trips. Any change to the converter or patchers runs the corpus.

## Git
- Conventional commits within a milestone (`feat(editor): …`, `fix(index): …`); a closing commit `milestone N: <summary>`.
- No secrets, no `.env`, no `node_modules`.
