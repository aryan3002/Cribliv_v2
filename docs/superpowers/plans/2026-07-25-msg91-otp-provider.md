# MSG91 OTP Provider Implementation Plan

> **SUPERSEDED 2026-07-26 — do not execute this plan.** MSG91 offers no cost advantage
> over D7's own domestic route, so the migration was cancelled before any code was
> written. See `docs/superpowers/specs/2026-07-26-whatsapp-first-otp-design.md`.
> Tasks 1, 3, 4 and 5 (the `OtpProvider` interface, providers, resolver and `AuthService`
> rewiring) remain broadly valid and are being reused for the WhatsApp-first work; Tasks
> 2, 6 and 7 are MSG91-specific and dead.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MSG91 as a third selectable login-OTP provider alongside `mock` and `d7`, shipping flag-off so D7 stays live and cutover is a single env var.

**Architecture:** Extract the provider-specific half of `AuthService.sendOtp`/`verifyOtp` behind an `OtpProvider` interface with three implementations (`mock`, `d7`, `msg91`) plus a resolver that picks one per send. `AuthService` keeps rate limiting, the `otp_challenges` row lifecycle, attempt counting and session minting. Verify routes per-challenge via the existing `otp_hash` prefix, so flipping the env var cannot strand an in-flight login.

**Tech Stack:** NestJS 10, TypeScript, Vitest, native `fetch` with `AbortController`.

**Spec:** `docs/superpowers/specs/2026-07-25-msg91-otp-provider-design.md`

## Global Constraints

- Login OTP only. Do **not** touch `apps/api/src/modules/notifications/sms.client.ts`.
- D7 behaviour must be provably identical after the refactor. `apps/api/test/auth-d7.provider.test.ts` must pass unchanged — never edit it to make code pass.
- That test is quarantined from CI in `apps/api/vitest.config.ts`. It must be run locally and deliberately at every step that touches auth.
- Ships flag-off: with `OTP_PROVIDER=d7` and no `MSG91_*` vars set, runtime behaviour is byte-identical to today.
- MSG91 returns **HTTP 200 on errors**. Never treat `response.ok` as success — parse the `type` field.
- MSG91 wants the phone as `919044904818` (country code, no `+`). Stored values are `+919044904818`.
- OTP config values must be passed explicitly: `otp_length=6`, `otp_expiry=5` (minutes). MSG91 defaults are 4 and 15.
- Do not use MSG91's `/api/v5/otp/retry`. Resend goes through our own `sendOtp`, which already rate limits.
- Error codes surfaced to callers stay exactly: `invalid_otp`, `otp_expired`, `otp_blocked`, `otp_provider_error`, `otp_provider_misconfigured`.
- `handleInvalidDbOtp` always throws. Any new code path calling it must not assume it returns.
- Commit after every task. Use `--no-verify` — `lint-staged` is not installed in this worktree.

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/api/src/modules/auth/otp/otp-provider.interface.ts` | `OtpProvider` interface, `OtpVerifyError`, shared marker constants |
| `apps/api/src/modules/auth/otp/mock-otp.provider.ts` | Generates a 6-digit code, stores it raw |
| `apps/api/src/modules/auth/otp/d7-otp.provider.ts` | Wraps the existing `D7OtpClient`; no behaviour change |
| `apps/api/src/modules/auth/otp/msg91-otp.client.ts` | HTTP only: send + verify against MSG91, maps error strings |
| `apps/api/src/modules/auth/otp/msg91-otp.provider.ts` | Adapts the client to `OtpProvider` |
| `apps/api/src/modules/auth/otp/otp-provider.resolver.ts` | Picks a provider for a send; maps a stored marker back for verify |
| `apps/api/src/modules/auth/otp-provider.config.ts` | *(modify)* adds the `msg91` config branch |
| `apps/api/src/modules/auth/auth.service.ts` | *(modify)* delegates to the resolver |
| `apps/api/src/modules/auth/auth.module.ts` | *(modify)* registers the new providers |
| `apps/api/test/msg91-otp.client.test.ts` | MSG91 HTTP behaviour against a stubbed `fetch` |
| `apps/api/test/otp-provider.resolver.test.ts` | Selection precedence rules |

Client and provider are separate files because the client is pure HTTP with no Nest or
domain concerns, which makes it testable with nothing but a `fetch` stub. That split
mirrors the existing `D7OtpClient` / `AuthService` boundary.

---

### Task 1: `OtpProvider` interface and shared error type

Foundation only — no behaviour changes yet. Nothing consumes this until Task 2.

**Files:**
- Create: `apps/api/src/modules/auth/otp/otp-provider.interface.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `OtpProvider`, `OtpSendResult`, `OtpVerifyError`, `OtpVerifyErrorCode`, `MARKER_PREFIX_D7`, `MARKER_PREFIX_MSG91`

- [ ] **Step 1: Create the interface file**

```typescript
/**
 * Provider-agnostic contract for login OTP delivery.
 *
 * AuthService owns rate limiting, the otp_challenges row lifecycle, attempt
 * counting and session minting. A provider owns only two things: putting a
 * code in front of the user, and later confirming a submitted code.
 *
 * `marker` is whatever the provider needs persisted in
 * otp_challenges.otp_hash to verify later. It doubles as the discriminator
 * that routes a verify back to the provider that issued that code, which is
 * why flipping OTP_PROVIDER cannot strand an in-flight login.
 */

export type OtpVerifyErrorCode = "invalid_otp" | "otp_expired";

export class OtpVerifyError extends Error {
  readonly code: OtpVerifyErrorCode;

  constructor(code: OtpVerifyErrorCode, message: string) {
    super(message);
    this.name = "OtpVerifyError";
    this.code = code;
  }
}

export interface OtpSendResult {
  /** Persisted verbatim into otp_challenges.otp_hash. */
  marker: string;
  /** Drives the challenge row's expires_at and the API's expires_in_sec. */
  expirySec: number;
  /** Only the mock provider populates this; surfaced as dev_otp. */
  devOtp?: string;
}

export interface OtpProvider {
  readonly name: "mock" | "d7" | "msg91";
  send(input: { phoneE164: string }): Promise<OtpSendResult>;
  /** Resolves on success. Throws OtpVerifyError on a bad or expired code. */
  verify(input: { marker: string; phoneE164: string; code: string }): Promise<void>;
}

export const MARKER_PREFIX_D7 = "d7:";
export const MARKER_PREFIX_MSG91 = "msg91:";
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @cribliv/api exec tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/auth/otp/otp-provider.interface.ts
git commit --no-verify -m "feat(api): add OtpProvider interface for multi-provider OTP"
```

---

### Task 2: MSG91 HTTP client

Pure HTTP, no Nest DI, no database. This is where every MSG91 quirk gets absorbed so
nothing downstream has to know about them.

**Files:**
- Create: `apps/api/src/modules/auth/otp/msg91-otp.client.ts`
- Test: `apps/api/test/msg91-otp.client.test.ts`

**Interfaces:**
- Consumes: `OtpVerifyError` from Task 1
- Produces: `Msg91OtpClient` with `sendOtp({ phoneE164 }): Promise<{ requestId: string }>` and `verifyOtp({ phoneE164, code }): Promise<void>`; also `toMsg91Mobile(phoneE164: string): string`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/msg91-otp.client.test.ts`:

```typescript
import { HttpException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Msg91OtpClient, toMsg91Mobile } from "../src/modules/auth/otp/msg91-otp.client";
import { OtpVerifyError } from "../src/modules/auth/otp/otp-provider.interface";

function stubFetch(body: unknown, status = 200) {
  const spy = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("toMsg91Mobile", () => {
  it("strips the leading + from an E.164 number", () => {
    expect(toMsg91Mobile("+919044904818")).toBe("919044904818");
  });
});

describe("Msg91OtpClient", () => {
  beforeEach(() => {
    process.env.OTP_PROVIDER = "msg91";
    process.env.MSG91_AUTH_KEY = "test-authkey";
    process.env.MSG91_OTP_TEMPLATE_ID = "tpl_123";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.OTP_PROVIDER;
    delete process.env.MSG91_AUTH_KEY;
    delete process.env.MSG91_OTP_TEMPLATE_ID;
  });

  it("sends an OTP and returns the request id", async () => {
    const spy = stubFetch({ type: "success", request_id: "req_abc" });
    const client = new Msg91OtpClient();

    const result = await client.sendOtp({ phoneE164: "+919044904818" });

    expect(result.requestId).toBe("req_abc");
    const url = String(spy.mock.calls[0][0]);
    expect(url).toContain("https://control.msg91.com/api/v5/otp");
    expect(url).toContain("mobile=919044904818");
    expect(url).toContain("template_id=tpl_123");
    expect(url).toContain("authkey=test-authkey");
    expect(url).toContain("otp_length=6");
    expect(url).toContain("otp_expiry=5");
    expect(spy.mock.calls[0][1].method).toBe("POST");
  });

  it("treats an HTTP 200 error body as a failure", async () => {
    stubFetch({ type: "error", message: "The provided flow ID or template ID is invalid." });
    const client = new Msg91OtpClient();

    await expect(client.sendOtp({ phoneE164: "+919044904818" })).rejects.toBeInstanceOf(
      HttpException
    );
  });

  it("verifies a correct code", async () => {
    const spy = stubFetch({ type: "success", message: "OTP verified success" });
    const client = new Msg91OtpClient();

    await expect(
      client.verifyOtp({ phoneE164: "+919044904818", code: "123456" })
    ).resolves.toBeUndefined();

    expect(spy.mock.calls[0][1].headers.authkey).toBe("test-authkey");
    expect(String(spy.mock.calls[0][0])).toContain("/api/v5/otp/verify");
  });

  it("maps 'OTP not match' to invalid_otp", async () => {
    stubFetch({ type: "error", message: "OTP not match" });
    const client = new Msg91OtpClient();

    await expect(
      client.verifyOtp({ phoneE164: "+919044904818", code: "000000" })
    ).rejects.toMatchObject({ code: "invalid_otp" });
  });

  it("maps 'OTP expired' to otp_expired", async () => {
    stubFetch({ type: "error", message: "OTP expired" });
    const client = new Msg91OtpClient();

    await expect(
      client.verifyOtp({ phoneE164: "+919044904818", code: "123456" })
    ).rejects.toBeInstanceOf(OtpVerifyError);
    await expect(
      client.verifyOtp({ phoneE164: "+919044904818", code: "123456" })
    ).rejects.toMatchObject({ code: "otp_expired" });
  });

  it("raises a provider error on an invalid authkey", async () => {
    stubFetch({ code: "201", type: "error", message: "Invalid authkey" }, 401);
    const client = new Msg91OtpClient();

    await expect(
      client.verifyOtp({ phoneE164: "+919044904818", code: "123456" })
    ).rejects.toBeInstanceOf(HttpException);
  });

  it("raises a provider error when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const client = new Msg91OtpClient();

    await expect(client.sendOtp({ phoneE164: "+919044904818" })).rejects.toBeInstanceOf(
      HttpException
    );
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/msg91-otp.client.test.ts`
Expected: FAIL — cannot resolve `../src/modules/auth/otp/msg91-otp.client`.

- [ ] **Step 3: Implement the client**

Create `apps/api/src/modules/auth/otp/msg91-otp.client.ts`:

```typescript
import { HttpException, HttpStatus, Injectable, Logger } from "@nestjs/common";
import { type Msg91OtpProviderConfig, readOtpProviderConfig } from "../otp-provider.config";
import { OtpVerifyError } from "./otp-provider.interface";

/**
 * MSG91 OTP API client.
 *
 * Three provider quirks are absorbed here so nothing downstream sees them:
 *
 * 1. Auth placement differs per endpoint — authkey is a query param on send
 *    but a header on verify. MSG91's docs are explicit and inconsistent about
 *    this; we follow them per endpoint rather than guessing a uniform scheme.
 * 2. Errors arrive as HTTP 200 with {"type":"error"}. Checking response.ok is
 *    not sufficient and would silently report failures as successes.
 * 3. Mobile numbers are country-code-prefixed with no '+'.
 *
 * Docs: https://docs.msg91.com/otp/sendotp, https://docs.msg91.com/otp/verify-otp
 */

const REQUEST_TIMEOUT_MS = 8_000;

/** MSG91 wants 919044904818; we store +919044904818. */
export function toMsg91Mobile(phoneE164: string): string {
  return phoneE164.replace(/^\+/, "");
}

interface Msg91Response {
  type?: string;
  message?: string;
  request_id?: string;
}

@Injectable()
export class Msg91OtpClient {
  private readonly logger = new Logger(Msg91OtpClient.name);

  private getConfig(): Msg91OtpProviderConfig {
    const config = readOtpProviderConfig();
    if (config.provider !== "msg91") {
      throw new HttpException(
        {
          code: "otp_provider_misconfigured",
          message: "MSG91 OTP client cannot be used when OTP_PROVIDER is not msg91"
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    return config;
  }

  async sendOtp(input: { phoneE164: string }): Promise<{ requestId: string }> {
    const config = this.getConfig();
    const url = new URL(`${config.baseUrl}/api/v5/otp`);
    url.searchParams.set("authkey", config.authKey);
    url.searchParams.set("template_id", config.templateId);
    url.searchParams.set("mobile", toMsg91Mobile(input.phoneE164));
    url.searchParams.set("otp_length", "6");
    // MSG91 takes expiry in minutes; our config is seconds to match D7.
    url.searchParams.set("otp_expiry", String(Math.max(1, Math.round(config.expirySec / 60))));
    url.searchParams.set("realTimeResponse", "1");

    const body = await this.request(url, { method: "POST" });
    this.logger.debug(`msg91 sendOtp type=${body.type} request_id=${body.request_id ?? ""}`);

    if (body.type !== "success") {
      throw this.providerError(body.message ?? "MSG91 send failed");
    }

    return { requestId: body.request_id ?? "" };
  }

  async verifyOtp(input: { phoneE164: string; code: string }): Promise<void> {
    const config = this.getConfig();
    const url = new URL(`${config.baseUrl}/api/v5/otp/verify`);
    url.searchParams.set("mobile", toMsg91Mobile(input.phoneE164));
    url.searchParams.set("otp", input.code);

    const body = await this.request(url, {
      method: "GET",
      headers: { authkey: config.authKey }
    });

    if (body.type === "success") {
      return;
    }

    const message = (body.message ?? "").toLowerCase();
    if (message.includes("not match")) {
      throw new OtpVerifyError("invalid_otp", "Invalid OTP");
    }
    if (message.includes("expired")) {
      throw new OtpVerifyError("otp_expired", "OTP expired");
    }
    throw this.providerError(body.message ?? "MSG91 verify failed");
  }

  /**
   * MSG91 returns HTTP 200 for application errors, so this deliberately does
   * NOT throw on a non-ok status alone — except 401, which carries no useful
   * body. Callers inspect `type` themselves.
   */
  private async request(url: URL, init: RequestInit): Promise<Msg91Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url.toString(), { ...init, signal: controller.signal });
      const json = (await response.json().catch(() => ({}))) as Msg91Response;
      if (response.status === 401) {
        throw this.providerError("MSG91 rejected the auth key");
      }
      return json;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw this.providerError(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timeout);
    }
  }

  private providerError(detail: string): HttpException {
    this.logger.warn(`msg91 provider error: ${detail}`);
    return new HttpException(
      { code: "otp_provider_error", message: "Failed to send OTP. Please try again." },
      HttpStatus.BAD_GATEWAY
    );
  }
}
```

This will not compile yet — `Msg91OtpProviderConfig` does not exist. Add it now in
`apps/api/src/modules/auth/otp-provider.config.ts`:

Change the `OtpProvider` union and add the config shape:

```typescript
export type OtpProvider = "mock" | "d7" | "msg91";
```

Add after the `D7OtpProviderConfig` interface:

```typescript
export interface Msg91OtpProviderConfig extends OtpProviderConfigBase {
  provider: "msg91";
  authKey: string;
  templateId: string;
  baseUrl: string;
  expirySec: number;
}
```

Widen the union:

```typescript
export type OtpProviderConfig =
  | D7OtpProviderConfig
  | Msg91OtpProviderConfig
  | MockOtpProviderConfig;
```

Add the constants beside the existing D7 ones:

```typescript
const DEFAULT_MSG91_BASE_URL = "https://control.msg91.com";
const DEFAULT_MSG91_EXPIRY_SEC = 300;
```

Accept the new value in `parseOtpProvider` by replacing its membership check:

```typescript
  if (provider === "mock" || provider === "d7" || provider === "msg91") {
    return provider;
  }
```

And add the `msg91` branch in `readOtpProviderConfig`, immediately after the
`provider === "mock"` early return:

```typescript
  if (provider === "msg91") {
    const authKey = process.env.MSG91_AUTH_KEY?.trim();
    if (!authKey) {
      throw new InternalServerErrorException({
        code: "otp_provider_misconfigured",
        message: "MSG91_AUTH_KEY is required when OTP_PROVIDER=msg91"
      });
    }

    const templateId = process.env.MSG91_OTP_TEMPLATE_ID?.trim();
    if (!templateId) {
      throw new InternalServerErrorException({
        code: "otp_provider_misconfigured",
        message: "MSG91_OTP_TEMPLATE_ID is required when OTP_PROVIDER=msg91"
      });
    }

    return {
      provider: "msg91",
      authKey,
      templateId,
      baseUrl: (process.env.MSG91_BASE_URL?.trim() || DEFAULT_MSG91_BASE_URL).replace(/\/+$/, ""),
      expirySec: parsePositiveInt(process.env.MSG91_OTP_EXPIRY_SEC, DEFAULT_MSG91_EXPIRY_SEC)
    };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/msg91-otp.client.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Confirm D7 is untouched**

Run: `pnpm --filter @cribliv/api exec vitest run test/auth-d7.provider.test.ts`
Expected: PASS, 4 tests. If this fails, the config change broke D7 — stop and fix.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/auth/otp/msg91-otp.client.ts \
        apps/api/src/modules/auth/otp-provider.config.ts \
        apps/api/test/msg91-otp.client.test.ts
git commit --no-verify -m "feat(api): add MSG91 OTP client with error-in-200 handling"
```

---

### Task 3: The three provider implementations

Thin adapters. The mock and d7 bodies are lifted from `AuthService` verbatim so behaviour
is preserved by construction.

**Files:**
- Create: `apps/api/src/modules/auth/otp/mock-otp.provider.ts`
- Create: `apps/api/src/modules/auth/otp/d7-otp.provider.ts`
- Create: `apps/api/src/modules/auth/otp/msg91-otp.provider.ts`

**Interfaces:**
- Consumes: `OtpProvider`, `OtpVerifyError`, `MARKER_PREFIX_D7`, `MARKER_PREFIX_MSG91` (Task 1); `Msg91OtpClient` (Task 2); the existing `D7OtpClient` and `D7OtpVerifyError`
- Produces: `MockOtpProvider`, `D7OtpProvider`, `Msg91OtpProvider` — all `@Injectable()` and all implementing `OtpProvider`

- [ ] **Step 1: Create the mock provider**

```typescript
import { Injectable } from "@nestjs/common";
import { randomInt, createHash, timingSafeEqual } from "crypto";
import { OtpVerifyError, type OtpProvider, type OtpSendResult } from "./otp-provider.interface";

/**
 * Local/test provider. The code is stored raw in otp_hash and returned as
 * dev_otp so E2E tests and local logins need no SMS.
 */
@Injectable()
export class MockOtpProvider implements OtpProvider {
  readonly name = "mock" as const;

  async send(): Promise<OtpSendResult> {
    const otp = String(randomInt(100000, 999999));
    return { marker: otp, expirySec: 300, devOtp: otp };
  }

  async verify(input: { marker: string; code: string }): Promise<void> {
    const expected = createHash("sha256").update(input.marker, "utf8").digest();
    const provided = createHash("sha256").update(input.code, "utf8").digest();
    if (input.marker.length !== input.code.length || !timingSafeEqual(expected, provided)) {
      throw new OtpVerifyError("invalid_otp", "Invalid OTP");
    }
  }
}
```

- [ ] **Step 2: Create the D7 provider**

```typescript
import { Inject, Injectable } from "@nestjs/common";
import { D7OtpClient, D7OtpVerifyError } from "../d7-otp.client";
import { readOtpProviderConfig } from "../otp-provider.config";
import {
  MARKER_PREFIX_D7,
  OtpVerifyError,
  type OtpProvider,
  type OtpSendResult
} from "./otp-provider.interface";

/**
 * Wraps the existing D7OtpClient unchanged. Behaviour here must stay
 * byte-identical to the pre-refactor AuthService path — test/auth-d7.provider.test.ts
 * is the gate.
 */
@Injectable()
export class D7OtpProvider implements OtpProvider {
  readonly name = "d7" as const;

  constructor(@Inject(D7OtpClient) private readonly client: D7OtpClient) {}

  async send(input: { phoneE164: string }): Promise<OtpSendResult> {
    const config = readOtpProviderConfig();
    const expirySec = config.provider === "d7" ? config.expirySec : 300;
    const result = await this.client.sendOtp({ phoneE164: input.phoneE164 });
    return { marker: `${MARKER_PREFIX_D7}${result.otpId}`, expirySec };
  }

  async verify(input: { marker: string; code: string }): Promise<void> {
    const otpId = input.marker.slice(MARKER_PREFIX_D7.length);
    try {
      await this.client.verifyOtp({ otpId, otpCode: input.code });
    } catch (error) {
      if (error instanceof D7OtpVerifyError) {
        throw new OtpVerifyError(error.code, error.message);
      }
      throw error;
    }
  }
}
```

- [ ] **Step 3: Create the MSG91 provider**

```typescript
import { Inject, Injectable } from "@nestjs/common";
import { readOtpProviderConfig } from "../otp-provider.config";
import { Msg91OtpClient } from "./msg91-otp.client";
import { MARKER_PREFIX_MSG91, type OtpProvider, type OtpSendResult } from "./otp-provider.interface";

/**
 * MSG91 verify is keyed on mobile + code with no request id, so the marker
 * carries no payload — it exists purely to route a verify back here.
 */
@Injectable()
export class Msg91OtpProvider implements OtpProvider {
  readonly name = "msg91" as const;

  constructor(@Inject(Msg91OtpClient) private readonly client: Msg91OtpClient) {}

  async send(input: { phoneE164: string }): Promise<OtpSendResult> {
    const config = readOtpProviderConfig();
    const expirySec = config.provider === "msg91" ? config.expirySec : 300;
    await this.client.sendOtp({ phoneE164: input.phoneE164 });
    return { marker: MARKER_PREFIX_MSG91, expirySec };
  }

  async verify(input: { phoneE164: string; code: string }): Promise<void> {
    await this.client.verifyOtp({ phoneE164: input.phoneE164, code: input.code });
  }
}
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm --filter @cribliv/api exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/otp/
git commit --no-verify -m "feat(api): add mock, d7 and msg91 OtpProvider implementations"
```

---

### Task 4: Provider resolver

The selection rules live here so `AuthService` never reads env directly.

**Files:**
- Create: `apps/api/src/modules/auth/otp/otp-provider.resolver.ts`
- Test: `apps/api/test/otp-provider.resolver.test.ts`

**Interfaces:**
- Consumes: the three providers from Task 3; `MARKER_PREFIX_D7`, `MARKER_PREFIX_MSG91` from Task 1
- Produces: `OtpProviderResolver` with `forSend(phoneE164: string): OtpProvider` and `forMarker(marker: string): OtpProvider`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/otp-provider.resolver.test.ts`:

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { OtpProviderResolver } from "../src/modules/auth/otp/otp-provider.resolver";

const mock = { name: "mock" } as never;
const d7 = { name: "d7" } as never;
const msg91 = { name: "msg91" } as never;

function makeResolver() {
  return new OtpProviderResolver(mock, d7, msg91);
}

afterEach(() => {
  delete process.env.OTP_PROVIDER;
  delete process.env.MSG91_AUTH_KEY;
  delete process.env.MSG91_TEST_PHONES;
});

describe("OtpProviderResolver.forSend", () => {
  it("returns mock when OTP_PROVIDER=mock, ignoring the allowlist", () => {
    process.env.OTP_PROVIDER = "mock";
    process.env.MSG91_AUTH_KEY = "key";
    process.env.MSG91_TEST_PHONES = "+919044904818";

    expect(makeResolver().forSend("+919044904818").name).toBe("mock");
  });

  it("routes an allowlisted phone to msg91 even when OTP_PROVIDER=d7", () => {
    process.env.OTP_PROVIDER = "d7";
    process.env.MSG91_AUTH_KEY = "key";
    process.env.MSG91_TEST_PHONES = "+919044904818,+919999999999";

    expect(makeResolver().forSend("+919044904818").name).toBe("msg91");
  });

  it("leaves non-allowlisted phones on d7", () => {
    process.env.OTP_PROVIDER = "d7";
    process.env.MSG91_AUTH_KEY = "key";
    process.env.MSG91_TEST_PHONES = "+919044904818";

    expect(makeResolver().forSend("+918888888888").name).toBe("d7");
  });

  it("ignores the allowlist when MSG91_AUTH_KEY is unset", () => {
    process.env.OTP_PROVIDER = "d7";
    process.env.MSG91_TEST_PHONES = "+919044904818";

    expect(makeResolver().forSend("+919044904818").name).toBe("d7");
  });

  it("tolerates whitespace in the allowlist", () => {
    process.env.OTP_PROVIDER = "d7";
    process.env.MSG91_AUTH_KEY = "key";
    process.env.MSG91_TEST_PHONES = " +919044904818 , +919999999999 ";

    expect(makeResolver().forSend("+919044904818").name).toBe("msg91");
  });

  it("defaults to mock when OTP_PROVIDER is unset", () => {
    expect(makeResolver().forSend("+919044904818").name).toBe("mock");
  });

  it("returns msg91 for everyone once OTP_PROVIDER=msg91", () => {
    process.env.OTP_PROVIDER = "msg91";

    expect(makeResolver().forSend("+918888888888").name).toBe("msg91");
  });
});

describe("OtpProviderResolver.forMarker", () => {
  it("routes a d7 marker to d7 regardless of current env", () => {
    process.env.OTP_PROVIDER = "msg91";
    expect(makeResolver().forMarker("d7:otp_abc").name).toBe("d7");
  });

  it("routes a msg91 marker to msg91 regardless of current env", () => {
    process.env.OTP_PROVIDER = "d7";
    expect(makeResolver().forMarker("msg91:").name).toBe("msg91");
  });

  it("routes a bare digit marker to mock", () => {
    process.env.OTP_PROVIDER = "d7";
    expect(makeResolver().forMarker("123456").name).toBe("mock");
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/otp-provider.resolver.test.ts`
Expected: FAIL — cannot resolve `otp-provider.resolver`.

- [ ] **Step 3: Implement the resolver**

```typescript
import { Inject, Injectable } from "@nestjs/common";
import { D7OtpProvider } from "./d7-otp.provider";
import { MockOtpProvider } from "./mock-otp.provider";
import { Msg91OtpProvider } from "./msg91-otp.provider";
import {
  MARKER_PREFIX_D7,
  MARKER_PREFIX_MSG91,
  type OtpProvider
} from "./otp-provider.interface";

/**
 * Chooses which provider sends a given OTP, and routes a verify back to
 * whichever provider issued that specific code.
 *
 * The allowlist deliberately outranks OTP_PROVIDER so a single test phone can
 * exercise MSG91 against production while every real user stays on D7. It is
 * inert without MSG91_AUTH_KEY, so a half-configured environment degrades to
 * the configured provider rather than failing logins.
 */
@Injectable()
export class OtpProviderResolver {
  constructor(
    @Inject(MockOtpProvider) private readonly mock: MockOtpProvider,
    @Inject(D7OtpProvider) private readonly d7: D7OtpProvider,
    @Inject(Msg91OtpProvider) private readonly msg91: Msg91OtpProvider
  ) {}

  forSend(phoneE164: string): OtpProvider {
    const configured = (process.env.OTP_PROVIDER ?? "mock").trim().toLowerCase();

    // Mock wins outright: local dev and E2E must never reach a real provider.
    if (configured === "mock") {
      return this.mock;
    }

    if (process.env.MSG91_AUTH_KEY?.trim() && this.isAllowlisted(phoneE164)) {
      return this.msg91;
    }

    if (configured === "msg91") {
      return this.msg91;
    }
    return this.d7;
  }

  forMarker(marker: string): OtpProvider {
    if (marker.startsWith(MARKER_PREFIX_D7)) {
      return this.d7;
    }
    if (marker.startsWith(MARKER_PREFIX_MSG91)) {
      return this.msg91;
    }
    return this.mock;
  }

  private isAllowlisted(phoneE164: string): boolean {
    const raw = process.env.MSG91_TEST_PHONES;
    if (!raw) {
      return false;
    }
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .includes(phoneE164);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/otp-provider.resolver.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/otp/otp-provider.resolver.ts \
        apps/api/test/otp-provider.resolver.test.ts
git commit --no-verify -m "feat(api): add OtpProviderResolver with test-phone allowlist"
```

---

### Task 5: Wire `AuthService` to the resolver

The riskiest task. `test/auth-d7.provider.test.ts` is the gate and must not be edited.

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts` (constructor ~42-46, `sendOtp` ~111-151, `verifyOtp` ~224-241)
- Modify: `apps/api/src/modules/auth/auth.module.ts`

**Interfaces:**
- Consumes: `OtpProviderResolver` (Task 4), `OtpVerifyError` (Task 1)
- Produces: no signature changes — `sendOtp` and `verifyOtp` keep their current shapes

- [ ] **Step 1: Register the providers in `auth.module.ts`**

```typescript
import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { D7OtpClient } from "./d7-otp.client";
import { AdminTotpController } from "./admin-totp/admin-totp.controller";
import { AdminTotpService } from "./admin-totp/admin-totp.service";
import { D7OtpProvider } from "./otp/d7-otp.provider";
import { MockOtpProvider } from "./otp/mock-otp.provider";
import { Msg91OtpClient } from "./otp/msg91-otp.client";
import { Msg91OtpProvider } from "./otp/msg91-otp.provider";
import { OtpProviderResolver } from "./otp/otp-provider.resolver";

@Module({
  controllers: [AuthController, AdminTotpController],
  providers: [
    AuthService,
    D7OtpClient,
    AdminTotpService,
    MockOtpProvider,
    D7OtpProvider,
    Msg91OtpClient,
    Msg91OtpProvider,
    OtpProviderResolver
  ],
  exports: [AuthService, AdminTotpService]
})
export class AuthModule {}
```

- [ ] **Step 2: Add the resolver to the `AuthService` constructor**

Keep `D7OtpClient` injected — `test/auth-d7.provider.test.ts` constructs
`new AuthService(appState, database, d7Client)` positionally, so removing it or
reordering would break the gate test. Append the resolver as a fourth, optional param:

```typescript
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(D7OtpClient) private readonly d7OtpClient: D7OtpClient,
    @Inject(OtpProviderResolver) private readonly otpProviders?: OtpProviderResolver
  ) {}
```

Add a private accessor that falls back to a locally-constructed resolver when DI did not
supply one, so the existing positional-construction test keeps working:

```typescript
  /**
   * test/auth-d7.provider.test.ts constructs AuthService with three positional
   * args, so the resolver can be absent. Fall back to a resolver wired to the
   * injected D7 client in that case.
   */
  private get providers(): OtpProviderResolver {
    if (this.otpProviders) {
      return this.otpProviders;
    }
    return new OtpProviderResolver(
      new MockOtpProvider(),
      new D7OtpProvider(this.d7OtpClient),
      new Msg91OtpProvider(new Msg91OtpClient())
    );
  }
```

Add the imports:

```typescript
import { MockOtpProvider } from "./otp/mock-otp.provider";
import { D7OtpProvider } from "./otp/d7-otp.provider";
import { Msg91OtpProvider } from "./otp/msg91-otp.provider";
import { Msg91OtpClient } from "./otp/msg91-otp.client";
import { OtpProviderResolver } from "./otp/otp-provider.resolver";
import { OtpVerifyError } from "./otp/otp-provider.interface";
```

- [ ] **Step 3: Replace the send branch**

Replace everything from `const providerConfig = readOtpProviderConfig();` (line ~111)
through the `return` that ends the `d7SendResult` block (line ~151) with:

```typescript
      const provider = this.providers.forSend(phone_e164);
      const sent = await provider.send({ phoneE164: phone_e164 });

      const inserted = await this.database.query<{ id: string }>(
        `
        INSERT INTO otp_challenges(phone_e164, purpose, otp_hash, expires_at, status, client_ip)
        VALUES ($1, $2::otp_purpose, $3, now() + ($4::int * interval '1 second'), 'active', $5)
        RETURNING id::text
        `,
        [phone_e164, purpose, sent.marker, sent.expirySec, clientIp || null]
      );

      return {
        challenge_id: inserted.rows[0].id,
        expires_in_sec: sent.expirySec,
        retry_after_sec: 30,
        ...(sent.devOtp ? { dev_otp: sent.devOtp } : {})
      };
```

Note this unifies the two previous INSERTs. The mock path previously hardcoded
`interval '5 minutes'`; `MockOtpProvider` returns `expirySec: 300`, which is the same
value expressed through the shared parameterised statement.

- [ ] **Step 4: Replace the verify branch**

Replace lines ~224-241 (from `const providerOtpId = ...` through the
`timingSafeOtpEqual` else-branch) with:

```typescript
      const provider = this.providers.forMarker(challenge.otp_hash);
      try {
        await provider.verify({
          marker: challenge.otp_hash,
          phoneE164: challenge.phone_e164,
          code: otp_code
        });
      } catch (error) {
        if (error instanceof OtpVerifyError) {
          if (error.code === "invalid_otp") {
            // Always throws: invalid_otp, or otp_blocked at the 5th attempt.
            await this.handleInvalidDbOtp(challenge.id, challenge.attempt_count);
          }
          throw new UnauthorizedException({ code: "otp_expired", message: "OTP expired" });
        }
        throw error;
      }
```

- [ ] **Step 5: Mark `handleInvalidDbOtp` as never-returning**

Change its signature so the compiler documents the control flow that misled an earlier
reviewer:

```typescript
  private async handleInvalidDbOtp(
    challengeId: string,
    currentAttemptCount: number
  ): Promise<never> {
```

- [ ] **Step 6: Remove the now-unused imports**

`randomInt` and `timingSafeOtpEqual`'s internals moved to `MockOtpProvider`, and
`D7OtpVerifyError` is no longer referenced. Keep the exported `timingSafeOtpEqual`
function itself — grep before deleting:

Run: `grep -rn "timingSafeOtpEqual" apps/api/src apps/api/test`
If the only remaining reference is its own definition and it is imported nowhere, leave
it exported anyway (it is part of the module's public surface). Remove `D7OtpVerifyError`
from the import on line 15 if unused. Remove `readOtpProviderConfig` from line 17 if unused.

Run: `pnpm --filter @cribliv/api exec tsc --noEmit`
Expected: exit 0, and no "declared but never read" errors.

- [ ] **Step 7: Run the D7 regression gate**

Run: `pnpm --filter @cribliv/api exec vitest run test/auth-d7.provider.test.ts`
Expected: PASS, 4 tests, unmodified.

If any fail, the refactor changed D7 behaviour. Fix the source, never the test.

- [ ] **Step 8: Run the whole auth-adjacent suite**

Run: `pnpm --filter @cribliv/api exec vitest run test/msg91-otp.client.test.ts test/otp-provider.resolver.test.ts test/auth-d7.provider.test.ts src/modules/auth`
Expected: all PASS.

Do **not** run the full API suite with a live `TEST_DATABASE_URL` — migration 0045's
rollback drops `keyword_rankings` and `seo_indexing_queue`.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.ts apps/api/src/modules/auth/auth.module.ts
git commit --no-verify -m "refactor(api): route OTP send/verify through OtpProviderResolver"
```

---

### Task 6: Silence the D7 debug log, document the env vars

**Files:**
- Modify: `apps/api/src/modules/auth/d7-otp.client.ts:49`
- Modify: `.env.example`
- Modify: `infra/set-env-vars.sh`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: Replace the `console.log`**

In `apps/api/src/modules/auth/d7-otp.client.ts`, add a logger to the class:

```typescript
  private readonly logger = new Logger(D7OtpClient.name);
```

Add `Logger` to the `@nestjs/common` import on line 1. Then replace line 49:

```typescript
      this.logger.debug(`d7 sendOtp otp_id=${response?.otp_id ?? ""}`);
```

This drops the full response body, which could carry recipient data, from production logs.

- [ ] **Step 2: Document the env vars in `.env.example`**

Append after the existing `D7_OTP_EXPIRY_SEC` line:

```bash
# MSG91 (OTP_PROVIDER=msg91). Requires completed KYC + DLT registration:
# a registered entity, a 6-alpha header, and an approved content template
# containing ##OTP##. Without DLT, MSG91 will not deliver to Indian numbers.
MSG91_AUTH_KEY=
MSG91_OTP_TEMPLATE_ID=
MSG91_BASE_URL=https://control.msg91.com
MSG91_OTP_EXPIRY_SEC=300
# Comma-separated E.164 numbers routed to MSG91 regardless of OTP_PROVIDER.
# Used to validate MSG91 against production before cutting everyone over.
MSG91_TEST_PHONES=
```

- [ ] **Step 3: Add the vars to the Azure deploy script**

In `infra/set-env-vars.sh`, add beside the existing `OTP_PROVIDER` default (line ~64):

```bash
MSG91_AUTH_KEY="${MSG91_AUTH_KEY:-}"
MSG91_OTP_TEMPLATE_ID="${MSG91_OTP_TEMPLATE_ID:-}"
MSG91_TEST_PHONES="${MSG91_TEST_PHONES:-}"
```

And in the `az containerapp update` argument list beside `OTP_PROVIDER="${OTP_PROVIDER}"` (line ~130):

```bash
    MSG91_AUTH_KEY="${MSG91_AUTH_KEY}" \
    MSG91_OTP_TEMPLATE_ID="${MSG91_OTP_TEMPLATE_ID}" \
    MSG91_TEST_PHONES="${MSG91_TEST_PHONES}" \
```

- [ ] **Step 4: Verify nothing regressed**

Run: `pnpm --filter @cribliv/api exec tsc --noEmit && pnpm --filter @cribliv/api exec vitest run test/auth-d7.provider.test.ts test/msg91-otp.client.test.ts test/otp-provider.resolver.test.ts`
Expected: exit 0, all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/d7-otp.client.ts .env.example infra/set-env-vars.sh
git commit --no-verify -m "chore(api): drop D7 response console.log, document MSG91 env vars"
```

---

### Task 7: Flag-off verification and PR

Prove the merged change is inert until MSG91 is deliberately configured.

**Files:** none

- [ ] **Step 1: Confirm default behaviour is unchanged**

```bash
cd apps/api && env -u MSG91_AUTH_KEY -u MSG91_TEST_PHONES OTP_PROVIDER=d7 \
  pnpm exec vitest run test/auth-d7.provider.test.ts
```

Expected: PASS. With no MSG91 vars set, the resolver's allowlist branch is unreachable and
every send goes to D7.

- [ ] **Step 2: Confirm mock still wins for local dev**

```bash
cd apps/api && OTP_PROVIDER=mock MSG91_AUTH_KEY=x MSG91_TEST_PHONES=+919044904818 \
  pnpm exec vitest run test/otp-provider.resolver.test.ts
```

Expected: PASS — E2E and local logins never reach a real provider.

- [ ] **Step 3: Run lint and typecheck**

```bash
pnpm --filter @cribliv/api lint && pnpm --filter @cribliv/api exec tsc --noEmit
```

Expected: exit 0 both.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin claude/msg91-sms-integration-578a86
```

PR body must state: ships flag-off, `OTP_PROVIDER` stays `d7`, no env changes needed at
merge time, and go-live is blocked on MSG91 KYC plus DLT registration (entity, header,
template) — neither of which exists yet.

---

## Post-merge go-live runbook (not code — do not execute during implementation)

1. Complete MSG91 KYC. Until then the account is in DEMO and MSG91 replaces the message body with a testing string: the API returns success, the wallet is charged, and no OTP arrives.
2. Complete DLT registration — entity (PE), 6-alpha header, content template. Template body: `Greetings from CribLiv, your mobile verification code is: ##OTP##`. The same content on the DLT portal uses `{#var#}` instead of `##OTP##`.
3. Register the template in MSG91 (OTP → Templates) and copy the returned template id.
4. Set `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, and `MSG91_TEST_PHONES=+919044904818` on `cribliv-api`. Leave `OTP_PROVIDER=d7`.
5. Log in with that phone on production. Confirm the SMS arrives, shows the `CRIBLV` header, and that the challenge row's `otp_hash` is `msg91:`.
6. Flip `OTP_PROVIDER=msg91` and clear `MSG91_TEST_PHONES`.
7. Rollback at any point: set `OTP_PROVIDER=d7`. In-flight `msg91:` challenges still verify correctly because verify routes by marker.
