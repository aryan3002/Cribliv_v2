# Phase 1 Execution Plan (Weeks 1-2)

## Day-by-day

| Day | PM                           | Designer               | FE                                       | BE                                    | Output                   |
| --- | ---------------------------- | ---------------------- | ---------------------------------------- | ------------------------------------- | ------------------------ |
| 1   | Scope and KPI lock           | Brand token pass       | Monorepo bootstrap                       | API module scaffold                   | Repo operational         |
| 2   | Journey lock                 | Low-fi flow maps       | Homepage + hero search shell             | OTP send/verify + migration run       | Guest browse + OTP path  |
| 3   | Acceptance lock              | Search/listing high-fi | Search/listing pages + filters URL state | Search/listing APIs with ranking      | End-to-end browse/search |
| 4   | Monetization checks          | Wallet/unlock states   | OTP gate UI + shortlist                  | Contact unlock + idempotency          | Debit logic live         |
| 5   | Verification policy sign-off | Owner wizard UX        | Owner dashboard + wizard screens         | Owner CRUD + media upload APIs        | Owner draft flow         |
| 6   | Admin process                | Admin queue UX         | Admin pages                              | Verification processing + review APIs | Review loop complete     |
| 7   | Refund SLA tests             | Hindi copy QA          | i18n pass + perf cleanup                 | Refund worker + response endpoint     | Auto-refund running      |
| 8   | Analytics QA                 | Empty/error copy       | Event instrumentation                    | Event capture + audit logs            | Day-1 analytics complete |
| 9   | UAT run                      | Design QA fixes        | E2E smoke and bugfix                     | E2E support and bugfix                | Staging baseline         |
| 10  | Go/no-go                     | Final polish           | Release notes/docs                       | Deployment runbook                    | Phase 1 sign-off         |

## Definition of Done

- PRD, UX, architecture, schema, API are frozen in docs.
- `apps/web` and `apps/api` boot with seed/migration support.
- Core endpoints exist with auth/role and idempotency checks.
- Refund worker process exists and can execute scheduled sweep.
- CI workflow, PR template, env template, and seed files are in repo.
