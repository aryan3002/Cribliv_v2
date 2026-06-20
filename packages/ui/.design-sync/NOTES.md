# design-sync notes — @cribliv/ui

Repo-specific gotchas for future syncs of this package. Append as you learn.

## Scope & target
- This package (`packages/ui`, `@cribliv/ui`) is a **minimal** design system: 2 components
  (`Button`, `Badge`) + a full token set (`src/tokens.ts` + `src/tokens.css`).
- It syncs to a **dedicated** Claude Design project **"Cribliv UI Kit"**
  (`9a68eef3-620f-443f-9d0e-aa98c9d5ac3b`).
- **Do NOT confuse** with the separate, much larger **"CribLiv Design System"** project
  (`b7ac0b2a-d043-4c2a-af53-607a50f56a72`, ~25 components: Avatar/Card/Modal/Tabs/MayaOrb/…).
  That one was **not** built by this sync tool (flat `components/<group>/<Name>.*` layout,
  group-level `*.card.html`, no `_ds_sync.json`/`_vendor/`/`_preview/`) and is unrelated to
  this repo's code. Never re-adopt it from here — syncing 2 components into it would delete the
  other ~23.

## Styling model (important)
- Components style **inline via the TS tokens object** (`import { color, space, … } from "../tokens"`).
  **No CSS classes, no `var(--*)` in component markup.** So there is no compiled component CSS to
  ship; styling travels in the JS bundle.
- `src/tokens.css` is a **parallel CSS-custom-properties mirror** of `src/tokens.ts` (same values).
  Shipped via `cfg.tokensGlob` so designs can also reference `var(--brand)` etc. and so the brand
  fonts are declared. `tsc` does NOT copy it to `dist/` — it's read from `src/`.

## Fonts (resolved)
- `tokens.css` declares `--font-heading: "Manrope"` / `--font-body: "Inter"`; components apply
  `fontFamily: typography.fontBody` inline. Neither ships an `@font-face` in the repo.
- **Resolved by self-hosting**: `.design-sync/fetch-fonts.mjs` downloads Inter (400/500/600/700) +
  Manrope (500/600/700/800), latin subset, from Google Fonts (OFL) into `.design-sync/fonts/`
  (woff2 + `cribliv-fonts.css`), matching `apps/web/app/layout.tsx` next/font config. Shipped via
  `cfg.extraFonts`. Re-run the fetch script only if the weight set changes.

## Build
- `dist/` is built by `tsc -p tsconfig.json` (`pnpm --filter @cribliv/ui build`). No workspace
  siblings to build first (only self-relative imports).

## Converter setup (re-sync gotchas)
- **`--node-modules ./node_modules`** (packages/ui's OWN), never `.ds-sync/node_modules`: the
  converter derives the workspace root from `dirname(--node-modules)`. Point it at `.ds-sync` and
  `src/tokens.css` + `tsconfig.json` are silently skipped as "outside the workspace root" (tokens
  vanish, `[CSS_RUNTIME]` fires).
- **react-dom symlink required.** `packages/ui` depends only on `react` (react-dom is a host-app
  peer), but the converter vendors React from `react-dom/umd`. Install `react@18.3.1 react-dom@18.3.1`
  into `.ds-sync/node_modules`, then symlink so the package node_modules resolves it:
  `ln -sfn ../.ds-sync/node_modules/react-dom node_modules/react-dom`. **Recreate on fresh clone.**
- **Tokens ship via `cfg.cssEntry: "src/tokens.css"`**, NOT `tokensGlob` — `tokensGlob` only selects
  files inside a node_modules `tokensPkg`; a package-relative source path is ignored by it. cssEntry's
  content is appended into `_ds_bundle.css`, which is in the `styles.css` import closure.
- Components land in group **`general`** (no docs → no category). Acceptable for 2 primitives; to
  regroup (e.g. Button→Forms, Badge→Feedback) add `cfg.docsMap` stubs with `category:` frontmatter.

## Render check
- Playwright **1.58.2** + chromium build **1208** installed at `~/Library/Caches/ms-playwright`
  (macOS path — NOT `~/.cache/ms-playwright`). Matches the repo's pinned `@playwright/test@1.58.2`.
- Both components use `cfg.overrides.<Name>.cardMode: "column"` — the 360px-wide card stories
  (Button `PrimaryCallToAction`, Badge `TrustSignals`/`ListingFeatures`/`VerificationStatus`) would
  otherwise trip `[GRID_OVERFLOW]`. This is a presentation choice, not a defect.

## Re-sync risks (what can go stale / what a future run must know)
- **Not a git repo** (the whole monorepo). The durable sync inputs under `.design-sync/`
  (config.json, NOTES.md, conventions.md, fetch-fonts.mjs, fonts/, previews/) are on disk but
  **uncommitted** — there's nowhere to commit them yet. Commit them once git is initialized.
- **Fonts are committed as woff2** in `.design-sync/fonts/`, so re-sync does NOT re-fetch. Only
  re-run `.design-sync/fetch-fonts.mjs` (needs network) if the weight set in `apps/web` changes or
  a new family is added to the tokens.
- **react-dom symlink + Playwright are machine-local / gitignored.** On a fresh clone, recreate the
  symlink (see Converter setup) and reinstall Playwright+chromium before the render check.
- **Grades live in `.design-sync/.cache/` (gitignored).** Cross-machine fast re-sync relies on the
  uploaded `_ds_sync.json` anchor — fetch it to `.design-sync/.cache/remote-sync.json` and pass
  `--remote` to `resync.mjs`, else everything re-verifies (correct, just slower).
- **conventions.md is hand-editable.** On re-sync, re-validate its enumerated tokens/props/components
  against the fresh build (every name was verified present at sync time) and report drift.
- The DS is tiny (2 components). If `src/` gains PascalCase exports they're picked up automatically;
  new components default to group `general` until a `docsMap` category is added.
- **Never re-adopt the separate "CribLiv Design System" project** (`b7ac0b2a-…`) from this repo.
