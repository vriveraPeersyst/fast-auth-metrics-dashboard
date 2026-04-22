# NEAR Mint — Design System & Brand Guidelines

> Derived from the `landing_desk` Figma specification. This document codifies tokens, components, and usage rules so that web, docs, and marketing surfaces stay visually consistent.

---

## 1. Brand Foundation

### 1.1 Personality
NEAR Mint is **clean, confident, and community-first**. The visual language is calm (warm off-white canvas, generous whitespace), with a single high-energy accent (mint green) reserved for action and brand moments.

### 1.2 Logo
- **Mark**: 40×40 rounded square (`border-radius: 8px`) filled with a dark radial gradient.
  - Gradient: `radial-gradient(116.06% 93.36% at 50% 6.64%, #5C5C5C 0%, #000000 100%)`
  - Inner glyph: linear mint gradient `linear-gradient(42.01deg, #00F29B 24.29%, #92FFD8 101.37%)` with a `2px rgba(0,0,0,0.24)` stroke.
- **Wordmark**: "Near Mint", SF UI Text 700, 22/26, `letter-spacing: -0.01em`, color `#000000`.
- **Lockup**: mark + wordmark, `gap: 14px`, total footprint `161×40`.
- **Clearspace**: minimum equal to the mark's height (40 px) on all sides.

---

## 2. Color System

### 2.1 Core palette

| Token | Hex | Usage |
|---|---|---|
| `--color-canvas` | `#F5F4ED` | Page background, neutral cards |
| `--color-surface` | `#FFFFFF` | Cards, header bar, pills (inverse CTA) |
| `--color-surface-muted` | `#EBE9DF` | "How to" numbered step cards |
| `--color-border` | `#EBEBEB` | Card & header borders |
| `--color-border-subtle` | `#D6D4CB` | Footer divider |
| `--color-border-ring` | `#E1E0DA` | Decorative hero circles |
| `--color-ink` | `#000000` | Primary text, headings |
| `--color-ink-muted` | `#93928E` | Hero subtitle |
| `--color-ink-subtle` | `#757571` | Body copy inside cards |
| `--color-ink-translucent` | `rgba(0,0,0,0.48)` | Subtitle on mint background |

### 2.2 Accent — Brand Mint

| Token | Hex | Usage |
|---|---|---|
| `--color-mint` | `#00F29B` | Primary CTA, large brand section |
| `--color-mint-light` | `#92FFD8` | Gradient stop |
| `--color-mint-soft` | `#9CFFDB` | Hero orb gradient start |

**Primary CTA rule:** mint background, black text. The inverse (white pill on mint section) is used only once, inside the mint "Get started today" block.

### 2.3 Decorative accents (hero orbits only)
`#EF4949` (red), `#6A49EF` (violet), `#E7D217` (yellow). These colors are **decorative only** — never use them for text, status, or UI state.

### 2.4 Gradients
- **Logo mark** — `radial-gradient(116.06% 93.36% at 50% 6.64%, #5C5C5C 0%, #000000 100%)`
- **Hero orb (mint)** — `radial-gradient(116.06% 93.36% at 50% 6.64%, #9CFFDB 0%, #00F29B 100%)`
- **Glyph (mint)** — `linear-gradient(42.01deg, #00F29B 24.29%, #92FFD8 101.37%)`
- **Glyph (dark)** — `linear-gradient(42.01deg, #000000 24.03%, #BBB4B4 101.11%)`

---

## 3. Typography

### 3.1 Families
- **Primary**: `SF UI Text` — all UI and prose.
- **Mono**: `SF Mono` — italic, used only for the numeric step markers (1, 2, 3…).

### 3.2 Type scale

| Role | Family / Weight | Size / Line-height | Tracking | Example |
|---|---|---|---|---|
| Display / H1 | SF UI Text 700 | 40 / 64 | `-0.01em` | Hero headline, "Get started today" |
| Section H2 | SF UI Text 700 | 32 / 56 | `-0.01em` | "How to launch…", "Frequent answers" |
| Card title / H3 | SF UI Text 700 | 22 / 26 | `-0.01em` | Feature card titles, FAQ questions |
| Body L | SF UI Text 500 | 18 / 32 | `0` | Hero subtitle, CTA label lg |
| Body | SF UI Text 400 | 16 / 30 | `0` | Card paragraph copy |
| Nav / Button | SF UI Text 500 | 14 / 28 | `-0.01em` (button) | Header nav, small pill |
| Step number | SF Mono 700 italic | 20 / 32 | `0` | Numbered step circles |

### 3.3 Color pairing
- Headings → `--color-ink`.
- Body copy inside feature/FAQ cards → `--color-ink-subtle` (`#757571`).
- Hero lead paragraph → `--color-ink-muted` (`#93928E`).
- Subtitle on mint CTA → `rgba(0,0,0,0.48)`.

---

## 4. Spacing & Layout

### 4.1 Grid
- **Canvas width**: `1440px` with `padding: 48px 128px` → inner content width **`1184px`**.
- **Section stack gap**: `88px` between top-level sections on the landing page.
- **Outer canvas**: `border-radius: 24px`, background `--color-canvas`.

### 4.2 Spacing scale
Use multiples of 4; the design mainly draws from:

`4 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 32 · 48 · 88 · 112 · 128`

| Token | px | Typical use |
|---|---|---|
| `space-1` | 4 | Hairline adjustments |
| `space-2` | 8 | Tight text gap |
| `space-3` | 12 | Grid gap between cards, text gap |
| `space-4` | 16 | Card title → body |
| `space-5` | 20 | Header / FAQ card padding |
| `space-6` | 24 | Nav gap, section subheader gap |
| `space-8` | 32 | Card padding, step card gap |
| `space-12` | 48 | Canvas vertical padding, footer top padding |
| `space-22` | 88 | Top-level section gap |
| `space-28` | 112 | Hero column gap |
| `space-32` | 128 | Canvas horizontal padding, CTA block padding |

### 4.3 Radius

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 8 px | Logo mark, inner image frames |
| `radius-md` | 12 px | Cards, header bar, CTA block |
| `radius-lg` | 16 px | Card imagery top corners |
| `radius-xl` | 24 px | Outer canvas |
| `radius-pill` | 100 px | All pill-shaped buttons |
| `radius-orb` | 52–64 px | Decorative hero orbs |

### 4.4 Elevation

| Token | Shadow | Use |
|---|---|---|
| `shadow-card` | `0 0 8px rgba(0,0,0,0.08)` | Foreground card (z=2) |
| `shadow-inset-soft` | `inset 0 0 3px rgba(0,0,0,0.08)` | Stacked "echo" cards behind primary |
| `shadow-inset-header` | `inset 0 0 2px rgba(0,0,0,0.18)` | Stacked echo copies of the header bar |

**Stacking pattern (signature motif).** Cards and the header use a three-layer stack: the top card carries `shadow-card`; two echo copies sit behind with `shadow-inset-soft` and negative top margins (e.g. `-594px`, `-528px`, `-517px`, `-476px`, `-160px`, `-130px`) to create a subtle "card-shuffle" depth cue. Keep `z-index: 2 / 1 / 0` top-to-bottom.

---

## 5. Components

### 5.1 Header bar
- Height `84`, padding `16px 20px` (top copy) / `20px` (echo copies), background `#FFFFFF`, `border: 1px solid #EBEBEB`, `radius-md`.
- Contents: logo (left), nav (`Features · FAQ · Support`, gap `24`), small mint "Get started" pill (right).
- Stacking: primary `shadow-card`, echoes `shadow-inset-header` with `margin: -78px 0`.

### 5.2 Buttons (Pills)

| Variant | Size | Padding | BG | Text |
|---|---|---|---|---|
| Primary — small | 116×52 | `12 20` | `--color-mint` | Ink, 14/28 500, `-0.01em` |
| Primary — large | 147×72 | `20 24` | `--color-mint` | Ink, 18/32 500, `-0.01em` |
| Inverse — large | 176×72 | `20 24` | `--color-surface` | Ink, 18/32 500, `-0.01em` |

All pills: `border-radius: 100px`, `gap: 12px` between icon + label, centered content.

### 5.3 Feature card (white)
- `background: #FFFFFF`, `border: 1px solid #EBEBEB`, `radius-md`, `shadow-card`.
- Padding `32px 32px 0` (content sits flush to bottom imagery).
- Internal gap `16px` between title → body → image frame.
- Image frame: `border: 1px solid rgba(0,0,0,0.08)`, `border-radius: 16px 16px 0 0`.
- Participates in the 3-layer stacking motif (see §4.4).

### 5.4 Step card (numbered)
- `background: #EBE9DF`, `border-radius: 12px`, `padding: 32px`, `gap: 32px`.
- Number badge: 48×48 circle, `background: #FFFFFF`, `border-radius: 100px`, houses **SF Mono 700 italic 20/32**.
- Widths used: `586` (wide, 2-up) and `386` (narrow, 3-up).

### 5.5 FAQ accordion row
- Card: `padding: 32px`, `gap: 32px`, `row` direction, `shadow-card`.
- Title (22/26 700) + body (16/30 400, `#757571`) stacked left; right-side toggle is a 48×48 circle of `#F5F4ED` containing a 20×20 plus icon (2 px strokes, `#000000`).
- Same 3-layer stacking motif as feature cards, with `margin: -160/-130px 0`.

### 5.6 CTA block ("Get started today")
- `width: 1184`, `height: 464`, `background: --color-mint`, `radius-md`, `padding: 128px`.
- Headline 40/64 700, subtitle 18/32 500 at `rgba(0,0,0,0.48)`.
- White inverse pill CTA on the left; decorative dark orb + ringed orbit group floats on the right (`top: calc(50% - 294px)`, offset `right: 59px`).

### 5.7 Footer
- Top border `1px solid #D6D4CB`, `padding-top: 48px`, `gap: 32`.
- Three columns: logo lockup · Product links · Contact links.
- Link labels use body 16/30 400, color `#757571`; column titles reuse card-title style (22/26 700).

### 5.8 Decorative orbits (hero & CTA)
- Outer ring: 424×424 circle, `1px` border (`#E1E0DA` on canvas, `rgba(0,0,0,0.1)` on mint).
- Three 22×22 dots placed at top-center, bottom-left, bottom-right positions on the ring.
- Larger surrounding ring: 572×586 with 29.68×29.68 dots.
- On canvas, dots use brand accents (`#EF4949`, `#6A49EF`, `#E7D217`); on mint, dots are `#FFFFFF`.

---

## 6. Iconography
- Grid: 20×20 viewport.
- Stroke weight: **2 px**, color `--color-ink`.
- Geometry: centered, with 15.62% inset for the plus strokes (matches spec).
- Container for list/FAQ icons: 48×48 pill circle filled with `--color-canvas` (`#F5F4ED`).

---

## 7. Imagery
- Product screenshots are inserted into the top of feature cards with `border-radius: 16px 16px 0 0` and a subtle `1px rgba(0,0,0,0.08)` border.
- For small screenshots inside larger frames, center horizontally (`left: calc(50% - W/2)`) on a `#F5F4ED` canvas panel so the screenshot appears to rest on the brand background.

---

## 8. Accessibility

- **Canvas + ink** (`#F5F4ED` / `#000000`) → contrast ≈ 19:1 ✅
- **Card + body text** (`#FFFFFF` / `#757571`) → contrast ≈ 4.8:1 — passes WCAG AA for body text. Do not use `#757571` below 16 px.
- **Hero subtitle** (`#F5F4ED` / `#93928E`) → ≈ 3.3:1 — acceptable only at 18 px/500 weight (large-text AA). Never use at < 18 px.
- **Mint CTA** (`#00F29B` / `#000000`) → ≈ 13:1 ✅. Do **not** place white or muted-ink text on mint; always use pure black.
- **Focus states** (not in spec, required for implementation): add a 2 px outline in `--color-ink` offset by 2 px on all pills and accordion rows.
- **Hit targets**: every pill is ≥ 52 px tall; keep nav link hit areas ≥ 44×44 by extending padding.

---

## 9. Design Tokens (implementation)

Drop into your Tailwind config or a CSS custom-property sheet.

```css
:root {
  /* color */
  --color-canvas: #F5F4ED;
  --color-surface: #FFFFFF;
  --color-surface-muted: #EBE9DF;
  --color-border: #EBEBEB;
  --color-border-subtle: #D6D4CB;
  --color-border-ring: #E1E0DA;
  --color-ink: #000000;
  --color-ink-muted: #93928E;
  --color-ink-subtle: #757571;
  --color-mint: #00F29B;
  --color-mint-light: #92FFD8;
  --color-mint-soft: #9CFFDB;

  /* radius */
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-pill: 100px;

  /* elevation */
  --shadow-card: 0 0 8px rgba(0, 0, 0, 0.08);
  --shadow-inset-soft: inset 0 0 3px rgba(0, 0, 0, 0.08);
  --shadow-inset-header: inset 0 0 2px rgba(0, 0, 0, 0.18);

  /* type */
  --font-sans: 'SF UI Text', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --font-mono: 'SF Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

### 9.1 Tailwind preset (excerpt)
```ts
export const nearMintTheme = {
  colors: {
    canvas: '#F5F4ED',
    surface: '#FFFFFF',
    'surface-muted': '#EBE9DF',
    ink: { DEFAULT: '#000000', muted: '#93928E', subtle: '#757571' },
    mint: { DEFAULT: '#00F29B', light: '#92FFD8', soft: '#9CFFDB' },
    border: { DEFAULT: '#EBEBEB', subtle: '#D6D4CB', ring: '#E1E0DA' },
  },
  borderRadius: { sm: '8px', md: '12px', lg: '16px', xl: '24px', pill: '100px' },
  boxShadow: {
    card: '0 0 8px rgba(0,0,0,0.08)',
    'inset-soft': 'inset 0 0 3px rgba(0,0,0,0.08)',
    'inset-header': 'inset 0 0 2px rgba(0,0,0,0.18)',
  },
  fontSize: {
    display: ['40px', { lineHeight: '64px', letterSpacing: '-0.01em', fontWeight: '700' }],
    h2: ['32px', { lineHeight: '56px', letterSpacing: '-0.01em', fontWeight: '700' }],
    h3: ['22px', { lineHeight: '26px', letterSpacing: '-0.01em', fontWeight: '700' }],
    'body-lg': ['18px', { lineHeight: '32px', fontWeight: '500' }],
    body: ['16px', { lineHeight: '30px', fontWeight: '400' }],
    nav: ['14px', { lineHeight: '28px', fontWeight: '500' }],
  },
};
```

---

## 10. Usage do / don't

**Do**
- Keep mint reserved for the primary CTA and one large brand block per page.
- Preserve the 3-layer card-stack motif for header, feature cards, and FAQ rows — it is a brand signature.
- Use `#757571` for body copy inside cards and `#93928E` only for hero-scale lead text.

**Don't**
- Don't tint text with the decorative accents (`#EF4949`, `#6A49EF`, `#E7D217`).
- Don't introduce new shadow styles — stick to the three defined tokens.
- Don't place pure-white text on mint. Always black ink, optionally at `rgba(0,0,0,0.48)` for subtitles.
- Don't change pill radius; `100px` is the brand shape for all buttons.
