# Listing Search Intent Rail Design

## Goal

Bring the homepage's natural-language search behavior to the Homes listing-results page without copying the homepage's map preview or large autocomplete-style panel.

## Chosen Interaction

The result-page search bar keeps the existing Homes/PG segmented control and Search action. While a person types, a compact rail beneath the input shows the recognized parts of the request as colored, removable chips:

- City or locality
- BHK
- Rent ceiling or range
- Furnishing
- Property type
- Amenity keyword

The rail also reports how many matching listings the recognized criteria currently produce. The existing filter panel remains visible and continues to be the detailed control surface.

## Behavior

1. The client loads the existing listing search dictionary and parses input with `parseQuery`.
2. Parsed chips appear as the query changes. A chip can be removed from the prospective search without changing filters already represented in the current URL.
3. A debounced count request uses the parsed criteria and the current search segment. It never mutates the displayed results until submit.
4. Submit replaces stale text and structured place/search criteria with parsed filters, preserves unrelated refinements such as sort and verified-only, and resets pagination.
5. A query that explicitly asks for a PG navigates to `/[locale]/pg`; a Flat/Home query navigates to `/[locale]/search`. The target surface encodes the property type, so `listing_type` is not retained in the URL.
6. Unrecognized remaining words are sent as `q`, including amenity words. A plain non-structured query therefore remains a keyword search.
7. Existing active-filter chips, filters, map handoff, and guest gating remain unchanged.

## Architecture

- `apps/web/lib/intent-search.ts` owns pure parsing-to-URL and parsing-to-count-request helpers.
- `apps/web/components/search/IntentSearchBar.tsx` owns input state, dictionary loading, chip presentation, chip removal, debounced count loading, and navigation.
- `apps/web/app/[locale]/search/page.tsx` mounts `IntentSearchBar` instead of the generic `SegmentedSearchBar`.
- `SegmentedSearchBar` remains the shared lightweight control for PG and other surfaces.

## Error Handling and Accessibility

- Dictionary and count failures silently retain typed search behavior; the rail still recognizes non-place filters.
- The rail exposes an `aria-live` summary for changes in parsed criteria and result count.
- Chip removal controls have explicit accessible labels.
- Requests are aborted when text or parsed criteria change to prevent stale counts.

## Verification

- Unit tests prove URL generation for Homes, PG, residual keywords, filter preservation, and count paths.
- Component tests prove chip rendering, removal, and form navigation.
- Focused web tests, typecheck, and a production build validate the integrated change.
