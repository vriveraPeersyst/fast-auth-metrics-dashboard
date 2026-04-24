# Peersyst / FastAuth — Design System

**Last updated:** 2026-04-23
**Source of truth:** extracted from `app/globals.css` and `app/layout.tsx` of the FastAuth Metrics Dashboard (Next.js App Router).
**Owner:** Peersyst
**Scope:** private internal tools (FastAuth Metrics), extensible to external-facing Peersyst surfaces.

---

## Contents

| File | Purpose |
|---|---|
| `tokens/colors_and_type.css` | CSS custom properties — copy/paste into any HTML artifact |
| `tokens/tokens.json` | Machine-readable tokens (same values, JSON) |
| `preview/00_cover.html` | Cover card |
| `preview/01_palette.html` | Color palette — mint accent + neutrals + status |
| `preview/02_typography.html` | Type scale — SF Pro + SF Mono |
| `preview/03_spacing_radii_shadow.html` | Radii, elevation, spacing |
| `preview/04_buttons.html` | Action / Ghost pill buttons |
| `preview/05_cards.html` | Metric cards, health cards, panels |
| `preview/06_badges.html` | Status health badges |
| `preview/07_tables.html` | Data tables (mono) |
| `preview/08_uptime_bar.html` | Uptime / progress bar |
| `SKILL.md` | How to build new surfaces in this system |

---

## 1. Brand

**Name:** FastAuth Metrics (built by Peersyst)
**Positioning:** a calm, instrument-panel dashboard for NEAR/FastAuth operators. It shows raw chain data without drama — the UI is the frame, the numbers are the subject.
**Personality:** technical, precise, unpretentious. Adjectives: *crisp, warm, operator-grade, neutral-forward*.
**Don't:** gradients, neon, glassmorphism, emoji, AI-slop stat dashboards with icons on every card. The mint is earned — it signals "live / healthy / action" and nothing else.

## 2. Voice & content

- **Labels** are flat and declarative: *Total accounts*, *Indexer lag*, *Recent NEAR transactions*. No cleverness.
- **Units** stay in the value, not the label: `42m ago`, `+1,204 blocks`, `98.3%`.
- **Kickers** (the small uppercase line above a page title) are short categorical tags: `FASTAUTH METRICS DASHBOARD`. Mono, tracked, uppercase.
- **Empty states** are one plain sentence: *"No relayer activity has been indexed yet."*
- **Timestamps** are absolute on hover, relative in the cell (`2h 14m ago`).
- **Hashes & addresses** truncate middle (`abcd…wxyz`) and link to nearblocks.

## 3. Color

The palette is 90% warm neutral and black, with mint as the single accent.

| Token | Hex | Role |
|---|---|---|
| `--color-canvas` | `#F5F4ED` | page background — warm cream |
| `--color-surface` | `#FFFFFF` | cards, panels |
| `--color-surface-muted` | `#EBE9DF` | table headers, hover fills |
| `--color-border` | `#EBEBEB` | default 1px card border |
| `--color-border-subtle` | `#D6D4CB` | secondary separators |
| `--color-border-ring` | `#E1E0DA` | focus/ring accents |
| `--color-ink` | `#000000` | primary text |
| `--color-ink-subtle` | `#757571` | secondary text, labels |
| `--color-ink-muted` | `#93928E` | tertiary / placeholder |
| `--color-ink-translucent` | `rgba(0,0,0,0.48)` | overlays |
| `--color-mint` | `#00F29B` | **primary accent** — CTAs, healthy |
| `--color-mint-light` | `#92FFD8` | hover state for mint |
| `--color-mint-soft` | `#9CFFDB` | backgrounds, highlights |

**Status colors — functional only. Never use as brand accents.**

| Token | Hex | |
|---|---|---|
| `--color-status-ok` | `#1EA874` | healthy text |
| `--color-status-ok-bg` | `rgba(30,168,116,.12)` | healthy pill bg |
| `--color-status-warn` | `#B07A08` | lagging text |
| `--color-status-warn-bg` | `rgba(176,122,8,.14)` | lagging pill bg |
| `--color-status-err` | `#C64545` | stale / no-data text |
| `--color-status-err-bg` | `rgba(198,69,69,.12)` | stale / no-data pill bg |

**Rules:**
- Mint appears on ≤1 element per screen region (usually the primary CTA, the healthy uptime fill, or a single active badge). Do not use mint + warn + err in the same card header.
- Text is `--color-ink` on surface; secondary/metadata uses `--color-ink-subtle`. Never use mint on text — readability is poor.
- Card surfaces are always `--color-surface` over `--color-canvas`. Do not invert.

## 4. Typography

**Families** (system fonts — no webfont loading, fast cold starts):
- **Sans:** SF Pro Text / SF Pro Display → `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif`
- **Mono:** SF Mono → `"SF Mono", Monaco, Consolas, "Liberation Mono", "Courier New", monospace`

**Scale (matches globals.css exactly):**

| Role | Family | Size / line | Weight | Tracking |
|---|---|---|---|---|
| H1 | sans | 40 / 48 | 700 | -0.01em |
| Page H1 (in topbar) | sans | 28 / 36 | 700 | -0.01em |
| H2 | sans | 22 / 26 | 700 | -0.01em |
| H3 | sans | 18 / 26 | 700 | -0.01em |
| Body | sans | 16 / 30 | 400 | 0 |
| Body small | sans | 14 / 24 | 400 | 0 |
| Meta | sans | 13 / 20 | 400 | 0 |
| Kicker | **mono** | 12 / 20 | 500 | +0.06em, UPPER |
| Metric label | **mono** | 12 / 20 | 500 | +0.06em, UPPER |
| Metric value | sans | 32 / 40 | 700 | -0.01em |
| Table head | **mono** | 11 / 16 | 500 | +0.06em, UPPER |
| Table cell | **mono** | 13 / 20 | 400 | 0 |
| Health badge | **mono** | 11 / 16 | 700 | +0.08em, UPPER |

**Rule of thumb:** anything that is a number, a hash, a block height, an address, a status code, or a UI label above a value → **mono**. Everything else → sans.

## 5. Spacing, radius, elevation

**Radius tokens:**
- `--radius-sm: 8px` — inputs, table wrapper
- `--radius-md: 12px` — cards, panels (default)
- `--radius-lg: 16px` — larger feature cards
- `--radius-xl: 24px` — hero surfaces
- `--radius-pill: 100px` — buttons & badges

**Elevation:**
- `--shadow-card: 0 0 8px rgba(0,0,0,.08)` — default card
- `--shadow-inset-soft: inset 0 0 3px rgba(0,0,0,.08)` — pressed / inset surfaces
- `--shadow-inset-header: inset 0 0 2px rgba(0,0,0,.18)` — table head / dense header

**Spacing:** informal 4/8/12/16/24/32/48 scale. Panel padding is `32px` desktop, `20px` mobile. Card grids use `12px` gutters; dense grids `8px`.

**Layout:** main content clamps to `min(1184px, 100% - 48px)`, vertical rhythm `24px` between sections (`16px` on mobile).

## 6. Components — canonical recipes

### Pill button (primary)
`min-height: 52px`, `padding: 12px 20px`, `border-radius: pill`, background `--color-mint`, text `--color-ink`, shadow `--shadow-card`. Hover → `--color-mint-light`. Focus ring: `outline: 2px solid --color-ink; outline-offset: 2px`.

### Pill button (ghost)
Same sizing, `background: --color-surface`, `border: 1px solid --color-border`. Hover → `--color-surface-muted`.

### Metric card
White surface, `border-radius: md`, `padding: 24px`, `min-height: 128px`. Label (mono uppercase) top, value (sans 32/40 bold) bottom. Subtle hover lift `translateY(-1px)`.

### Dense metric card (`--small`)
`padding: 16px`, `min-height: 92px`, value `22/28`. Used in table-count grids.

### Health card
White surface, `radius: md`, `padding: 24px`, grid of header + `<dl>` meta-list + details paragraph. Badge pill sits top-right.

### Health badge
Pill, mono, uppercase, tracked. Three status variants using `--color-status-*` pairs. Never a fourth.

### Panel (logsPanel / healthPanel)
White surface, `radius: md`, `padding: 32px`, with `.panelTitleRow` (title + meta description) above content.

### Table
Wrapped in `.tableWrap` (bordered rounded-sm container). Header mono uppercase on `--color-surface-muted`, cells mono. Hover row tint = `--color-canvas`.

### Uptime / progress bar
Track `--color-surface-muted`, 8px tall, pill radius. Fill uses functional status colors — healthy is mint, lagging is warn, stale/no-data is err.

## 7. Iconography

FastAuth currently ships **no icon set** — and that is intentional. The interface relies on:
- numbers (mono, large),
- short text labels,
- status pills (color + word),
- a dotted underline on links instead of an external-link glyph.

If icons become necessary, use **Lucide** at 16px / 1.5px stroke, `currentColor`, never filled. Ask before introducing them.

## 8. Motion

Short and functional only.

- Default ease: `ease` (CSS keyword)
- Hover/state changes: `120–160ms`
- Bar fills & progressive reveals: `220ms`
- No springs, no scroll-linked animations, no staggered entrances.
- `transform: translateY(-1px)` on card hover is the only decorative motion.

## 9. Accessibility

- Focus ring on all interactive elements: `outline: 2px solid --color-ink; outline-offset: 2px`.
- Link affordance in body text is a dotted underline that goes solid mint on hover.
- Minimum text size 13px (mono meta). Metric labels are 11–12px **because they're mono uppercase** — do not shrink sans below 13px.
- Health badges always pair color with a text label; color alone never conveys state.

## 10. Opinion on the existing Metrics Dashboard

Short version: **the system is good, the page using it is overloaded.** Specifics:

**What's working**
- The restrained palette (one mint accent + warm neutrals) reads as operator-grade. Feels like a Bloomberg terminal in the right way.
- Mono for numbers/hashes/labels is the correct call and gives the UI its character.
- Token hygiene in `globals.css` is genuinely solid — tokens are named by role, not by value.

**What's not**
- **Card inflation.** Nine *Transactions overview* cards (`Signed 24h/7d/30d`, `Failed 24h/7d/30d`, `Total 24h/7d/30d`) plus seven *Accounts* cards is a 16-number wall. This is a table pretending to be cards. Pivot it — rows = metric, columns = window (24h / 7d / 30d), one card per metric.
- **Hierarchy is flat.** Every panel has the same weight. The two status cards at the top (Indexer lag, FastAuth Status) are the only things that should wake someone up at 3am; give them a bigger surface, a larger value, and push the grids below the fold.
- **Latest NEAR final block** is a full-width metric card living inside the transactions grid. It belongs up top next to *Indexer lag* — they are the same kind of signal.
- **Database tables** panel is debug output. Move it behind a "Developer" disclosure or a separate route; it doesn't belong on the main dashboard.
- **Tables are nowrap everywhere**, so they all scroll horizontally independently. Fine on desktop, painful on a 13" laptop. Consider column-priority + show/hide for the long ones (sign events has 13 columns).
- **No time control.** There's no "as of" selector or auto-refresh indicator. For a dashboard this live, a `Refreshes every Xs · Last: 14:03:12` strip under the topbar would ground every number on the page.
- **Kicker says "FASTAUTH METRICS DASHBOARD"** while the H1 says "Private peersyst.org access". The kicker should name the *view*, the H1 should name the *product*. Swap them.
- **Mint is unused on the dashboard itself.** It only shows up on the Logout button. A healthy indexer could briefly flash the mint uptime fill, and the primary "refresh / rerun" CTA could be mint — currently the page has no positive signal.

**Three concrete moves, ranked**
1. Collapse the nine transaction cards into three pivoted cards with 24h/7d/30d rows. Instantly halves visual noise.
2. Promote the two status cards: bigger surface, `24px → 32px` padding, value rendered at the metric-card size (`32/40`). Everything else gets smaller.
3. Add a top-right `Refreshing… · 14:03:12` indicator with a 4px mint dot when live. Gives the page a pulse and earns the mint.

None of these require new tokens — the system already supports them.
