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
