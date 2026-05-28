# Implementation Complete — OTP Mock Mode + Role RBAC System

> Date: Feb 20, 2026 | All TypeScript checks: ✅ API zero errors | ✅ Web zero errors | Tests: 20/20 pass

---

## What Was Done

### 1. OTP Switched to Mock Mode — D7 Commented Out

**File changed:** `apps/api/src/modules/auth/auth.service.ts`

The D7 SMS block inside `sendOtpInMemory` and `verifyOtpInMemory` is now commented out
with clear instructions on re-enabling:

```
// D7 DISABLED FOR DEV — set OTP_PROVIDER=d7 in apps/api/.env to re-enable
// See D7_SETUP.md at the repo root for full instructions.
```

**How OTP works now (mock mode):**

1. `POST /auth/otp/send` → returns `{ challenge_id, dev_otp: "XXXXXX" }` in the response body
2. The login page shows a grey box: `[Dev] OTP: XXXXXX`
3. No SMS is ever sent — zero D7 API calls

**To switch to real SMS (D7):**

- Edit `apps/api/.env`: `OTP_PROVIDER=mock` → `OTP_PROVIDER=d7`
- See `D7_SETUP.md` for full guide

---

### 2. Full Role Management System — Production-Level RBAC

#### 2a. Seed Users (in-memory dev mode)

| Phone           | Role          | Notes                           |
| --------------- | ------------- | ------------------------------- |
| `+919999999901` | `owner`       | flat/house listings pre-seeded  |
| `+919999999902` | `tenant`      | 2 free credits                  |
| `+919999999903` | `admin`       | can approve role requests       |
| `+919999999904` | `pg_operator` | **NEW** — PG listing pre-seeded |

All seed users accept any 6-digit OTP (mock mode).

#### 2b. New Backend Endpoints

| Method  | Route                                  | Auth        | Description                              |
| ------- | -------------------------------------- | ----------- | ---------------------------------------- |
| `GET`   | `/v1/admin/users`                      | admin       | List all users, optional `?role=` filter |
| `PATCH` | `/v1/admin/users/:id/role`             | admin       | Hard-set any user's role                 |
| `GET`   | `/v1/admin/role-requests`              | admin       | List upgrade requests, `?status=pending` |
| `PATCH` | `/v1/admin/role-requests/:id/decision` | admin       | Approve or reject                        |
| `POST`  | `/v1/users/me/role-request`            | tenant only | Request upgrade to owner/pg_operator     |

#### 2c. Role Upgrade Flow (End-to-End)

```
1. Tenant logs in → lands on homepage with SessionBanner
2. SessionBanner shows a "List your property ↗" green button
3. Clicking navigates to /en/become-owner
4. Page shows 2 cards: Property Owner vs PG Operator
5. Tenant selects and clicks "Request access →"
6. POST /users/me/role-request { requested_role: "owner" }
7. Admin logs in (+919999999903) → visits /en/admin
8. Admin calls PATCH /admin/role-requests/:id/decision { decision: "approved" }
9. User's role is updated immediately in AppStateService
10. On next /auth/me call → new role is reflected in session
```

#### 2d. Frontend Changes

| File                                             | What Changed                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `apps/web/components/session-banner.tsx`         | Added "List your property ↗" green CTA for tenants                                                |
| `apps/web/app/[locale]/owner/dashboard/page.tsx` | Shows "Your PG Listings" header for pg_operator; differentiated empty state and "+ Add PG" button |
| `apps/web/app/[locale]/become-owner/page.tsx`    | **NEW** — role upgrade request page with owner vs pg_operator cards                               |
| `apps/web/lib/owner-api.ts`                      | Added `requestRoleUpgrade()` function                                                             |

#### 2e. AppStateService Changes

- Added `RoleRequestRecord` interface (exported)
- Added `roleRequests` and `roleRequestsByUser` maps
- Added seed `pg_operator` user (+919999999904) and their PG listing
- Added methods: `createRoleRequest`, `getPendingRoleRequest`, `decideRoleRequest`, `listRoleRequests`, `setUserRole`

---

### 3. RBAC Architecture (How it Works)

```
Request arrives at NestJS
    ↓
AuthGuard: extracts Bearer token → resolves user (in-memory or DB)
    ↓ sets req.user = { id, role }
RolesGuard: @Roles(...) decorator checks req.user.role
    ↓ if mismatch → 403 Forbidden
Controller handler executes
```

**Route protection summary:**

| Route prefix                | Backend guard                                                          | Allowed roles      |
| --------------------------- | ---------------------------------------------------------------------- | ------------------ |
| `/v1/owner/*`               | `@UseGuards(AuthGuard, RolesGuard)` + `@Roles("owner", "pg_operator")` | owner, pg_operator |
| `/v1/admin/*`               | `@UseGuards(AuthGuard, RolesGuard)` + `@Roles("admin")`                | admin              |
| `/v1/users/me/role-request` | `@Roles("tenant")`                                                     | tenant only        |
| Next.js `/en/owner/*`       | Edge middleware: `RolesGuard lookup`                                   | owner, pg_operator |
| Next.js `/en/admin/*`       | Edge middleware                                                        | admin              |

---

### 4. Test Results — 20/20 Pass

**File:** `apps/api/test/role-rbac.integration.test.ts`

Run: `cd apps/api && pnpm vitest run test/role-rbac.integration.test.ts`

| #     | Test                                                         | Result |
| ----- | ------------------------------------------------------------ | ------ |
| TC-01 | Mock OTP returns `dev_otp` in response (no D7 call)          | ✅     |
| TC-02 | New phone number → user created with `role=tenant`           | ✅     |
| TC-03 | New tenant receives 2 free credits on first login            | ✅     |
| TC-04 | `GET /auth/me` without token → 401                           | ✅     |
| TC-05 | Tenant access to `GET /owner/listings` → 403 Forbidden       | ✅     |
| TC-06 | Owner role can access `GET /owner/listings`                  | ✅     |
| TC-07 | PG operator role can access `GET /owner/listings`            | ✅     |
| TC-08 | Owner role cannot access `GET /admin/users` → 403            | ✅     |
| TC-09 | Tenant role cannot access `GET /admin/review/listings` → 403 | ✅     |
| TC-10 | Admin role can access `GET /admin/users`                     | ✅     |
| TC-11 | `GET /admin/users?role=tenant` returns only tenants          | ✅     |
| TC-12 | `PATCH /admin/users/:id/role` changes role immediately       | ✅     |
| TC-13 | Role change with invalid role → 400                          | ✅     |
| TC-14 | Tenant can submit role upgrade request → 201 pending         | ✅     |
| TC-15 | Tenant can request `pg_operator` role                        | ✅     |
| TC-16 | Duplicate pending request → 400 `already_pending`            | ✅     |
| TC-17 | `GET /admin/role-requests?status=pending` returns pending    | ✅     |
| TC-18 | Admin approves request → user role updated to owner          | ✅     |
| TC-19 | Admin rejects request → user role stays tenant               | ✅     |
| TC-20 | 5 wrong OTP attempts → challenge blocked                     | ✅     |

Existing test suite also unaffected: `phase1.integration.test.ts` 17/17 ✅

---

### 5. How to Manually Test the Role System

#### As a Tenant (new phone number)

1. Start API: `cd apps/api && pnpm dev`
2. Start Web: `cd apps/web && pnpm dev`
3. Visit `http://localhost:3000/en`
4. Click "Login / Sign up" → enter any `+91XXXXXXXXXX` number
5. Copy the `[Dev] OTP: XXXXXX` from the grey box
6. After login → you land on homepage with `SessionBanner` showing role=Tenant, 2 credits
7. Click "List your property ↗" → fills `/en/become-owner`
8. Select "Property Owner" or "PG Operator" → click Request Access

#### As Admin (to approve)

1. Login with `+919999999903` (admin seed phone)
2. Visit `http://localhost:4000/v1/admin/role-requests?status=pending` with Bearer token
3. Copy the `request_id`
4. `PATCH /v1/admin/role-requests/<id>/decision` `{ "decision": "approved" }`
5. Next login the user will have the new role

#### As Owner / PG Operator (seed accounts)

- Owner: login with `+919999999901` → goes to `/en/owner/dashboard` → sees "Your Listings"
- PG Operator: login with `+919999999904` → goes to `/en/owner/dashboard` → sees "Your PG Listings" + "Add PG" button

---

### 6. Files Changed This Session

**Backend (apps/api):**

- `src/modules/auth/auth.service.ts` — D7 block commented out; `requestRoleUpgrade()` added
- `src/modules/auth/auth.controller.ts` — `POST /users/me/role-request` endpoint added
- `src/modules/admin/admin.controller.ts` — 4 new role management endpoints added
- `src/common/app-state.service.ts` — `RoleRequestRecord` + `pg_operator` seed + role request methods
- `test/role-rbac.integration.test.ts` — **NEW** — 20 test cases

**Frontend (apps/web):**

- `components/session-banner.tsx` — "List your property ↗" CTA for tenants
- `app/[locale]/owner/dashboard/page.tsx` — owner vs pg_operator differentiation
- `app/[locale]/become-owner/page.tsx` — **NEW** — role upgrade request page
- `lib/owner-api.ts` — `requestRoleUpgrade()` added
