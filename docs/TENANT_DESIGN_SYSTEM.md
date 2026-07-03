# Cribliv Tenant Design System

Source of truth: `/Users/aryantripathi/Downloads/Cribliv UI Kit/`.

Use these files before changing tenant-facing UI:

- `README.md` for the intended styling idiom.
- `_ds_manifest.json` for canonical tokens, fonts, templates, and components.
- `_adherence.oxlintrc.json` for guardrails.
- `templates/homepage-hero/HomepageHero.dc.html` for homepage hero/search/map composition.
- `templates/map-search/MapSearch.dc.html` for search results and map-preview behavior.
- `templates/listing-detail/ListingDetail.dc.html` for home and PG detail conversion pages.

Implementation rules:

- Use `@cribliv/ui` tokens, `Button`, and `Badge` where practical.
- Keep tenant styling scoped to public tenant classes and avoid owner/admin restyles.
- Prefer `var(--brand)`, `var(--accent)`, `var(--trust)`, `var(--surface)`, `var(--space-*)`, and `var(--radius-*)` over new raw values.
- Preserve existing routes, API contracts, search params, contact unlocks, PG interest flows, i18n, and SEO.
- Prototype visual language wins when static design conflicts with the old UI; current product behavior wins when the prototype is static-only.
