# SKILL — Building in FastAuth

How to ship a new surface in Peersyst's FastAuth design system without inventing anything.

## Starter recipe

```html
<link rel="stylesheet" href="tokens/colors_and_type.css">
<body class="ns-body">
  <main style="width: min(1184px, 100% - 48px); margin: 48px auto 88px; display: flex; flex-direction: column; gap: 24px;">
    <!-- topbar card -->
    <!-- sections: metric grids, health grids, panels -->
  </main>
</body>
```

## Hard rules
1. **Mint ≤1 per region.** Primary CTA, healthy fill, or one active badge. Never all three.
2. **Numbers, hashes, labels → mono.** Prose → sans. No exceptions.
3. **Everything on surface, surface on canvas.** Never invert.
4. **No icons** unless asked. Words and numbers carry meaning.
5. **No new colors.** If a state isn't covered by ok/warn/err/mint, leave it neutral.
6. **Pill buttons only**, 52px tall, one primary + one ghost.
7. **Card radius is 12px**, pill radius is 100px. Don't mix.
8. **Kicker names the view, H1 names the product** (the current dashboard has them swapped).

## Patterns

- **Dashboard page:** `.dashboardTopbar` → 1–2 wide `.healthCard`s → dense `.metricsGrid` → tabular `.panel`s.
- **Signed-in context:** topbar always shows email + Logout (ghost pill).
- **Empty state:** one plain sentence in `--color-ink-muted`. No illustration.
- **Number formatting:** `toLocaleString("en-US")`. Signed deltas → `+1,204`. Percentages → 1 decimal. Durations → `2h 14m`.

## When to pivot
If you find yourself building 6+ cards that share a dimension (e.g. the same metric over 24h/7d/30d), stop — that's a pivoted table, not a card grid.

## Checklist before shipping
- [ ] One mint element per viewport region
- [ ] All numbers in mono
- [ ] Focus ring on every interactive element (`2px solid --color-ink`, offset 2)
- [ ] Hover state on cards and buttons
- [ ] Mobile: cards reflow to `span 6` at ≤700px
- [ ] No emoji, no gradients, no glass, no icons
