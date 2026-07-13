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
