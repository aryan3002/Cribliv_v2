# Contributing

## Branching

- Branch format: `codex/<ticket>-<short-name>`
- Keep branches short-lived and PR-focused.

## PR checklist

- Acceptance criteria coverage is documented.
- API contract updated when behavior changes.
- Migration included for schema changes.
- Tests and i18n keys updated.
- Analytics and audit impacts reviewed.

## Coding standards

- Thin controllers, service-layer business logic.
- Validate request DTOs at module boundaries.
- Use idempotency for credit and upload mutating flows.
- Do not log raw PII.
