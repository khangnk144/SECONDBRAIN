# Design Guidelines

**Canonical design: `../../design.md`** (`../design.md` from `app/`), written in Vietnamese. Visual reference: `../../preview-hom-nay.html`. This page is a quick English digest for agents; design.md wins on any conflict. Add implementation notes below (component file locations, decisions), not new visual rules.

## Non-negotiables
- **Dark theme is the default** ("Đêm tím"); light theme via `data-theme="light"`; palettes via `data-palette` (`dau-tam` default, `hoa-dao`, `oai-huong`).
- **Only the tokens in design.md §10** for color, font, radius, spacing, motion. No raw hex in components (lint rule from M0). Text uses the text-safe tokens (`--on-accent`, `--toast-fg`, `--urgent-text`/`--soon-text`/`--ok-text`); dot colors (`--urgent`/`--soon`/`--ok`) are never used for text. A CI script checks every pair in design.md §2.5 (≥ 4.5:1 text, ≥ 3:1 indicators) for both themes and all three palettes.
- **One typeface:** Be Vietnam Pro (400/500/600/700) bundled via `@fontsource` (no CDN); JetBrains Mono for code blocks only. Scale 34/26/20/17/16/14/12.5 px. Body line-height 1.65, max 68ch.
- **No Tailwind, no shadcn, no component kit look.** Plain CSS (CSS modules or one stylesheet per feature) using the tokens.
- **Icons:** Phosphor (`@phosphor-icons/react`), 18 px UI, 16 px inline.
- **Radii carry meaning:** 6 px small (tags, checkboxes), 10 px controls (buttons, inputs), 14 px large surfaces (cards, overlays).
- **Cards only for "projects in progress."** No grey drop shadows; separate surfaces with `--paper` on `--bg` plus a 1 px `--line` border.
- **One accent per screen** (selected item or primary button).
- **Motion:** one load moment (the 14-day strip draws in 400 ms); the brain graph is the only continuously animated screen; everything else ≤ 250 ms and only in response to user actions; honor `prefers-reduced-motion`.
- **Copy:** friendly "bạn", sentence case, buttons name the action, empty states invite action, errors say what happened and what to do. No ALL-CAPS labels, no middle-dot separators, no "→" on buttons.
- **Greeting** changes by time of day with the user's name (SPEC F10).
- **Accessibility:** visible focus ring (2 px `--accent`), contrast ≥ 4.5:1, keyboard everything, targets ≥ 40 px on touch.

## Signature elements
1. **14-day strip** on Today: thin horizontal line, 14 day cells, colored dots for deadlines (urgent/soon/ok), up to 2 titles per day then "+n", popover with the full list on click/Enter, today ringed in accent, overdue cell on the left, keyboard-navigable (roving tabindex).
2. **Brain graph ("Bản đồ não")**: glowing nodes on a dark canvas, colored by `--graph-*` tokens, hollow nodes for referenced documents, slow drift, click sends a light "signal" along edges; an accessible side panel (search, node list, neighbors, open) is the keyboard path — the canvas is `aria-hidden`.

## Implementation notes
(Agents: record where tokens, global styles and key components live once they exist.)
