# Task 3 Report: Listings Management Route And Mobile Cards

## Status

Implemented the focused owner listings route at `/[locale]/owner/listings`, with status-filtered loading, retry, unauthorized sign-out handling, friendly localized owner errors, filtered empty states, create-listing entry, availability status updates, and boost modal wiring.

Implemented compact listing-card actions with a visible Edit/Fix action, mobile More actions dialog, verification and boost actions inside the sheet, and a labelled visible availability switch with 44px touch targets. Desktop inline actions remain available through the existing card action row.

## TDD Record

RED:

```bash
pnpm --filter @cribliv/web test -- components/owner/__tests__/owner-listings-client.test.tsx components/owner/__tests__/listing-card-luxe.mobile.test.tsx
```

Result: failed as expected. `OwnerListingsClient` was missing, More actions did not exist, availability was hidden/unlabelled, and rejected listings used `Fix & Resubmit`.

GREEN:

```bash
pnpm --filter @cribliv/web test -- components/owner/__tests__/owner-listings-client.test.tsx components/owner/__tests__/listing-card-luxe.mobile.test.tsx
```

Result: 2 files passed, 6 tests passed.

## Verification

```bash
pnpm --filter @cribliv/web test -- components/owner/__tests__/owner-listings-client.test.tsx components/owner/__tests__/listing-card-luxe.mobile.test.tsx
pnpm --filter @cribliv/web test -- components/owner/__tests__/lead-credit-balance-bar.test.tsx components/owner/__tests__/owner-overview-client.test.tsx components/owner/__tests__/workspace-shell.test.tsx components/owner/__tests__/lead-credits-panel.test.tsx components/owner/__tests__/lead-monetization-controls.test.tsx
pnpm --filter @cribliv/web typecheck
pnpm --filter @cribliv/web lint
```

Results: focused tests passed 6/6, affected owner tests passed 31/31, typecheck passed, lint exited 0.

## Notes

Lint still prints pre-existing warnings in unrelated files. The affected owner test run also prints an existing jsdom navigation warning in `lead-monetization-controls`; the suite exits 0.

## Review Fix: Recent Listing Edit Links

Issue: `OwnerOverviewClient` linked recent listing titles to `/${locale}/owner/listings/${listing.id}`, but that route does not exist. Typed Next route validation made this a production build blocker.

RED:

```bash
pnpm --filter @cribliv/web test -- components/owner/__tests__/owner-overview-client.test.tsx
```

Result: failed 1/12 tests. `links recent listing titles to the existing owner edit flow` expected `/en/owner/listings/new?edit=active-verified` and received `/en/owner/listings/active-verified`.

Fix: changed recent overview listing title links to `/${locale}/owner/listings/new?edit=${listing.id}` using the existing `Route` cast pattern. Also applied the same typed-route cast pattern to owner workspace nav links after `tsc --noEmit` exposed `components/owner/workspace-shell.tsx(80,7): Type 'string' is not assignable to type 'UrlObject | RouteImpl<string>'`.

GREEN and requested verification:

```bash
pnpm --filter @cribliv/web test -- components/owner/__tests__/owner-overview-client.test.tsx
```

Result: passed 1 file, 12 tests.

```bash
pnpm --filter @cribliv/web test -- components/owner/__tests__/owner-overview-client.test.tsx components/owner/__tests__/owner-listings-client.test.tsx components/owner/__tests__/listing-card-luxe.mobile.test.tsx
```

Result: passed 3 files, 18 tests.

```bash
pnpm --filter @cribliv/web typecheck
```

Result: passed after the typed-route casts.

```bash
pnpm --filter @cribliv/web build
```

Result: passed. Next.js compiled successfully, validated types, generated 50/50 static pages, and listed `/[locale]/owner/listings` plus `/[locale]/owner/listings/new`.
