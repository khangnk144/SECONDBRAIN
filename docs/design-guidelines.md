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

## Bento mềm (the default style since M5)
The app has two layout styles (`data-style="bento" | "calm"` on `<html>`, Settings → Giao diện → "Phong cách"); **Bento mềm is the default** and its rules are design.md **§12** (frame §12.2, Today grid §12.3, components §12.4, type §12.5, motion §12.6, what it relaxes from §9 in §12.7, tokens §12.8). Calm keeps everything above unchanged. In short:
- **Frame:** an 84 px rail (`--rail-w`) instead of the 260 px sidebar; the "Thư mục" pane (`--folder-pane-w`) beside it on note and file routes, a drawer elsewhere; a top bar with the search (46 px, `--control-h`) and the one primary "Ghi chú mới". Below 960 px the rail is one row on top; at 600 px or less a bottom tab bar.
- **Tiles:** `--tile` with a 1 px gradient border (`--tile-border`, `--tile-border-hover` on hover; never a shadow, never a lift), boxes inside a tile on `--tile-2`, hairlines `--tile-line`; the "Ngày" tile on `--tint` (`--tint-from` → `--tint-to`) with `--on-tint` text.
- **Radii:** `--radius-tile` 26, `--radius-inner` 18 (day cells, inner boxes), `--radius-panel-tile` 20 (right-panel sections), `--radius-control` 16 (buttons, inputs, task rows), `--radius-square` 12, `--radius-check` 7 (every checkbox: a 20 px square), `--radius-pill` 999. Gaps `--gap-tile` 16 and `--gap-panel-tile` 12.
- **Colour for charts only:** `--pastel-lilac/-peach/-mint/-butter` and the `--chip-*` washes for bars, rings, dots and chips, never for running text; the selected rail entry is `--accent-ink` on `--accent-wash`. Secondary buttons take `--button-2-bg` (and `--button-2-border` inside a `--tile-2` box) so they never melt into their surface.
- **Big numbers** only for today's date (64 px) and the nearest-deadline countdown (56 px).
- **The 14-day strip** keeps every F10 rule except the visible count: Bento cells never get narrower than 66 px (`--today-strip-min-cell`), so it shows as many whole days as fit (14 at 1440 px, about 3 on a phone) and the rest scroll inside the tile; calm keeps "7 visible below 720 px".
- Bento CSS lives under `:root[data-style='bento']` (`web/src/styles/bento/*.css` and each feature's `*-bento.css`); its raw values are only in `web/src/styles/tokens.css`, and `scripts/check-contrast.ts` checks the §12.8 pairs for both themes and all three palettes.

## Implementation notes
(Agents: record where tokens, global styles and key components live once they exist.)
