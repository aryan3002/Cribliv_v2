# Building with @cribliv/ui (Cribliv UI Kit)

@cribliv/ui is a small, **token-driven** React design system for Cribliv (verified rentals in
North India). Components are self-styling via inline styles computed from canonical design tokens —
there are **no CSS classes and no utility framework** (the app does not use Tailwind). Style through
component props and the exported tokens; never invent class names.

## Setup — no provider needed
Components render correctly with **no wrapper, theme provider, or context**. Import and use:

```jsx
import { Button, Badge } from "@cribliv/ui";

<Button variant="primary">Request to book</Button>
<Badge tone="verified">✓ Verified</Badge>
```

Load the kit's `styles.css` once so the brand `@font-face` rules (Inter, Manrope) and the CSS token
variables are available app-wide.

## Styling idiom — semantic props + tokens
Style components via their **semantic props**, and style your own layout with the **exported token
objects** (or the matching CSS variables).

- **Button** — `variant`: `"primary"` (coral `accent` — use ONE per screen), `"secondary"`
  (brand-blue outline), `"tertiary"` (text-only). Also accepts native `<button>` props (`onClick`,
  `disabled`, `type`) and `style`.
- **Badge** — `tone`: `"verified"` (green), `"pending"` (amber), `"brand"` (blue), `"neutral"`
  (grey), `"danger"` (red). Trust signals and listing metadata. Accepts `style`.

For spacing, surfaces, and type, read tokens from the kit rather than hardcoding values:

```jsx
import { color, space, radius, typography, shadow } from "@cribliv/ui";
```

- `color` — `brand` `#0066FF`, `accent` (coral) `#FF5A5F`, `trust`, `warning`, `danger`, `surface`,
  `surfaceSunken`, `textPrimary`, `textSecondary`, `border`, … (full set in `_ds_bundle.css`)
- `space` — 8pt grid: `s1`=4 `s2`=8 `s3`=12 `s4`=16 `s5`=20 `s6`=24 `s8`=32 … `s24`=96
- `radius` — `sm`=8 `md`=12 `lg`=20 `xl`=28 `full`=9999
- `typography` — `fontBody` (Inter), `fontHeading` (Manrope), `scale.{display,h1,h2,h3,h4,body,small,caption}`,
  `weight.{regular,medium,semibold,bold,extrabold}`
- `shadow` — `xs sm md lg xl brand card cardHover`

The same values exist as CSS custom properties from `styles.css`: `var(--brand)`, `var(--accent)`,
`var(--space-4)`, `var(--radius-md)`, `var(--font-body)`, `var(--shadow-card)`, …

## Where the truth lives
- `styles.css` — `:root` CSS variables + brand `@font-face` rules. Read before styling.
- `components/<group>/<Name>/<Name>.prompt.md` and `<Name>.d.ts` — per-component API and usage.

## Idiomatic example
```jsx
import { Button, Badge, color, space, radius, typography } from "@cribliv/ui";

function ListingCta() {
  return (
    <div style={{
      padding: space.s5,
      background: color.surface,
      border: `1px solid ${color.border}`,
      borderRadius: radius.lg,
      fontFamily: typography.fontBody
    }}>
      <div style={{ display: "flex", gap: space.s2, marginBottom: space.s3 }}>
        <Badge tone="verified">✓ Verified</Badge>
        <Badge tone="brand">Cribliv Assured</Badge>
      </div>
      <Button variant="primary" style={{ width: "100%" }}>Request to book</Button>
    </div>
  );
}
```
