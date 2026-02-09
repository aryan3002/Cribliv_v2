# Cribliv v2 UX Spec (Phase 1)

## Global

- Sticky trust-first header with language switcher
- Locale paths: `/en/*` and `/hi/*`
- Trust strip: verified owners + no-response refund + no-broker spam
- Legacy brand continuity (from existing Cribliv): primary `#0175FE`, brand-dark `#0158C7`, neutrals `#F5F5F7`, `#1D1D1F`, `#6E6E73`
- Font stack continuity: `Manrope` (body), `Raleway` (headings), `Montserrat` (accent CTAs)

## Page Map

- Homepage: hero search + city tiles
- City SEO page: localized landing intro and entry to filtered search
- Search results: URL-based filters and ranking badges
- Listing detail: trust panel and unlock CTA
- Shortlist: guest local + logged-in API sync
- Owner dashboard and listing wizard
- Owner verification flow (video + electricity)
- PG path segmentation page
- Admin queue page

## Search Interaction Model

- Route parser output: `{intent, route, filters, clarifying_question?}`
- Clarifying questions max: 2
- Fallback deterministic parser if router timeout >1200ms

## Accessibility and performance

- 44px tap targets
- Semantic labels and explicit validation text
- CLS-safe media placeholders
