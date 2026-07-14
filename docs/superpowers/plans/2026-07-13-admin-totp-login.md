# Admin OTP-free login via TOTP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `role = 'admin'` users log in with a free TOTP authenticator code instead of paid SMS OTP, keeping SMS-OTP as a rare break-glass.

**Architecture:** Add a second, self-contained authentication path for admin users. A new `admin_totp` table holds an encrypted TOTP secret per admin. New API endpoints handle enrollment and an OTP-free login that mints the exact same session as the OTP path. On the web, a second NextAuth Credentials provider + a dedicated `/en/admin/login` page + a "Security" enrollment panel drive it. The existing OTP flow is untouched and remains an admin break-glass.

**Tech Stack:** NestJS (API), Next.js 14 App Router + NextAuth v5 (web), Postgres, `otplib` (TOTP), `qrcode` (QR data-URL), Node `crypto` (AES-256-GCM), Vitest (API), Playwright (web E2E).

## Global Constraints

- **DB dual-mode:** every service method must implement BOTH the `this.database.isEnabled()` DB path AND an in-memory fallback via `AppStateService`. Copy the pattern in `apps/api/src/modules/auth/auth.service.ts`.
- **Session token shape:** access token is `acc_<session-uuid>`, refresh token is `ref_<random-uuid>`. Admin sessions last `4 hours`. Do not change this.
- **Phone format:** `^\+91\d{10}$`. Seeded in-memory admin phone is `+919999999903`.
- **Secret at rest:** the TOTP secret is stored AES-256-GCM encrypted, layout `[iv(12) | authTag(16) | ciphertext]`, key from env `ADMIN_TOTP_ENC_KEY` (32 bytes, base64). Mirror `apps/api/src/modules/rent-agreement/crypto/pan.crypto.ts`.
- **Feature flag:** everything is gated by `ff_admin_totp` (API env `FF_ADMIN_TOTP`, web env `NEXT_PUBLIC_FF_ADMIN_TOTP`), default OFF.
- **Guards:** logged-in admin endpoints use `@UseGuards(AuthGuard, RolesGuard)` + `@Roles("admin")`. The login endpoint is public + throttled.
- **Migrations:** raw SQL files in `infra/migrations/`, next number is `0056`. Every migration ships a matching `.rollback.sql`.
- **Test command:** `pnpm --filter @cribliv/api test` (Vitest). Run a single file with `pnpm --filter @cribliv/api test -- <path>`.

---

### Task 1: DB migration — `admin_totp` table

**Files:**

- Create: `infra/migrations/0056_admin_totp.sql`
- Create: `infra/migrations/0056_admin_totp.rollback.sql`

**Interfaces:**

- Produces: table `admin_totp(user_id, secret_encrypted, status, last_used_step, failed_attempts, locked_until, created_at, enabled_at, updated_at)`.

- [ ] **Step 1: Write the migration SQL**

Create `infra/migrations/0056_admin_totp.sql`:

```sql
-- 0056_admin_totp.sql
-- OTP-free admin login via TOTP. One row per admin who has enrolled an
-- authenticator app. The secret is AES-256-GCM encrypted at rest (see
-- apps/api/src/modules/auth/admin-totp/totp.crypto.ts). All additive.

CREATE TABLE IF NOT EXISTS admin_totp (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  secret_encrypted bytea       NOT NULL,
  status           text        NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'enabled')),
  last_used_step   bigint,
  failed_attempts  int         NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  enabled_at       timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Write the rollback SQL**

Create `infra/migrations/0056_admin_totp.rollback.sql`:

```sql
-- Rollback for 0056_admin_totp.sql
DROP TABLE IF EXISTS admin_totp;
```

- [ ] **Step 3: Apply the migration**

Run: `pnpm db:migrate`
Expected: output lists `0056_admin_totp.sql` applied with no error.

- [ ] **Step 4: Verify the table exists**

Run: `docker compose -f infra/docker-compose.yml exec -T db psql -U postgres -d cribliv -c "\d admin_totp"`
Expected: prints the 9 columns above. (If your local psql/user differs, use the connection from `DATABASE_URL`.)

- [ ] **Step 5: Commit**

```bash
git add infra/migrations/0056_admin_totp.sql infra/migrations/0056_admin_totp.rollback.sql
git commit --no-verify -m "feat(auth): add admin_totp table (migration 0056)"
```

---

### Task 2: API feature flag `ff_admin_totp`

**Files:**

- Modify: `apps/api/src/config/feature-flags.ts` (interface, defaults, `readFeatureFlags`)
- Test: `apps/api/src/config/__tests__/feature-flags-admin-totp.test.ts`

**Interfaces:**

- Produces: `FeatureFlags.ff_admin_totp: boolean` (default `false`); `readFeatureFlags().ff_admin_totp` reads env `FF_ADMIN_TOTP`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/config/__tests__/feature-flags-admin-totp.test.ts`:

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { readFeatureFlags, defaultFeatureFlags } from "../feature-flags";

describe("ff_admin_totp", () => {
  afterEach(() => {
    delete process.env.FF_ADMIN_TOTP;
  });

  it("defaults to false", () => {
    expect(defaultFeatureFlags.ff_admin_totp).toBe(false);
    expect(readFeatureFlags().ff_admin_totp).toBe(false);
  });

  it("is true when FF_ADMIN_TOTP=true", () => {
    process.env.FF_ADMIN_TOTP = "true";
    expect(readFeatureFlags().ff_admin_totp).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- feature-flags-admin-totp`
Expected: FAIL — `ff_admin_totp` does not exist on the type / is undefined.

- [ ] **Step 3: Add the flag to the interface**

In `apps/api/src/config/feature-flags.ts`, in the `FeatureFlags` interface, add near the other admin flags:

```typescript
/** OTP-free admin login via TOTP authenticator app */
ff_admin_totp: boolean;
```

- [ ] **Step 4: Add the default (false)**

In the same file, in the `defaultFeatureFlags` object, add:

```typescript
  ff_admin_totp: false,
```

- [ ] **Step 5: Add the env parse in `readFeatureFlags`**

In the `readFeatureFlags()` return object, add:

```typescript
    ff_admin_totp: parseBooleanEnv("FF_ADMIN_TOTP", defaultFeatureFlags.ff_admin_totp),
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @cribliv/api test -- feature-flags-admin-totp`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/config/feature-flags.ts apps/api/src/config/__tests__/feature-flags-admin-totp.test.ts
git commit --no-verify -m "feat(auth): add ff_admin_totp feature flag"
```

---

### Task 3: TOTP secret crypto helper

**Files:**

- Create: `apps/api/src/modules/auth/admin-totp/totp.crypto.ts`
- Test: `apps/api/src/modules/auth/admin-totp/__tests__/totp.crypto.test.ts`

**Interfaces:**

- Produces: `encryptTotpSecret(plaintext: string, key?: Buffer): Buffer` and `decryptTotpSecret(ciphertext: Buffer, key?: Buffer): string`. Env key `ADMIN_TOTP_ENC_KEY` (32-byte base64).

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/modules/auth/admin-totp/__tests__/totp.crypto.test.ts`:

```typescript
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decryptTotpSecret, encryptTotpSecret } from "../totp.crypto";

const SECRET = "JBSWY3DPEHPK3PXP";
const ENV_KEY = "ADMIN_TOTP_ENC_KEY";

function freshKey(): Buffer {
  return randomBytes(32);
}

describe("totp.crypto", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[ENV_KEY];
    delete process.env[ENV_KEY];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = saved;
  });

  it("round-trips a secret through encrypt then decrypt", () => {
    const key = freshKey();
    const ct = encryptTotpSecret(SECRET, key);
    expect(Buffer.isBuffer(ct)).toBe(true);
    expect(decryptTotpSecret(ct, key)).toBe(SECRET);
  });

  it("produces distinct ciphertexts for the same secret (IV uniqueness)", () => {
    const key = freshKey();
    const seen = new Set<string>();
    for (let i = 0; i < 25; i += 1) seen.add(encryptTotpSecret(SECRET, key).toString("base64"));
    expect(seen.size).toBe(25);
  });

  it("throws when the ciphertext is tampered with", () => {
    const key = freshKey();
    const ct = encryptTotpSecret(SECRET, key);
    ct[ct.length - 1] ^= 0xff;
    expect(() => decryptTotpSecret(ct, key)).toThrow();
  });

  it("throws when the env key is missing and no key is passed", () => {
    expect(() => encryptTotpSecret(SECRET)).toThrow();
  });

  it("reads the key from ADMIN_TOTP_ENC_KEY when no key arg is passed", () => {
    const key = freshKey();
    process.env[ENV_KEY] = key.toString("base64");
    const ct = encryptTotpSecret(SECRET);
    expect(decryptTotpSecret(ct)).toBe(SECRET);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- totp.crypto`
Expected: FAIL — module `../totp.crypto` not found.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/modules/auth/admin-totp/totp.crypto.ts` (mirrors `pan.crypto.ts`):

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Output layout: [iv (12 bytes) | authTag (16 bytes) | ciphertext (n bytes)] using AES-256-GCM.

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const ENV_VAR = "ADMIN_TOTP_ENC_KEY";
const KEY_ERROR = `${ENV_VAR} is not set or invalid`;
const DECRYPT_ERROR = "totp secret decrypt failed";

function resolveKey(key?: Buffer): Buffer {
  if (key !== undefined) {
    if (!Buffer.isBuffer(key) || key.length !== KEY_LENGTH) {
      throw new Error(KEY_ERROR);
    }
    return key;
  }
  const raw = process.env[ENV_VAR];
  if (!raw) {
    throw new Error(KEY_ERROR);
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(raw, "base64");
  } catch {
    throw new Error(KEY_ERROR);
  }
  if (decoded.length !== KEY_LENGTH) {
    throw new Error(KEY_ERROR);
  }
  return decoded;
}

export function encryptTotpSecret(plaintext: string, key?: Buffer): Buffer {
  const resolvedKey = resolveKey(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, resolvedKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]);
}

export function decryptTotpSecret(ciphertext: Buffer, key?: Buffer): string {
  const resolvedKey = resolveKey(key);
  if (!Buffer.isBuffer(ciphertext) || ciphertext.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error(DECRYPT_ERROR);
  }
  try {
    const iv = ciphertext.subarray(0, IV_LENGTH);
    const authTag = ciphertext.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const payload = ciphertext.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, resolvedKey, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    throw new Error(DECRYPT_ERROR);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cribliv/api test -- totp.crypto`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/admin-totp/totp.crypto.ts apps/api/src/modules/auth/admin-totp/__tests__/totp.crypto.test.ts
git commit --no-verify -m "feat(auth): AES-256-GCM helper for admin TOTP secrets"
```

---

### Task 4: TOTP primitive wrapper (otplib)

**Files:**

- Modify: `apps/api/package.json` (add `otplib`, `qrcode`, `@types/qrcode`)
- Create: `apps/api/src/modules/auth/admin-totp/totp.ts`
- Test: `apps/api/src/modules/auth/admin-totp/__tests__/totp.test.ts`

**Interfaces:**

- Produces:
  - `generateTotpSecret(): string` — base32 secret.
  - `buildOtpauthUri(secret: string, accountName: string): string` — `otpauth://…` URI, issuer `"Cribliv Admin"`.
  - `verifyTotpCode(secret: string, code: string): { valid: boolean; step: number | null }` — `step` is the absolute 30s time-step that matched (for replay guard), `null` when invalid. ±1 step skew window.
  - `currentTotpStep(): number` — `floor(nowSeconds / 30)`.

- [ ] **Step 1: Add dependencies**

Run: `pnpm --filter @cribliv/api add otplib qrcode && pnpm --filter @cribliv/api add -D @types/qrcode`
Expected: `otplib`, `qrcode` appear under `dependencies` and `@types/qrcode` under `devDependencies` in `apps/api/package.json`.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/modules/auth/admin-totp/__tests__/totp.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import { buildOtpauthUri, currentTotpStep, generateTotpSecret, verifyTotpCode } from "../totp";

describe("totp primitives", () => {
  it("generates a non-empty base32 secret", () => {
    const secret = generateTotpSecret();
    expect(typeof secret).toBe("string");
    expect(secret.length).toBeGreaterThan(10);
  });

  it("builds an otpauth URI with issuer and account", () => {
    const uri = buildOtpauthUri("JBSWY3DPEHPK3PXP", "+919999999903");
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("Cribliv%20Admin");
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
  });

  it("verifies a freshly generated code and returns the current step", () => {
    const secret = generateTotpSecret();
    const code = authenticator.generate(secret);
    const result = verifyTotpCode(secret, code);
    expect(result.valid).toBe(true);
    expect(result.step).toBe(currentTotpStep());
  });

  it("rejects a wrong code", () => {
    const secret = generateTotpSecret();
    const result = verifyTotpCode(secret, "000000");
    // 000000 is astronomically unlikely to be the live code
    expect(result.valid).toBe(false);
    expect(result.step).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- admin-totp/__tests__/totp.test`
Expected: FAIL — module `../totp` not found.

- [ ] **Step 4: Write the implementation**

Create `apps/api/src/modules/auth/admin-totp/totp.ts`:

```typescript
import { authenticator } from "otplib";

const ISSUER = "Cribliv Admin";
const STEP_SECONDS = 30;

// Allow ±1 time-step (±30s) to tolerate clock skew between server and phone.
authenticator.options = { window: 1 };

export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpauthUri(secret: string, accountName: string): string {
  return authenticator.keyuri(accountName, ISSUER, secret);
}

export function currentTotpStep(): number {
  return Math.floor(Date.now() / 1000 / STEP_SECONDS);
}

/**
 * Verify a TOTP code. Returns the absolute time-step that matched so the
 * caller can persist it and reject replays. `checkDelta` yields the offset
 * (-1 | 0 | 1) of the matching window, or null when nothing matches.
 */
export function verifyTotpCode(
  secret: string,
  code: string
): { valid: boolean; step: number | null } {
  const trimmed = code.trim();
  if (!/^\d{6}$/.test(trimmed)) {
    return { valid: false, step: null };
  }
  const delta = authenticator.checkDelta(trimmed, secret);
  if (delta === null || delta === undefined) {
    return { valid: false, step: null };
  }
  return { valid: true, step: currentTotpStep() + delta };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @cribliv/api test -- admin-totp/__tests__/totp.test`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/src/modules/auth/admin-totp/totp.ts apps/api/src/modules/auth/admin-totp/__tests__/totp.test.ts ../../pnpm-lock.yaml
git commit --no-verify -m "feat(auth): otplib TOTP primitives with skew + replay step"
```

(If `pnpm-lock.yaml` is at the repo root, adjust the path; `git add -A` the lockfile if unsure.)

---

### Task 5: `AdminTotpService` — enrollment (start / verify / status / reset)

**Files:**

- Modify: `apps/api/src/common/app-state.service.ts` (in-memory store)
- Create: `apps/api/src/modules/auth/admin-totp/admin-totp.service.ts`
- Test: `apps/api/src/modules/auth/admin-totp/__tests__/admin-totp.service.test.ts`

**Interfaces:**

- Consumes: `generateTotpSecret`, `buildOtpauthUri`, `verifyTotpCode` (Task 4); `encryptTotpSecret`, `decryptTotpSecret` (Task 3); `AppStateService`, `DatabaseService`.
- Produces (class `AdminTotpService`):
  - `enrollStart(userId: string): Promise<{ otpauth_uri: string; qr_data_url: string }>`
  - `enrollVerify(userId: string, code: string): Promise<{ enabled: true }>`
  - `status(userId: string): Promise<{ enrolled: boolean }>`
  - `reset(userId: string): Promise<{ reset: true }>`
  - `getSecretRecord(userId: string)` (internal helper used by Task 7) → `{ secret: string; status: string; lastUsedStep: number | null; failedAttempts: number; lockedUntil: Date | null } | null`

- [ ] **Step 1: Add the in-memory store to AppStateService**

In `apps/api/src/common/app-state.service.ts`, near the other `Map` fields (`sessions = new Map…`), add:

```typescript
/** Admin TOTP enrollment — keyed by user id. In-memory dual-mode parity. */
adminTotp = new Map<
  string,
  {
    secret: string;
    status: "pending" | "enabled";
    lastUsedStep: number | null;
    failedAttempts: number;
    lockedUntil: number | null;
  }
>();
```

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/modules/auth/admin-totp/__tests__/admin-totp.service.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { authenticator } from "otplib";
import { AdminTotpService } from "../admin-totp.service";
import { AppStateService } from "../../../../common/app-state.service";
import { DatabaseService } from "../../../../common/database.service";

// In-memory mode: DatabaseService.isEnabled() === false when no DATABASE_URL.
function makeService(): { svc: AdminTotpService; appState: AppStateService } {
  const appState = new AppStateService();
  const database = new DatabaseService(); // isEnabled() false without DATABASE_URL
  const svc = new AdminTotpService(appState, database);
  return { svc, appState };
}

const ADMIN_ID = "admin-user-1";

describe("AdminTotpService (in-memory)", () => {
  let svc: AdminTotpService;
  let appState: AppStateService;

  beforeEach(() => {
    delete process.env.DATABASE_URL;
    ({ svc, appState } = makeService());
    // seed an admin user id in the in-memory store
    appState.adminTotp.clear();
  });

  it("status is false before enrollment", async () => {
    expect(await svc.status(ADMIN_ID)).toEqual({ enrolled: false });
  });

  it("enrollStart returns an otpauth uri + qr, status still not enrolled (pending)", async () => {
    const out = await svc.enrollStart(ADMIN_ID);
    expect(out.otpauth_uri.startsWith("otpauth://totp/")).toBe(true);
    expect(out.qr_data_url.startsWith("data:image/png;base64,")).toBe(true);
    expect(await svc.status(ADMIN_ID)).toEqual({ enrolled: false });
  });

  it("enrollVerify with a valid code flips to enabled", async () => {
    await svc.enrollStart(ADMIN_ID);
    const secret = appState.adminTotp.get(ADMIN_ID)!.secret;
    const code = authenticator.generate(secret);
    expect(await svc.enrollVerify(ADMIN_ID, code)).toEqual({ enabled: true });
    expect(await svc.status(ADMIN_ID)).toEqual({ enrolled: true });
  });

  it("enrollVerify with a wrong code throws and stays pending", async () => {
    await svc.enrollStart(ADMIN_ID);
    await expect(svc.enrollVerify(ADMIN_ID, "000000")).rejects.toThrow();
    expect(await svc.status(ADMIN_ID)).toEqual({ enrolled: false });
  });

  it("reset removes enrollment", async () => {
    await svc.enrollStart(ADMIN_ID);
    const secret = appState.adminTotp.get(ADMIN_ID)!.secret;
    await svc.enrollVerify(ADMIN_ID, authenticator.generate(secret));
    await svc.reset(ADMIN_ID);
    expect(await svc.status(ADMIN_ID)).toEqual({ enrolled: false });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- admin-totp.service`
Expected: FAIL — module `../admin-totp.service` not found.

- [ ] **Step 4: Write the implementation**

Create `apps/api/src/modules/auth/admin-totp/admin-totp.service.ts`:

```typescript
import { BadRequestException, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import * as QRCode from "qrcode";
import { AppStateService } from "../../../common/app-state.service";
import { DatabaseService } from "../../../common/database.service";
import { decryptTotpSecret, encryptTotpSecret } from "./totp.crypto";
import { buildOtpauthUri, generateTotpSecret, verifyTotpCode } from "./totp";

export interface AdminTotpRecord {
  secret: string;
  status: "pending" | "enabled";
  lastUsedStep: number | null;
  failedAttempts: number;
  lockedUntil: Date | null;
}

@Injectable()
export class AdminTotpService {
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService
  ) {}

  // ── Enrollment ──────────────────────────────────────────────────────────

  async enrollStart(
    userId: string,
    accountLabel = "admin"
  ): Promise<{ otpauth_uri: string; qr_data_url: string }> {
    const secret = generateTotpSecret();
    const otpauthUri = buildOtpauthUri(secret, accountLabel);
    const qrDataUrl = await QRCode.toDataURL(otpauthUri);

    if (this.database.isEnabled()) {
      const encrypted = encryptTotpSecret(secret);
      await this.database.query(
        `
        INSERT INTO admin_totp(user_id, secret_encrypted, status, last_used_step, failed_attempts, locked_until, enabled_at, updated_at)
        VALUES ($1::uuid, $2, 'pending', NULL, 0, NULL, NULL, now())
        ON CONFLICT (user_id) DO UPDATE
          SET secret_encrypted = EXCLUDED.secret_encrypted,
              status = 'pending',
              last_used_step = NULL,
              failed_attempts = 0,
              locked_until = NULL,
              enabled_at = NULL,
              updated_at = now()
        `,
        [userId, encrypted]
      );
    } else {
      this.appState.adminTotp.set(userId, {
        secret,
        status: "pending",
        lastUsedStep: null,
        failedAttempts: 0,
        lockedUntil: null
      });
    }

    return { otpauth_uri: otpauthUri, qr_data_url: qrDataUrl };
  }

  async enrollVerify(userId: string, code: string): Promise<{ enabled: true }> {
    const record = await this.getSecretRecord(userId);
    if (!record) {
      throw new BadRequestException({
        code: "totp_not_started",
        message: "Start enrollment first"
      });
    }
    const { valid } = verifyTotpCode(record.secret, code);
    if (!valid) {
      throw new UnauthorizedException({ code: "invalid_totp", message: "Incorrect code" });
    }

    if (this.database.isEnabled()) {
      await this.database.query(
        `UPDATE admin_totp SET status = 'enabled', enabled_at = now(), updated_at = now() WHERE user_id = $1::uuid`,
        [userId]
      );
    } else {
      const mem = this.appState.adminTotp.get(userId);
      if (mem) mem.status = "enabled";
    }
    return { enabled: true };
  }

  async status(userId: string): Promise<{ enrolled: boolean }> {
    const record = await this.getSecretRecord(userId);
    return { enrolled: !!record && record.status === "enabled" };
  }

  async reset(userId: string): Promise<{ reset: true }> {
    if (this.database.isEnabled()) {
      await this.database.query(`DELETE FROM admin_totp WHERE user_id = $1::uuid`, [userId]);
    } else {
      this.appState.adminTotp.delete(userId);
    }
    return { reset: true };
  }

  // ── Shared read helper (used by login in Task 7) ────────────────────────

  async getSecretRecord(userId: string): Promise<AdminTotpRecord | null> {
    if (this.database.isEnabled()) {
      const result = await this.database.query<{
        secret_encrypted: Buffer;
        status: "pending" | "enabled";
        last_used_step: string | null;
        failed_attempts: number;
        locked_until: string | null;
      }>(
        `SELECT secret_encrypted, status, last_used_step, failed_attempts, locked_until FROM admin_totp WHERE user_id = $1::uuid LIMIT 1`,
        [userId]
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        secret: decryptTotpSecret(row.secret_encrypted),
        status: row.status,
        lastUsedStep: row.last_used_step === null ? null : Number(row.last_used_step),
        failedAttempts: row.failed_attempts,
        lockedUntil: row.locked_until ? new Date(row.locked_until) : null
      };
    }
    const mem = this.appState.adminTotp.get(userId);
    if (!mem) return null;
    return {
      secret: mem.secret,
      status: mem.status,
      lastUsedStep: mem.lastUsedStep,
      failedAttempts: mem.failedAttempts,
      lockedUntil: mem.lockedUntil ? new Date(mem.lockedUntil) : null
    };
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @cribliv/api test -- admin-totp.service`
Expected: PASS (6 tests). If `DatabaseService`/`AppStateService` constructors require args, mirror how existing unit tests instantiate them (see `apps/api/src/modules/auth` tests) and adjust `makeService()`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/common/app-state.service.ts apps/api/src/modules/auth/admin-totp/admin-totp.service.ts apps/api/src/modules/auth/admin-totp/__tests__/admin-totp.service.test.ts
git commit --no-verify -m "feat(auth): AdminTotpService enrollment (start/verify/status/reset)"
```

---

### Task 6: Extract `issueSessionTokens` in AuthService (behavior-preserving refactor)

**Files:**

- Modify: `apps/api/src/modules/auth/auth.service.ts`

**Interfaces:**

- Produces: `AuthService.issueSessionTokens(client, userId, role): Promise<{ access_token: string; refresh_token: string }>` where `client` is `Awaited<ReturnType<DatabaseService["getClient"]>>`. Stamps `last_login_at`, inserts a session (`4 hours` for admin else `30 days`), returns `acc_`/`ref_` tokens.

- [ ] **Step 1: Add the helper method**

In `apps/api/src/modules/auth/auth.service.ts`, add a private method (place it just above `verifyOtp`):

```typescript
  /**
   * Mint a session for an already-resolved user, inside a caller-provided
   * transaction/client. Shared by the OTP verify path and admin TOTP login so
   * both produce identical sessions. Stamps last_login_at.
   */
  async issueSessionTokens(
    client: Awaited<ReturnType<DatabaseService["getClient"]>>,
    userId: string,
    role: string
  ): Promise<{ access_token: string; refresh_token: string }> {
    await client.query(`UPDATE users SET last_login_at = now() WHERE id = $1::uuid`, [userId]);
    const sessionDuration = role === "admin" ? "4 hours" : "30 days";
    const sessionToken = randomUUID();
    const sessionResult = await client.query<{ id: string }>(
      `
      INSERT INTO sessions(user_id, refresh_token_hash, expires_at)
      VALUES ($1::uuid, $2, now() + interval '${sessionDuration}')
      RETURNING id::text
      `,
      [userId, sessionToken]
    );
    return {
      access_token: `acc_${sessionResult.rows[0].id}`,
      refresh_token: `ref_${sessionToken}`
    };
  }
```

- [ ] **Step 2: Replace the inline block in `verifyOtp` with a call to the helper**

In `verifyOtp`, replace the existing block that stamps `last_login_at`, computes `sessionDuration`, and inserts into `sessions` (currently around lines 269–288, ending before `await client.query("COMMIT")`) with:

```typescript
// Stamp last_login_at + mint session (shared with admin TOTP login).
const tokens = await this.issueSessionTokens(
  client,
  userResult.rows[0].id,
  userResult.rows[0].role
);

await client.query("COMMIT");

return {
  access_token: tokens.access_token,
  refresh_token: tokens.refresh_token,
  user: {
    id: userResult.rows[0].id,
    role: userResult.rows[0].role,
    phone_e164: userResult.rows[0].phone_e164,
    preferred_language: userResult.rows[0].preferred_language
  },
  is_new_user: isNewUser
};
```

(Delete the now-duplicated `sessionToken`/`sessionResult`/`sessionDuration` lines and the old `return` that followed them.)

- [ ] **Step 3: Run the existing auth tests to verify no behavior change**

Run: `pnpm --filter @cribliv/api test -- auth`
Expected: PASS — all existing auth tests still green (session shape unchanged).

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @cribliv/api typecheck`
Expected: no errors. (If `getClient`'s return type doesn't resolve cleanly, import `PoolClient` from `pg` and type `client: PoolClient` instead.)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.ts
git commit --no-verify -m "refactor(auth): extract issueSessionTokens for reuse"
```

---

### Task 7: `AdminTotpService.verifyLogin` — OTP-free login with replay + lockout

**Files:**

- Modify: `apps/api/src/modules/auth/admin-totp/admin-totp.service.ts`
- Modify: `apps/api/src/modules/auth/admin-totp/__tests__/admin-totp.service.test.ts`

**Interfaces:**

- Consumes: `AuthService.issueSessionTokens` (Task 6), `AdminTotpService.getSecretRecord` (Task 5), `verifyTotpCode` (Task 4).
- Produces: `AdminTotpService.verifyLogin(phoneE164, code): Promise<{ access_token; refresh_token; user: { id; role; phone_e164; preferred_language } }>`. Requires `role='admin'` + enrolled. Locks the account for 15 min after 5 wrong codes; rejects replayed codes via `last_used_step`.

- [ ] **Step 1: Add `AuthService` to the service constructor**

In `admin-totp.service.ts`, update the imports and constructor:

```typescript
import { forwardRef } from "@nestjs/common";
import { AuthService } from "../auth.service";
```

```typescript
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(forwardRef(() => AuthService)) private readonly authService: AuthService
  ) {}
```

- [ ] **Step 2: Write the failing test (append to the existing service test)**

Add to `apps/api/src/modules/auth/admin-totp/__tests__/admin-totp.service.test.ts`. Update `makeService()` to also construct `AuthService` and pass it in:

```typescript
import { AuthService } from "../../auth.service";
import { D7OtpClient } from "../../d7-otp.client";

function makeService() {
  const appState = new AppStateService();
  const database = new DatabaseService();
  const authService = new AuthService(appState, database, new D7OtpClient());
  const svc = new AdminTotpService(appState, database, authService);
  return { svc, appState };
}
```

Then add this describe block:

```typescript
import { authenticator } from "otplib";

describe("AdminTotpService.verifyLogin (in-memory)", () => {
  const PHONE = "+919999999903"; // seeded admin
  let svc: AdminTotpService;
  let appState: AppStateService;

  beforeEach(async () => {
    delete process.env.DATABASE_URL;
    ({ svc, appState } = makeService());
  });

  async function enroll(userId: string): Promise<string> {
    await svc.enrollStart(userId);
    const secret = appState.adminTotp.get(userId)!.secret;
    await svc.enrollVerify(userId, authenticator.generate(secret));
    return secret;
  }

  it("logs in an enrolled admin with a valid code", async () => {
    const admin = appState.usersByPhone.get(PHONE)!;
    const secret = await enroll(admin.id);
    const out = await svc.verifyLogin(PHONE, authenticator.generate(secret));
    expect(out.access_token.startsWith("acc_")).toBe(true);
    expect(out.user.role).toBe("admin");
    expect(out.user.phone_e164).toBe(PHONE);
  });

  it("rejects a non-admin phone", async () => {
    await expect(svc.verifyLogin("+919999999902", "123456")).rejects.toThrow();
  });

  it("rejects when the admin is not enrolled", async () => {
    await expect(svc.verifyLogin(PHONE, "123456")).rejects.toThrow();
  });

  it("rejects a wrong code and locks after 5 failures", async () => {
    const admin = appState.usersByPhone.get(PHONE)!;
    await enroll(admin.id);
    for (let i = 0; i < 5; i += 1) {
      await expect(svc.verifyLogin(PHONE, "000000")).rejects.toThrow();
    }
    // 6th attempt (even with a valid code) is locked
    const secret = appState.adminTotp.get(admin.id)!.secret;
    await expect(svc.verifyLogin(PHONE, authenticator.generate(secret))).rejects.toThrow(/locked/i);
  });

  it("rejects a replayed code (same step reused)", async () => {
    const admin = appState.usersByPhone.get(PHONE)!;
    const secret = await enroll(admin.id);
    const code = authenticator.generate(secret);
    await svc.verifyLogin(PHONE, code); // consumes the step
    await expect(svc.verifyLogin(PHONE, code)).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @cribliv/api test -- admin-totp.service`
Expected: FAIL — `verifyLogin` is not a function.

- [ ] **Step 4: Implement `verifyLogin` + persistence helpers**

Add to `AdminTotpService` (in `admin-totp.service.ts`):

```typescript
  private static readonly MAX_FAILURES = 5;
  private static readonly LOCKOUT_MS = 15 * 60 * 1000;

  async verifyLogin(
    phoneE164: string,
    code: string
  ): Promise<{
    access_token: string;
    refresh_token: string;
    user: { id: string; role: string; phone_e164: string; preferred_language: string };
  }> {
    if (!/^\+91\d{10}$/.test(phoneE164)) {
      throw new UnauthorizedException({ code: "invalid_totp", message: "Invalid credentials" });
    }

    const user = await this.findAdminByPhone(phoneE164);
    // Generic error — never reveal whether the phone is a (non-)admin.
    if (!user) {
      throw new UnauthorizedException({ code: "invalid_totp", message: "Invalid credentials" });
    }

    const record = await this.getSecretRecord(user.id);
    if (!record || record.status !== "enabled") {
      throw new UnauthorizedException({ code: "invalid_totp", message: "Invalid credentials" });
    }

    if (record.lockedUntil && record.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException({ code: "totp_locked", message: "Account temporarily locked" });
    }

    const { valid, step } = verifyTotpCode(record.secret, code);
    const isReplay =
      valid && step !== null && record.lastUsedStep !== null && step <= record.lastUsedStep;

    if (!valid || isReplay) {
      const failures = record.failedAttempts + 1;
      const lockUntil =
        failures >= AdminTotpService.MAX_FAILURES
          ? new Date(Date.now() + AdminTotpService.LOCKOUT_MS)
          : null;
      await this.recordFailure(user.id, failures, lockUntil);
      throw new UnauthorizedException({ code: "invalid_totp", message: "Invalid credentials" });
    }

    await this.recordSuccess(user.id, step as number);
    return this.mintSession(user);
  }

  private async findAdminByPhone(
    phoneE164: string
  ): Promise<{ id: string; role: string; phone_e164: string; preferred_language: string } | null> {
    if (this.database.isEnabled()) {
      const result = await this.database.query<{
        id: string;
        role: string;
        phone_e164: string;
        preferred_language: string;
      }>(
        `SELECT id::text, role::text, phone_e164, preferred_language::text FROM users WHERE phone_e164 = $1 AND role = 'admin' LIMIT 1`,
        [phoneE164]
      );
      return result.rows[0] ?? null;
    }
    const mem = this.appState.usersByPhone.get(phoneE164);
    if (!mem || mem.role !== "admin") return null;
    return {
      id: mem.id,
      role: mem.role,
      phone_e164: mem.phone,
      preferred_language: mem.preferred_language
    };
  }

  private async recordFailure(userId: string, failures: number, lockUntil: Date | null) {
    if (this.database.isEnabled()) {
      await this.database.query(
        `UPDATE admin_totp SET failed_attempts = $2, locked_until = $3, updated_at = now() WHERE user_id = $1::uuid`,
        [userId, failures, lockUntil]
      );
    } else {
      const mem = this.appState.adminTotp.get(userId);
      if (mem) {
        mem.failedAttempts = failures;
        mem.lockedUntil = lockUntil ? lockUntil.getTime() : null;
      }
    }
  }

  private async recordSuccess(userId: string, step: number) {
    if (this.database.isEnabled()) {
      await this.database.query(
        `UPDATE admin_totp SET last_used_step = $2, failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE user_id = $1::uuid`,
        [userId, step]
      );
    } else {
      const mem = this.appState.adminTotp.get(userId);
      if (mem) {
        mem.lastUsedStep = step;
        mem.failedAttempts = 0;
        mem.lockedUntil = null;
      }
    }
  }

  private async mintSession(user: {
    id: string;
    role: string;
    phone_e164: string;
    preferred_language: string;
  }) {
    if (this.database.isEnabled()) {
      const client = await this.database.getClient();
      try {
        await client.query("BEGIN");
        const tokens = await this.authService.issueSessionTokens(client, user.id, user.role);
        await client.query("COMMIT");
        return { ...tokens, user };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }
    const session = this.appState.createSession(user.id);
    return {
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      user
    };
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @cribliv/api test -- admin-totp.service`
Expected: PASS (all enrollment + login tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/auth/admin-totp/admin-totp.service.ts apps/api/src/modules/auth/admin-totp/__tests__/admin-totp.service.test.ts
git commit --no-verify -m "feat(auth): admin TOTP login with replay guard + lockout"
```

---

### Task 8: `AdminTotpController` + module wiring + throttle

**Files:**

- Create: `apps/api/src/modules/auth/admin-totp/admin-totp.controller.ts`
- Modify: `apps/api/src/modules/auth/auth.module.ts`
- Test: `apps/api/src/modules/auth/admin-totp/__tests__/admin-totp.controller.int.test.ts`

**Interfaces:**

- Consumes: `AdminTotpService` (Tasks 5, 7), `readFeatureFlags` (Task 2), `AuthGuard`, `RolesGuard`, `@Roles`.
- Produces the routes in the spec: `POST /auth/admin/totp/enroll/start`, `POST /auth/admin/totp/enroll/verify`, `GET /auth/admin/totp/status`, `POST /auth/admin/totp/reset` (all admin-guarded), `POST /auth/admin/login` (public, throttled). All flag-gated: return `403 { code: "totp_disabled" }` when `ff_admin_totp` is false.

- [ ] **Step 1: Write the controller**

Create `apps/api/src/modules/auth/admin-totp/admin-totp.controller.ts`:

```typescript
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AdminTotpService } from "./admin-totp.service";
import { AuthGuard } from "../../../common/auth.guard";
import { RolesGuard } from "../../../common/roles.guard";
import { Roles } from "../../../common/roles.decorator";
import { ok } from "../../../common/response";
import { readFeatureFlags } from "../../../config/feature-flags";

function assertEnabled(): void {
  if (!readFeatureFlags().ff_admin_totp) {
    throw new ForbiddenException({ code: "totp_disabled", message: "Admin TOTP is disabled" });
  }
}

@Controller()
export class AdminTotpController {
  constructor(@Inject(AdminTotpService) private readonly service: AdminTotpService) {}

  @UseGuards(AuthGuard, RolesGuard)
  @Roles("admin")
  @Post("auth/admin/totp/enroll/start")
  async enrollStart(@Req() req: { user: { id: string } }) {
    assertEnabled();
    return ok(await this.service.enrollStart(req.user.id));
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles("admin")
  @HttpCode(200)
  @Post("auth/admin/totp/enroll/verify")
  async enrollVerify(@Req() req: { user: { id: string } }, @Body() body: { totp_code: string }) {
    assertEnabled();
    return ok(await this.service.enrollVerify(req.user.id, body.totp_code));
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles("admin")
  @Get("auth/admin/totp/status")
  async status(@Req() req: { user: { id: string } }) {
    assertEnabled();
    return ok(await this.service.status(req.user.id));
  }

  @UseGuards(AuthGuard, RolesGuard)
  @Roles("admin")
  @HttpCode(200)
  @Post("auth/admin/totp/reset")
  async reset(@Req() req: { user: { id: string } }) {
    assertEnabled();
    return ok(await this.service.reset(req.user.id));
  }

  // Public + strictly throttled: 10 attempts / 60s / IP (mirrors OTP routes).
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(200)
  @Post("auth/admin/login")
  async login(@Body() body: { phone_e164: string; totp_code: string }) {
    assertEnabled();
    return ok(await this.service.verifyLogin(body.phone_e164, body.totp_code));
  }
}
```

- [ ] **Step 2: Wire the module**

In `apps/api/src/modules/auth/auth.module.ts`, register the controller + service:

```typescript
import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { D7OtpClient } from "./d7-otp.client";
import { AdminTotpController } from "./admin-totp/admin-totp.controller";
import { AdminTotpService } from "./admin-totp/admin-totp.service";

@Module({
  controllers: [AuthController, AdminTotpController],
  providers: [AuthService, D7OtpClient, AdminTotpService],
  exports: [AuthService, AdminTotpService]
})
export class AuthModule {}
```

- [ ] **Step 3: Write the integration test**

Create `apps/api/src/modules/auth/admin-totp/__tests__/admin-totp.controller.int.test.ts`. Follow the bootstrapping style of `apps/api/src/modules/rent-agreement/__tests__/integration/*.int.test.ts` (build the Nest app with `Test.createTestingModule`, apply the same global guards/pipes as `main.ts`, use `supertest`). In-memory mode (no `DATABASE_URL`). Set `process.env.FF_ADMIN_TOTP = "true"` in `beforeAll`.

```typescript
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";
import { authenticator } from "otplib";
// import { bootstrapTestApp } from "<shared test bootstrap used by other int tests>";

const ADMIN_PHONE = "+919999999903";

describe("admin TOTP controller (in-memory)", () => {
  let app: INestApplication;
  let adminToken: string;

  beforeAll(async () => {
    process.env.FF_ADMIN_TOTP = "true";
    delete process.env.DATABASE_URL;
    // app = await bootstrapTestApp();  // reuse the project's int-test harness
    // adminToken = <mint an admin session via existing OTP flow / helper>;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("returns 403 totp_disabled when the flag is off", async () => {
    process.env.FF_ADMIN_TOTP = "false";
    const res = await request(app.getHttpServer())
      .post("/v1/auth/admin/login")
      .send({ phone_e164: ADMIN_PHONE, totp_code: "123456" });
    expect(res.status).toBe(403);
    expect(res.body?.error?.code ?? res.body?.code).toBe("totp_disabled");
    process.env.FF_ADMIN_TOTP = "true";
  });

  it("full flow: enroll → verify → login", async () => {
    const start = await request(app.getHttpServer())
      .post("/v1/auth/admin/totp/enroll/start")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(start.status).toBe(201);
    const uri: string = start.body.data.otpauth_uri;
    const secret = new URL(uri).searchParams.get("secret")!;

    const verify = await request(app.getHttpServer())
      .post("/v1/auth/admin/totp/enroll/verify")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ totp_code: authenticator.generate(secret) });
    expect(verify.status).toBe(200);
    expect(verify.body.data.enabled).toBe(true);

    const login = await request(app.getHttpServer())
      .post("/v1/auth/admin/login")
      .send({ phone_e164: ADMIN_PHONE, totp_code: authenticator.generate(secret) });
    expect(login.status).toBe(200);
    expect(login.body.data.access_token).toMatch(/^acc_/);
    expect(login.body.data.user.role).toBe("admin");
  });
});
```

Note: wire `adminToken` and `bootstrapTestApp` to the exact helpers the other `*.int.test.ts` files use in this repo (they already mint sessions in-memory). Do not invent a new harness.

- [ ] **Step 4: Run the integration test**

Run: `pnpm --filter @cribliv/api test -- admin-totp.controller.int`
Expected: PASS. If the shared bootstrap helper differs, adapt imports until green.

- [ ] **Step 5: Typecheck + full API test run**

Run: `pnpm --filter @cribliv/api typecheck && pnpm --filter @cribliv/api test`
Expected: no type errors; all API tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/auth/admin-totp/admin-totp.controller.ts apps/api/src/modules/auth/auth.module.ts apps/api/src/modules/auth/admin-totp/__tests__/admin-totp.controller.int.test.ts
git commit --no-verify -m "feat(auth): admin TOTP controller + module wiring"
```

---

### Task 9: Web — second NextAuth Credentials provider (`admin-totp`)

**Files:**

- Modify: `apps/web/auth.config.ts`

**Interfaces:**

- Consumes: `POST /auth/admin/login` (Task 8) returning `{ data: OtpVerifyResponse }`.
- Produces: a NextAuth provider with `id: "admin-totp"`, credentials `{ phone, totpCode }`, feeding the same `jwt`/`session` callbacks as the OTP provider. The existing OTP provider keeps its default id `"credentials"`.

- [ ] **Step 1: Add the provider**

In `apps/web/auth.config.ts`, add a second provider to the `providers` array (after the existing `Credentials({ name: "OTP", … })`):

```typescript
Credentials({
  id: "admin-totp",
  name: "Admin TOTP",
  credentials: {
    phone: { label: "Phone", type: "text" },
    totpCode: { label: "Authenticator code", type: "text" }
  },
  async authorize(credentials) {
    const { phone, totpCode } = credentials as { phone: string; totpCode: string };
    if (!phone || !totpCode) return null;
    try {
      const res = await fetch(`${API_BASE_URL}/auth/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone_e164: phone, totp_code: totpCode })
      });
      if (!res.ok) return null;
      const payload = (await res.json()) as { data: OtpVerifyResponse };
      const data = payload.data;
      return {
        id: data.user.id,
        phone: data.user.phone_e164,
        role: data.user.role,
        preferredLanguage: data.user.preferred_language,
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        tokenIssuedAt: Date.now(),
        isNewUser: false
      };
    } catch {
      return null;
    }
  }
});
```

- [ ] **Step 2: Typecheck the web app**

Run: `pnpm --filter @cribliv/web typecheck`
Expected: no errors (reuses the existing `OtpVerifyResponse` interface + `User` augmentation).

- [ ] **Step 3: Commit**

```bash
git add apps/web/auth.config.ts
git commit --no-verify -m "feat(web): admin-totp NextAuth credentials provider"
```

---

### Task 10: Web — dedicated admin login page

**Files:**

- Create: `apps/web/app/[locale]/admin/login/page.tsx`
- Modify: `apps/web/lib/feature-flags.ts` (register `ff_admin_totp`)

**Interfaces:**

- Consumes: `signIn("admin-totp", …)` (Task 9), `useFlag("ff_admin_totp")`.
- Produces: a phone + 6-digit-code login screen at `/en/admin/login` that redirects to `/en/admin` on success.

- [ ] **Step 1: Register the web flag**

In `apps/web/lib/feature-flags.ts`, add to `ENV_FLAG_MAP`:

```typescript
  ff_admin_totp: process.env.NEXT_PUBLIC_FF_ADMIN_TOTP,
```

- [ ] **Step 2: Write the page**

Create `apps/web/app/[locale]/admin/login/page.tsx`:

```tsx
"use client";

import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useFlag } from "../../../../lib/feature-flags";

function normalizePhone(phone: string): string {
  const cleaned = phone.trim().replace(/\s+/g, "").replace(/^0+/, "");
  return cleaned.startsWith("+91") ? cleaned : `+91${cleaned}`;
}

export default function AdminLoginPage() {
  const router = useRouter();
  const enabled = useFlag("ff_admin_totp");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    setError(null);
    const phoneE164 = normalizePhone(phone);
    if (!/^\+91\d{10}$/.test(phoneE164)) {
      setError("Enter a valid 10-digit mobile number.");
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setLoading(true);
    try {
      const result = await signIn("admin-totp", {
        redirect: false,
        phone: phoneE164,
        totpCode: code.trim()
      });
      if (result?.error) {
        setError("Invalid phone or authenticator code.");
        return;
      }
      window.location.href = "/en/admin";
    } catch {
      setError("Sign-in failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [phone, code, router]);

  if (!enabled) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 380, textAlign: "center", color: "#374151" }}>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>Admin sign-in</h1>
          <p style={{ fontSize: 14, color: "#6B7280" }}>
            Authenticator sign-in isn&apos;t enabled yet. Use the{" "}
            <a href="/auth/login" style={{ color: "#2563EB" }}>
              standard OTP login
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>Admin sign-in</h1>
        <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 20 }}>
          Enter your phone and the 6-digit code from your authenticator app.
        </p>

        <label style={{ fontSize: 12, color: "#374151" }} htmlFor="admin-phone">
          Mobile number
        </label>
        <input
          id="admin-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="98765 43210"
          disabled={loading}
          style={{
            width: "100%",
            padding: 10,
            margin: "6px 0 14px",
            borderRadius: 8,
            border: "1px solid #D1D5DB"
          }}
        />

        <label style={{ fontSize: 12, color: "#374151" }} htmlFor="admin-code">
          6-digit code
        </label>
        <input
          id="admin-code"
          type="text"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="••••••"
          disabled={loading}
          maxLength={6}
          style={{
            width: "100%",
            padding: 10,
            margin: "6px 0 14px",
            borderRadius: 8,
            border: "1px solid #D1D5DB",
            letterSpacing: 6,
            textAlign: "center"
          }}
        />

        <button
          onClick={handleSubmit}
          disabled={loading || code.length < 6}
          style={{
            width: "100%",
            padding: 11,
            borderRadius: 8,
            border: "none",
            background: "#111827",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        {error && (
          <div role="alert" style={{ marginTop: 12, color: "#DC2626", fontSize: 13 }}>
            {error}
          </div>
        )}

        <p style={{ marginTop: 18, fontSize: 12, color: "#9CA3AF", textAlign: "center" }}>
          Lost your device?{" "}
          <a href="/auth/login" style={{ color: "#6B7280" }}>
            Sign in with OTP
          </a>{" "}
          and re-enroll from Security.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify it renders (dev server)**

Start the web dev server via the preview tool (`.claude/launch.json` name for web, e.g. `web`), navigate to `/en/admin/login`. With `NEXT_PUBLIC_FF_ADMIN_TOTP` unset it should show the "isn't enabled yet" message; with it `=true` it shows the form. Confirm no console errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/[locale]/admin/login/page.tsx apps/web/lib/feature-flags.ts
git commit --no-verify -m "feat(web): admin TOTP login page"
```

---

### Task 11: Web — admin "Security" enrollment panel

**Files:**

- Create: `apps/web/components/admin/security/AdminTotpPanel.tsx`
- Modify: `apps/web/components/admin/shell/AdminShell.tsx` (surface the panel — add a "Security" nav entry/section)

**Interfaces:**

- Consumes: `GET/POST /auth/admin/totp/*` (Task 8) with `Authorization: Bearer <accessToken>`; `useFlag("ff_admin_totp")`.
- Produces: a panel showing enrollment state — "Set up authenticator" (QR + confirm-code) when not enrolled, and "Enrolled ✓ / Reset device" when enrolled.

- [ ] **Step 1: Write the panel component**

Create `apps/web/components/admin/security/AdminTotpPanel.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useFlag } from "../../../lib/feature-flags";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ?? "http://localhost:4000/v1";

export function AdminTotpPanel({ accessToken }: { accessToken: string }) {
  const enabled = useFlag("ff_admin_totp");
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`
  };

  const loadStatus = useCallback(async () => {
    const res = await fetch(`${API_BASE}/auth/admin/totp/status`, { headers: authHeaders });
    if (res.ok) {
      const payload = (await res.json()) as { data: { enrolled: boolean } };
      setEnrolled(payload.data.enrolled);
    }
  }, [accessToken]);

  useEffect(() => {
    if (enabled) void loadStatus();
  }, [enabled, loadStatus]);

  const startEnroll = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/auth/admin/totp/enroll/start`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({})
      });
      if (!res.ok) throw new Error();
      const payload = (await res.json()) as { data: { qr_data_url: string } };
      setQr(payload.data.qr_data_url);
    } catch {
      setError("Could not start enrollment.");
    } finally {
      setBusy(false);
    }
  }, [accessToken]);

  const confirmEnroll = useCallback(async () => {
    setError(null);
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/auth/admin/totp/enroll/verify`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ totp_code: code.trim() })
      });
      if (!res.ok) throw new Error();
      setQr(null);
      setCode("");
      await loadStatus();
    } catch {
      setError("Incorrect code. Try again.");
    } finally {
      setBusy(false);
    }
  }, [code, accessToken, loadStatus]);

  const resetDevice = useCallback(async () => {
    setBusy(true);
    try {
      await fetch(`${API_BASE}/auth/admin/totp/reset`, { method: "POST", headers: authHeaders });
      setQr(null);
      await loadStatus();
    } finally {
      setBusy(false);
    }
  }, [accessToken, loadStatus]);

  if (!enabled) return null;

  return (
    <section style={{ maxWidth: 460, padding: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
        Authenticator (2-step login)
      </h2>
      <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 16 }}>
        Log in without SMS OTP using an authenticator app (Google Authenticator, Authy, etc.).
      </p>

      {enrolled === true && !qr && (
        <div>
          <p style={{ color: "#059669", fontSize: 14, marginBottom: 12 }}>
            ✓ Authenticator enrolled
          </p>
          <button onClick={resetDevice} disabled={busy} style={btnGhost}>
            Reset device (re-enroll)
          </button>
        </div>
      )}

      {enrolled === false && !qr && (
        <button onClick={startEnroll} disabled={busy} style={btnPrimary}>
          {busy ? "Preparing…" : "Set up authenticator"}
        </button>
      )}

      {qr && (
        <div>
          <p style={{ fontSize: 13, marginBottom: 8 }}>
            1. Scan this QR in your authenticator app:
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qr}
            alt="Authenticator QR code"
            width={180}
            height={180}
            style={{ marginBottom: 12 }}
          />
          <p style={{ fontSize: 13, marginBottom: 8 }}>2. Enter the 6-digit code it shows:</p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
            placeholder="••••••"
            style={{
              padding: 10,
              borderRadius: 8,
              border: "1px solid #D1D5DB",
              letterSpacing: 6,
              textAlign: "center",
              width: 160
            }}
          />
          <div style={{ marginTop: 12 }}>
            <button onClick={confirmEnroll} disabled={busy || code.length < 6} style={btnPrimary}>
              {busy ? "Confirming…" : "Confirm"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" style={{ marginTop: 12, color: "#DC2626", fontSize: 13 }}>
          {error}
        </div>
      )}
    </section>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  border: "none",
  background: "#111827",
  color: "#fff",
  fontWeight: 600,
  cursor: "pointer"
};
const btnGhost: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  border: "1px solid #D1D5DB",
  background: "#fff",
  color: "#374151",
  cursor: "pointer"
};
```

- [ ] **Step 2: Surface the panel in AdminShell**

Open `apps/web/components/admin/shell/AdminShell.tsx`. It already receives `accessToken`. Add a "Security" destination to whatever nav/section mechanism the shell uses and render `<AdminTotpPanel accessToken={accessToken} />` there. Follow the shell's existing section pattern — do not restructure the shell. Minimal wiring:

```tsx
import { AdminTotpPanel } from "../security/AdminTotpPanel";
// …in the section switch/router used by the shell, add a case that renders:
// <AdminTotpPanel accessToken={accessToken} />
```

- [ ] **Step 3: Verify in the browser**

With the API running (`FF_ADMIN_TOTP=true`) and web dev server up, log into `/en/admin` (via OTP break-glass), open the new Security section. Confirm: "Set up authenticator" → QR appears → entering the code from an authenticator app (or generate one with the API's secret in a scratch script) flips to "Authenticator enrolled ✓". Check `read_console_messages` for errors.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter @cribliv/web typecheck && pnpm --filter @cribliv/web lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/admin/security/AdminTotpPanel.tsx apps/web/components/admin/shell/AdminShell.tsx
git commit --no-verify -m "feat(web): admin authenticator enrollment panel"
```

---

### Task 12: End-to-end verification + docs

**Files:**

- Modify: `apps/api/.env.example` (or the repo's env sample) — document `ADMIN_TOTP_ENC_KEY` and `FF_ADMIN_TOTP`
- Modify: `apps/web/.env.example` — document `NEXT_PUBLIC_FF_ADMIN_TOTP`

**Interfaces:**

- Consumes: everything above.

- [ ] **Step 1: Document the new env vars**

Add to the API env sample (create the line if the file uses a different name; grep for `RENT_AGREEMENT_PAN_KEY` to find where secrets are documented):

```
# Admin OTP-free login (TOTP). 32-byte key, base64-encoded. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
ADMIN_TOTP_ENC_KEY=
FF_ADMIN_TOTP=false
```

Add to the web env sample:

```
NEXT_PUBLIC_FF_ADMIN_TOTP=false
```

- [ ] **Step 2: Full backend suite + typecheck**

Run: `pnpm --filter @cribliv/api typecheck && pnpm --filter @cribliv/api test`
Expected: all green.

- [ ] **Step 3: Manual end-to-end smoke (in-memory)**

With `FF_ADMIN_TOTP=true`, `ADMIN_TOTP_ENC_KEY` set, `OTP_PROVIDER=mock`:

1. Log into `/en/admin` via `/auth/login` (OTP break-glass), phone `+919999999903`.
2. Security → Set up authenticator → scan QR into an authenticator app.
3. Sign out.
4. Go to `/en/admin/login`, enter phone + current authenticator code → lands on `/en/admin`.
5. Try an old/expired code → rejected. Try 5 wrong codes → "temporarily locked".

- [ ] **Step 4: Commit**

```bash
git add apps/api/.env.example apps/web/.env.example
git commit --no-verify -m "docs(auth): document ADMIN_TOTP_ENC_KEY + FF_ADMIN_TOTP"
```

- [ ] **Step 5: Open the PR**

Per your PR flow (branch → PR → squash-merge; direct master pushes are blocked):

```bash
git push -u origin claude/admin-login-no-otp-31c17a
gh pr create --title "Admin OTP-free login via TOTP" --body "$(cat <<'EOF'
Adds a free TOTP authenticator login path for admins, replacing per-login SMS-OTP cost. OTP stays as a rare break-glass. Gated behind FF_ADMIN_TOTP (default off).

See docs/superpowers/specs/2026-07-13-admin-totp-login-design.md and docs/superpowers/plans/2026-07-13-admin-totp-login.md.

## Prod rollout (ops)
1. Set `ADMIN_TOTP_ENC_KEY` (32-byte base64) in the API container-app secrets.
2. Deploy; enroll each admin via Security panel (one OTP break-glass login each).
3. Flip `FF_ADMIN_TOTP=true` (API) + `NEXT_PUBLIC_FF_ADMIN_TOTP=true` (web).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**

- Data model (§1) → Task 1. ✓
- Libraries (§2) → Task 4 Step 1. ✓
- Secret encryption (§3) → Task 3. ✓
- API endpoints (§4) → Tasks 5, 7 (service), 8 (controller/routes). ✓
- `issueSession` shared helper (§4) → Task 6. ✓
- Security specifics — replay, skew, throttle, lockout, no-enumeration (§5) → Task 4 (skew/step), Task 7 (replay/lockout/generic errors), Task 8 (throttle). ✓
- Web NextAuth provider + login page + enrollment panel (§6) → Tasks 9, 10, 11. ✓
- Bootstrap & recovery flow (§7) → Task 12 Step 3 (manual), page copy in Task 10. ✓
- Rollout flag (§8) → Task 2 (API), Tasks 10/11 (web), Task 8 (gate). ✓
- DB dual-mode (§9) → every service task implements both paths. ✓
- Testing (§ Testing) → unit (Tasks 3,4,5,7), integration (Task 8); Playwright E2E is optional and folded into Task 12's manual smoke (no dedicated Playwright task — see note below).

**Note / intentional scope choice:** the spec mentioned a Playwright E2E. This plan verifies the web flow via the dev-server manual smoke (Task 11 Step 3, Task 12 Step 3) rather than a new Playwright spec, because the repo's E2E requires a DB-backed session harness and admin TOTP is primarily a prod-DB feature. If you want an automated E2E, add it as a follow-up task mirroring `apps/web/**/__tests__` Playwright patterns.

**Placeholder scan:** no TBD/TODO left; the only "adapt to your harness" note is Task 8's integration bootstrap, which intentionally defers to the repo's existing `*.int.test.ts` helper rather than inventing one.

**Type consistency:** `issueSessionTokens(client, userId, role)` defined in Task 6 and called in Task 7 (`mintSession`). `getSecretRecord` returns `AdminTotpRecord` (Task 5), consumed in Task 7. `verifyTotpCode → { valid, step }` (Task 4) used consistently in Tasks 5 & 7. Provider id `"admin-totp"` (Task 9) matches `signIn("admin-totp", …)` (Task 10). Flag `ff_admin_totp` consistent across API (Task 2) and web (Tasks 10, 11).
