# WhatsApp-First OTP — Slice 1 (API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the API able to send login OTP over WhatsApp with D7 SMS as a gated fallback, shipping inert so nothing changes until `OTP_CHANNEL_PRIMARY=whatsapp` is set.

**Architecture:** Extract the provider-specific half of `AuthService` behind an `OtpProvider` interface with three implementations (`mock`, `whatsapp`, `d7`) plus a pure resolver that picks a channel. WhatsApp is self-managed — we generate the code, store a SHA-256 of it, and verify locally, because Meta only delivers messages. `AuthService` keeps rate limiting, the `otp_challenges` lifecycle, attempt counting and session minting, and owns the fallback gate because it owns the database.

**Tech Stack:** NestJS 10, TypeScript, Vitest, native `fetch` with `AbortController`.

**Spec:** `docs/superpowers/specs/2026-07-26-whatsapp-first-otp-design.md`

## Scope

**In:** everything server-side — providers, resolver, `AuthService`/controller wiring, the `WhatsAppClient` button component, env plumbing, tests.

**Out — deliberately a separate slice:** the web UI (`apps/web/app/[locale]/auth/login/page.tsx`, `apps/web/app/auth/login/page.tsx`, `apps/web/components/unlock-contact-panel.tsx`). Until that lands, `sms_fallback_available` is returned but nothing renders it. That is fine: the flag is off, so production keeps using D7 exactly as today.

## Global Constraints

- Ships inert. With `OTP_CHANNEL_PRIMARY` unset, every send goes to D7 and behaviour is identical to today.
- D7 behaviour must be provably identical. `apps/api/test/auth-d7.provider.test.ts` must pass **unmodified** — never edit it to make code pass.
- That test is quarantined from CI in `apps/api/vitest.config.ts`. Run it locally and deliberately; green CI is not sufficient evidence.
- `OTP_PROVIDER=mock` overrides all channel logic, unconditionally. Local dev and Playwright must never reach a real provider.
- Never store the raw OTP for the WhatsApp channel. Marker is `wa:<sha256hex>`.
- The fallback gate is server-side. A client asking for `channel: "sms"` before the gate opens gets WhatsApp.
- Error codes surfaced to callers stay exactly: `invalid_otp`, `otp_expired`, `otp_blocked`, `otp_provider_error`, `otp_provider_misconfigured`.
- `handleInvalidDbOtp` always throws. Never assume it returns.
- No database migration. WhatsApp attempts are counted from existing `otp_challenges` rows via the `wa:` marker prefix.
- Commit after every task with `--no-verify` — `lint-staged` is not installed in this worktree.

## File Structure

| Path | Responsibility |
| --- | --- |
| `apps/api/src/modules/auth/otp/otp-provider.interface.ts` | `OtpProvider`, `OtpVerifyError`, marker prefixes |
| `apps/api/src/modules/auth/otp/mock-otp.provider.ts` | 6-digit code stored raw; dev only |
| `apps/api/src/modules/auth/otp/d7-otp.provider.ts` | Wraps existing `D7OtpClient`; no behaviour change |
| `apps/api/src/modules/auth/otp/whatsapp-otp.provider.ts` | Generates code, hashes it, sends auth template |
| `apps/api/src/modules/auth/otp/otp-provider.resolver.ts` | Pure channel selection + marker routing |
| `apps/api/src/modules/notifications/whatsapp.client.ts` | *(modify)* optional button component |
| `apps/api/src/modules/auth/auth.service.ts` | *(modify)* delegates, owns the gate |
| `apps/api/src/modules/auth/auth.controller.ts` | *(modify)* accepts `channel` |
| `apps/api/src/modules/auth/auth.module.ts` | *(modify)* registers providers |

---

### Task 1: `OtpProvider` interface

Foundation. Nothing consumes it until Task 3.

**Files:**
- Create: `apps/api/src/modules/auth/otp/otp-provider.interface.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `OtpProvider`, `OtpSendResult`, `OtpVerifyError`, `OtpVerifyErrorCode`, `OtpUndeliverableError`, `MARKER_PREFIX_D7`, `MARKER_PREFIX_WHATSAPP`

- [ ] **Step 1: Create the file**

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
 * that routes a verify back to the channel that issued that code, so changing
 * the configured channel cannot strand an in-flight login.
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

/**
 * Thrown when the provider knows, synchronously, that this recipient can
 * never receive on this channel — e.g. Meta reporting the number has no
 * WhatsApp account. Distinct from a transient failure: AuthService reacts by
 * falling back to SMS immediately, whereas a transient failure surfaces as an
 * error so we do not silently burn an expensive SMS on a blip.
 */
export class OtpUndeliverableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OtpUndeliverableError";
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
  readonly name: "mock" | "whatsapp" | "d7";
  send(input: { phoneE164: string; languageCode?: string }): Promise<OtpSendResult>;
  /** Resolves on success. Throws OtpVerifyError on a bad or expired code. */
  verify(input: { marker: string; phoneE164: string; code: string }): Promise<void>;
}

export const MARKER_PREFIX_D7 = "d7:";
export const MARKER_PREFIX_WHATSAPP = "wa:";
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @cribliv/api exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/auth/otp/otp-provider.interface.ts
git commit --no-verify -m "feat(api): add OtpProvider interface for multi-channel OTP"
```

---

### Task 2: WhatsApp auth-template button support

Meta's authentication templates require a button component carrying the code. The existing client emits header and body only. Additive change — every current notification caller is unaffected.

**Files:**
- Modify: `apps/api/src/modules/notifications/whatsapp.client.ts`
- Test: `apps/api/test/whatsapp-client-auth-template.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `WhatsAppTemplateMessage.buttonParams?: string[]`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/whatsapp-client-auth-template.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "../src/modules/notifications/whatsapp.client";

describe("WhatsAppClient auth templates", () => {
  beforeEach(() => {
    process.env.WHATSAPP_PROVIDER = "meta";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "pn_123";
    process.env.WHATSAPP_API_TOKEN = "tok_123";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.WHATSAPP_PROVIDER;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_API_TOKEN;
    delete process.env.WHATSAPP_API_URL;
  });

  it("emits a url button component carrying the code", async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.1" }] })
    });
    vi.stubGlobal("fetch", spy);

    const client = new WhatsAppClient();
    const result = await client.sendTemplate({
      to: "+919044904818",
      templateName: "cribliv_login_otp",
      languageCode: "en",
      bodyParams: ["123456"],
      buttonParams: ["123456"]
    });

    expect(result.success).toBe(true);
    const body = JSON.parse(spy.mock.calls[0][1].body);
    expect(body.to).toBe("919044904818");
    expect(body.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "123456" }] },
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: "123456" }]
      }
    ]);
  });

  it("omits the button component when buttonParams is absent", async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: "wamid.2" }] })
    });
    vi.stubGlobal("fetch", spy);

    const client = new WhatsAppClient();
    await client.sendTemplate({
      to: "+919044904818",
      templateName: "listing_approved_hi",
      languageCode: "hi",
      bodyParams: ["Flat 2BHK"]
    });

    const body = JSON.parse(spy.mock.calls[0][1].body);
    expect(body.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Flat 2BHK" }] }
    ]);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/whatsapp-client-auth-template.test.ts`
Expected: FAIL — `buttonParams` is not a known property, and the emitted components lack the button block.

- [ ] **Step 3: Add the field to the interface**

In `apps/api/src/modules/notifications/whatsapp.client.ts`, add to `WhatsAppTemplateMessage` after `headerParams`:

```typescript
  /**
   * Parameters for a template's button component. Authentication templates
   * require this — Meta renders a copy-code button and the code must be
   * repeated here as well as in the body.
   */
  buttonParams?: string[];
```

- [ ] **Step 4: Emit the button component**

In `buildMetaPayload`, after the `bodyParams` block and before the `return`:

```typescript
    if (message.buttonParams?.length) {
      components.push({
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: message.buttonParams.map((text) => ({ type: "text", text }))
      });
    }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/whatsapp-client-auth-template.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/notifications/whatsapp.client.ts \
        apps/api/test/whatsapp-client-auth-template.test.ts
git commit --no-verify -m "feat(api): support auth-template button component in WhatsAppClient"
```

---

### Task 3: Mock and D7 provider adapters

Bodies lifted from `AuthService` verbatim so behaviour is preserved by construction.

**Files:**
- Create: `apps/api/src/modules/auth/otp/mock-otp.provider.ts`
- Create: `apps/api/src/modules/auth/otp/d7-otp.provider.ts`

**Interfaces:**
- Consumes: Task 1 exports; existing `D7OtpClient`, `D7OtpVerifyError`, `readOtpProviderConfig`
- Produces: `MockOtpProvider`, `D7OtpProvider`

- [ ] **Step 1: Create the mock provider**

```typescript
import { Injectable } from "@nestjs/common";
import { createHash, randomInt, timingSafeEqual } from "crypto";
import { OtpVerifyError, type OtpProvider, type OtpSendResult } from "./otp-provider.interface";

/**
 * Local/test provider. The code is stored raw in otp_hash and returned as
 * dev_otp so E2E tests and local logins need no real delivery. Raw storage is
 * acceptable here precisely because this path never runs in production —
 * the WhatsApp provider stores a hash instead.
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
 * Wraps the existing D7OtpClient unchanged. Behaviour must stay identical to
 * the pre-refactor AuthService path — test/auth-d7.provider.test.ts is the gate.
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

- [ ] **Step 3: Verify it compiles**

Run: `pnpm --filter @cribliv/api exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/auth/otp/mock-otp.provider.ts \
        apps/api/src/modules/auth/otp/d7-otp.provider.ts
git commit --no-verify -m "feat(api): add mock and d7 OtpProvider adapters"
```

---

### Task 4: WhatsApp OTP provider

The core of this slice. Self-managed: we generate the code, persist only its SHA-256, and verify locally.

**Files:**
- Create: `apps/api/src/modules/auth/otp/whatsapp-otp.provider.ts`
- Test: `apps/api/test/whatsapp-otp.provider.test.ts`

**Interfaces:**
- Consumes: Task 1 exports; `WhatsAppClient` and `WhatsAppTemplateMessage` (Task 2)
- Produces: `WhatsAppOtpProvider`, `hashOtp(code: string): string`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/whatsapp-otp.provider.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WhatsAppOtpProvider,
  hashOtp
} from "../src/modules/auth/otp/whatsapp-otp.provider";
import {
  OtpUndeliverableError,
  OtpVerifyError
} from "../src/modules/auth/otp/otp-provider.interface";

function fakeClient(result: { success: boolean; error?: string }) {
  return { sendTemplate: vi.fn().mockResolvedValue(result) };
}

describe("WhatsAppOtpProvider", () => {
  beforeEach(() => {
    process.env.WHATSAPP_OTP_TEMPLATE_NAME = "cribliv_login_otp";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.WHATSAPP_OTP_TEMPLATE_NAME;
    delete process.env.WHATSAPP_OTP_EXPIRY_SEC;
  });

  it("stores a hash of the code, never the code itself", async () => {
    const client = fakeClient({ success: true });
    const provider = new WhatsAppOtpProvider(client as never);

    const result = await provider.send({ phoneE164: "+919044904818" });

    expect(result.marker.startsWith("wa:")).toBe(true);
    expect(result.devOtp).toBeUndefined();

    const sentCode = client.sendTemplate.mock.calls[0][0].bodyParams[0];
    expect(sentCode).toMatch(/^\d{6}$/);
    expect(result.marker).toBe(`wa:${hashOtp(sentCode)}`);
    expect(result.marker).not.toContain(sentCode);
  });

  it("sends the code in both body and button params", async () => {
    const client = fakeClient({ success: true });
    const provider = new WhatsAppOtpProvider(client as never);

    await provider.send({ phoneE164: "+919044904818", languageCode: "hi" });

    const msg = client.sendTemplate.mock.calls[0][0];
    expect(msg.templateName).toBe("cribliv_login_otp");
    expect(msg.languageCode).toBe("hi");
    expect(msg.buttonParams).toEqual(msg.bodyParams);
  });

  it("defaults to the en template language", async () => {
    const client = fakeClient({ success: true });
    const provider = new WhatsAppOtpProvider(client as never);

    await provider.send({ phoneE164: "+919044904818" });

    expect(client.sendTemplate.mock.calls[0][0].languageCode).toBe("en");
  });

  it("throws OtpUndeliverableError when Meta reports no WhatsApp account", async () => {
    const client = fakeClient({ success: false, error: "(#131026) Message undeliverable" });
    const provider = new WhatsAppOtpProvider(client as never);

    await expect(provider.send({ phoneE164: "+919044904818" })).rejects.toBeInstanceOf(
      OtpUndeliverableError
    );
  });

  it("throws a generic error on a transient failure, not undeliverable", async () => {
    const client = fakeClient({ success: false, error: "ETIMEDOUT" });
    const provider = new WhatsAppOtpProvider(client as never);

    const promise = provider.send({ phoneE164: "+919044904818" });
    await expect(promise).rejects.toThrow();
    await expect(promise).rejects.not.toBeInstanceOf(OtpUndeliverableError);
  });

  it("verifies the correct code", async () => {
    const provider = new WhatsAppOtpProvider(fakeClient({ success: true }) as never);

    await expect(
      provider.verify({ marker: `wa:${hashOtp("123456")}`, phoneE164: "+91", code: "123456" })
    ).resolves.toBeUndefined();
  });

  it("rejects a wrong code as invalid_otp", async () => {
    const provider = new WhatsAppOtpProvider(fakeClient({ success: true }) as never);

    await expect(
      provider.verify({ marker: `wa:${hashOtp("123456")}`, phoneE164: "+91", code: "000000" })
    ).rejects.toBeInstanceOf(OtpVerifyError);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `pnpm --filter @cribliv/api exec vitest run test/whatsapp-otp.provider.test.ts`
Expected: FAIL — cannot resolve `whatsapp-otp.provider`.

- [ ] **Step 3: Implement the provider**

Create `apps/api/src/modules/auth/otp/whatsapp-otp.provider.ts`:

```typescript
import { HttpException, HttpStatus, Inject, Injectable } from "@nestjs/common";
import { createHash, randomInt, timingSafeEqual } from "crypto";
import { WhatsAppClient } from "../../notifications/whatsapp.client";
import {
  MARKER_PREFIX_WHATSAPP,
  OtpUndeliverableError,
  OtpVerifyError,
  type OtpProvider,
  type OtpSendResult
} from "./otp-provider.interface";

/**
 * WhatsApp OTP via Meta Cloud API authentication templates.
 *
 * Unlike D7, Meta neither generates nor verifies codes — it only delivers a
 * message. So this provider is self-managed: we mint the code, persist only
 * its SHA-256, and compare digests on verify. Nothing recoverable is stored.
 *
 * Authentication template content is fixed by Meta ("<CODE> is your
 * verification code") and the code must appear in BOTH the body parameter and
 * the copy-code button parameter.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates
 */

const DEFAULT_EXPIRY_SEC = 300;

/** Meta error codes meaning this recipient can never receive on WhatsApp. */
const UNDELIVERABLE_PATTERNS = [/\b131026\b/, /\b131051\b/, /undeliverable/i];

export function hashOtp(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

@Injectable()
export class WhatsAppOtpProvider implements OtpProvider {
  readonly name = "whatsapp" as const;

  constructor(@Inject(WhatsAppClient) private readonly client: WhatsAppClient) {}

  async send(input: { phoneE164: string; languageCode?: string }): Promise<OtpSendResult> {
    const templateName = process.env.WHATSAPP_OTP_TEMPLATE_NAME?.trim();
    if (!templateName) {
      throw new HttpException(
        {
          code: "otp_provider_misconfigured",
          message: "WHATSAPP_OTP_TEMPLATE_NAME is required for the whatsapp channel"
        },
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }

    const otp = String(randomInt(100000, 999999));
    const result = await this.client.sendTemplate({
      to: input.phoneE164,
      templateName,
      languageCode: input.languageCode ?? "en",
      bodyParams: [otp],
      buttonParams: [otp]
    });

    if (!result.success) {
      const error = result.error ?? "unknown";
      // A recipient with no WhatsApp account is a permanent condition, so
      // AuthService should fall back to SMS immediately. A timeout or 5xx is
      // transient and must NOT silently burn an expensive SMS.
      if (UNDELIVERABLE_PATTERNS.some((pattern) => pattern.test(error))) {
        throw new OtpUndeliverableError(error);
      }
      throw new HttpException(
        { code: "otp_provider_error", message: "Failed to send OTP. Please try again." },
        HttpStatus.BAD_GATEWAY
      );
    }

    return {
      marker: `${MARKER_PREFIX_WHATSAPP}${hashOtp(otp)}`,
      expirySec: this.expirySec()
    };
  }

  async verify(input: { marker: string; code: string }): Promise<void> {
    const expectedHex = input.marker.slice(MARKER_PREFIX_WHATSAPP.length);
    const expected = Buffer.from(expectedHex, "hex");
    const provided = createHash("sha256").update(input.code, "utf8").digest();

    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
      throw new OtpVerifyError("invalid_otp", "Invalid OTP");
    }
  }

  private expirySec(): number {
    const raw = Number(process.env.WHATSAPP_OTP_EXPIRY_SEC);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_EXPIRY_SEC;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/whatsapp-otp.provider.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/otp/whatsapp-otp.provider.ts \
        apps/api/test/whatsapp-otp.provider.test.ts
git commit --no-verify -m "feat(api): add WhatsApp OTP provider with hashed code storage"
```

---

### Task 5: Channel resolver

Deliberately a pure function of its inputs — no database, no side effects — so the gate logic is exhaustively testable.

**Files:**
- Create: `apps/api/src/modules/auth/otp/otp-provider.resolver.ts`
- Test: `apps/api/test/otp-provider.resolver.test.ts`

**Interfaces:**
- Consumes: the three providers from Tasks 3–4; marker prefixes from Task 1
- Produces: `OtpProviderResolver` with
  `forSend(input: { requestedChannel?: "whatsapp" | "sms"; recentWhatsAppAttempts: number }): OtpProvider`,
  `forMarker(marker: string): OtpProvider`,
  `isSmsFallbackAvailable(recentWhatsAppAttempts: number): boolean`,
  `sms(): OtpProvider`,
  and the exported constant `WHATSAPP_ATTEMPTS_BEFORE_SMS = 2`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/otp-provider.resolver.test.ts`:

```typescript
import { afterEach, describe, expect, it } from "vitest";
import { OtpProviderResolver } from "../src/modules/auth/otp/otp-provider.resolver";

const mock = { name: "mock" } as never;
const whatsapp = { name: "whatsapp" } as never;
const d7 = { name: "d7" } as never;

function makeResolver() {
  return new OtpProviderResolver(mock, whatsapp, d7);
}

afterEach(() => {
  delete process.env.OTP_PROVIDER;
  delete process.env.OTP_CHANNEL_PRIMARY;
});

describe("OtpProviderResolver.forSend", () => {
  it("returns d7 when OTP_CHANNEL_PRIMARY is unset (ships inert)", () => {
    process.env.OTP_PROVIDER = "d7";
    expect(makeResolver().forSend({ recentWhatsAppAttempts: 0 }).name).toBe("d7");
  });

  it("returns whatsapp when OTP_CHANNEL_PRIMARY=whatsapp", () => {
    process.env.OTP_PROVIDER = "d7";
    process.env.OTP_CHANNEL_PRIMARY = "whatsapp";
    expect(makeResolver().forSend({ recentWhatsAppAttempts: 0 }).name).toBe("whatsapp");
  });

  it("ignores a requested sms channel while the gate is closed", () => {
    process.env.OTP_PROVIDER = "d7";
    process.env.OTP_CHANNEL_PRIMARY = "whatsapp";
    const resolver = makeResolver();

    expect(resolver.forSend({ requestedChannel: "sms", recentWhatsAppAttempts: 0 }).name).toBe(
      "whatsapp"
    );
    expect(resolver.forSend({ requestedChannel: "sms", recentWhatsAppAttempts: 1 }).name).toBe(
      "whatsapp"
    );
  });

  it("honours a requested sms channel once 2 whatsapp attempts exist", () => {
    process.env.OTP_PROVIDER = "d7";
    process.env.OTP_CHANNEL_PRIMARY = "whatsapp";

    expect(
      makeResolver().forSend({ requestedChannel: "sms", recentWhatsAppAttempts: 2 }).name
    ).toBe("d7");
  });

  it("still defaults to whatsapp past the gate when sms is not requested", () => {
    process.env.OTP_PROVIDER = "d7";
    process.env.OTP_CHANNEL_PRIMARY = "whatsapp";

    expect(makeResolver().forSend({ recentWhatsAppAttempts: 5 }).name).toBe("whatsapp");
  });

  it("returns mock whenever OTP_PROVIDER=mock, ignoring channel config", () => {
    process.env.OTP_PROVIDER = "mock";
    process.env.OTP_CHANNEL_PRIMARY = "whatsapp";

    expect(
      makeResolver().forSend({ requestedChannel: "sms", recentWhatsAppAttempts: 9 }).name
    ).toBe("mock");
  });
});

describe("OtpProviderResolver.isSmsFallbackAvailable", () => {
  it("is false below the threshold and true at or above it", () => {
    process.env.OTP_CHANNEL_PRIMARY = "whatsapp";
    const resolver = makeResolver();

    expect(resolver.isSmsFallbackAvailable(0)).toBe(false);
    expect(resolver.isSmsFallbackAvailable(1)).toBe(false);
    expect(resolver.isSmsFallbackAvailable(2)).toBe(true);
    expect(resolver.isSmsFallbackAvailable(3)).toBe(true);
  });

  it("is false when whatsapp is not the primary channel", () => {
    expect(makeResolver().isSmsFallbackAvailable(5)).toBe(false);
  });
});

describe("OtpProviderResolver.forMarker", () => {
  it("routes a wa marker to whatsapp regardless of current config", () => {
    process.env.OTP_CHANNEL_PRIMARY = "sms";
    expect(makeResolver().forMarker("wa:abcdef").name).toBe("whatsapp");
  });

  it("routes a d7 marker to d7 regardless of current config", () => {
    process.env.OTP_CHANNEL_PRIMARY = "whatsapp";
    expect(makeResolver().forMarker("d7:otp_1").name).toBe("d7");
  });

  it("routes bare digits to mock", () => {
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
import { WhatsAppOtpProvider } from "./whatsapp-otp.provider";
import {
  MARKER_PREFIX_D7,
  MARKER_PREFIX_WHATSAPP,
  type OtpProvider
} from "./otp-provider.interface";

/**
 * Chooses the channel for a send, and routes a verify back to whichever
 * channel issued that code.
 *
 * Pure with respect to its arguments: the caller supplies the recent WhatsApp
 * attempt count because AuthService owns the database. That keeps every gate
 * rule testable without a DB.
 */

/**
 * How many WhatsApp attempts a user must make before the SMS escape hatch is
 * offered. SMS costs ~43x a WhatsApp message on our current route, so the gate
 * exists to keep WhatsApp share high rather than to be user-hostile.
 */
export const WHATSAPP_ATTEMPTS_BEFORE_SMS = 2;

@Injectable()
export class OtpProviderResolver {
  constructor(
    @Inject(MockOtpProvider) private readonly mock: MockOtpProvider,
    @Inject(WhatsAppOtpProvider) private readonly whatsapp: WhatsAppOtpProvider,
    @Inject(D7OtpProvider) private readonly d7: D7OtpProvider
  ) {}

  forSend(input: {
    requestedChannel?: "whatsapp" | "sms";
    recentWhatsAppAttempts: number;
  }): OtpProvider {
    // Mock wins outright: local dev and E2E must never reach a real provider.
    if ((process.env.OTP_PROVIDER ?? "mock").trim().toLowerCase() === "mock") {
      return this.mock;
    }

    if (!this.whatsappIsPrimary()) {
      return this.d7;
    }

    // The gate is enforced here, server-side, so a client cannot reach the
    // expensive channel just by asking for it.
    if (
      input.requestedChannel === "sms" &&
      this.isSmsFallbackAvailable(input.recentWhatsAppAttempts)
    ) {
      return this.d7;
    }

    return this.whatsapp;
  }

  isSmsFallbackAvailable(recentWhatsAppAttempts: number): boolean {
    if (!this.whatsappIsPrimary()) {
      return false;
    }
    return recentWhatsAppAttempts >= WHATSAPP_ATTEMPTS_BEFORE_SMS;
  }

  /**
   * The SMS provider, bypassing the gate. Used only by AuthService when Meta
   * reports the recipient permanently undeliverable on WhatsApp.
   */
  sms(): OtpProvider {
    return this.d7;
  }

  forMarker(marker: string): OtpProvider {
    if (marker.startsWith(MARKER_PREFIX_WHATSAPP)) {
      return this.whatsapp;
    }
    if (marker.startsWith(MARKER_PREFIX_D7)) {
      return this.d7;
    }
    return this.mock;
  }

  private whatsappIsPrimary(): boolean {
    return (process.env.OTP_CHANNEL_PRIMARY ?? "sms").trim().toLowerCase() === "whatsapp";
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @cribliv/api exec vitest run test/otp-provider.resolver.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/auth/otp/otp-provider.resolver.ts \
        apps/api/test/otp-provider.resolver.test.ts
git commit --no-verify -m "feat(api): add OTP channel resolver with server-side SMS gate"
```

---

### Task 6: Wire `AuthService` and the controller

The riskiest task. `test/auth-d7.provider.test.ts` is the gate and must not be edited.

**Files:**
- Modify: `apps/api/src/modules/auth/auth.service.ts` (constructor ~42-46, `sendOtp` ~111-151, `verifyOtp` ~224-241, `handleInvalidDbOtp` ~366)
- Modify: `apps/api/src/modules/auth/auth.controller.ts:23-31`
- Modify: `apps/api/src/modules/auth/auth.module.ts`

**Interfaces:**
- Consumes: `OtpProviderResolver` (Task 5), `OtpVerifyError` and `OtpUndeliverableError` (Task 1)
- Produces: `sendOtp(phone_e164, purpose, clientIp?, channel?)` returning `{ challenge_id, expires_in_sec, retry_after_sec, channel, sms_fallback_available, dev_otp? }`

- [ ] **Step 1: Register providers in `auth.module.ts`**

```typescript
import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { D7OtpClient } from "./d7-otp.client";
import { AdminTotpController } from "./admin-totp/admin-totp.controller";
import { AdminTotpService } from "./admin-totp/admin-totp.service";
import { WhatsAppClient } from "../notifications/whatsapp.client";
import { D7OtpProvider } from "./otp/d7-otp.provider";
import { MockOtpProvider } from "./otp/mock-otp.provider";
import { WhatsAppOtpProvider } from "./otp/whatsapp-otp.provider";
import { OtpProviderResolver } from "./otp/otp-provider.resolver";

@Module({
  controllers: [AuthController, AdminTotpController],
  providers: [
    AuthService,
    D7OtpClient,
    AdminTotpService,
    WhatsAppClient,
    MockOtpProvider,
    WhatsAppOtpProvider,
    D7OtpProvider,
    OtpProviderResolver
  ],
  exports: [AuthService, AdminTotpService]
})
export class AuthModule {}
```

- [ ] **Step 2: Add the resolver to the `AuthService` constructor**

Keep `D7OtpClient` injected in position 3 — `test/auth-d7.provider.test.ts` constructs `new AuthService(appState, database, d7Client)` positionally, so removing or reordering it breaks the gate test. Append the resolver as an optional fourth:

```typescript
  constructor(
    @Inject(AppStateService) private readonly appState: AppStateService,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(D7OtpClient) private readonly d7OtpClient: D7OtpClient,
    @Inject(OtpProviderResolver) private readonly otpProviders?: OtpProviderResolver
  ) {}

  /**
   * test/auth-d7.provider.test.ts constructs AuthService with three positional
   * args, so the resolver can be absent. Fall back to one wired to the
   * injected D7 client in that case.
   */
  private get providers(): OtpProviderResolver {
    if (this.otpProviders) {
      return this.otpProviders;
    }
    return new OtpProviderResolver(
      new MockOtpProvider(),
      new WhatsAppOtpProvider(new WhatsAppClient()),
      new D7OtpProvider(this.d7OtpClient)
    );
  }
```

Add imports:

```typescript
import { WhatsAppClient } from "../notifications/whatsapp.client";
import { MockOtpProvider } from "./otp/mock-otp.provider";
import { WhatsAppOtpProvider } from "./otp/whatsapp-otp.provider";
import { D7OtpProvider } from "./otp/d7-otp.provider";
import { OtpProviderResolver } from "./otp/otp-provider.resolver";
import {
  OtpUndeliverableError,
  OtpVerifyError,
  type OtpSendResult
} from "./otp/otp-provider.interface";
```

- [ ] **Step 3: Add the WhatsApp attempt counter**

Add this private method next to `handleInvalidDbOtp`. No migration is needed — the `wa:` marker prefix already records the channel on every challenge row.

```typescript
  /**
   * Counts WhatsApp OTP attempts for this phone in the last 10 minutes.
   * Drives the SMS fallback gate. Derived from the marker prefix rather than a
   * dedicated column, so no migration is required.
   */
  private async countRecentWhatsAppAttempts(phoneE164: string): Promise<number> {
    const result = await this.database.query<{ count: number }>(
      `
      SELECT count(*)::int AS count
      FROM otp_challenges
      WHERE phone_e164 = $1
        AND otp_hash LIKE 'wa:%'
        AND created_at > now() - interval '10 minutes'
      `,
      [phoneE164]
    );
    return result.rows[0]?.count ?? 0;
  }
```

- [ ] **Step 4: Rewrite the send branch**

Change the signature:

```typescript
  async sendOtp(
    phone_e164: string,
    purpose: string,
    clientIp?: string,
    channel?: "whatsapp" | "sms"
  ) {
```

Then replace everything from `const providerConfig = readOtpProviderConfig();` (~line 111) through the `return` that closes the `d7SendResult` block (~line 151) with:

```typescript
      const recentWhatsAppAttempts = await this.countRecentWhatsAppAttempts(phone_e164);
      let provider = this.providers.forSend({
        requestedChannel: channel,
        recentWhatsAppAttempts
      });

      let sent: OtpSendResult;
      try {
        sent = await provider.send({ phoneE164: phone_e164 });
      } catch (error) {
        // Meta told us this number has no WhatsApp account. That is permanent,
        // so fall through to SMS now rather than making the user burn two more
        // doomed attempts before the escape hatch appears. A transient failure
        // (timeout, 5xx) is NOT caught here — it must surface rather than
        // silently spending an SMS that costs ~43x a WhatsApp message.
        if (error instanceof OtpUndeliverableError) {
          this.logger.log(`WhatsApp undeliverable for ${phone_e164}, falling back to SMS`);
          provider = this.providers.sms();
          sent = await provider.send({ phoneE164: phone_e164 });
        } else {
          throw error;
        }
      }

      const inserted = await this.database.query<{ id: string }>(
        `
        INSERT INTO otp_challenges(phone_e164, purpose, otp_hash, expires_at, status, client_ip)
        VALUES ($1, $2::otp_purpose, $3, now() + ($4::int * interval '1 second'), 'active', $5)
        RETURNING id::text
        `,
        [phone_e164, purpose, sent.marker, sent.expirySec, clientIp || null]
      );

      const attemptsAfterSend =
        provider.name === "whatsapp" ? recentWhatsAppAttempts + 1 : recentWhatsAppAttempts;

      return {
        challenge_id: inserted.rows[0].id,
        expires_in_sec: sent.expirySec,
        retry_after_sec: 30,
        channel: provider.name === "d7" ? ("sms" as const) : (provider.name as "whatsapp" | "mock"),
        sms_fallback_available: this.providers.isSmsFallbackAvailable(attemptsAfterSend),
        ...(sent.devOtp ? { dev_otp: sent.devOtp } : {})
      };
```

This unifies the two previous INSERTs. The mock path previously hardcoded `interval '5 minutes'`; `MockOtpProvider` returns `expirySec: 300`, the same value through the shared parameterised statement.

- [ ] **Step 5: Rewrite the verify branch**

Replace lines ~224-241 (from `const providerOtpId = ...` through the `timingSafeOtpEqual` else-branch) with:

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

- [ ] **Step 6: Mark `handleInvalidDbOtp` as never-returning**

```typescript
  private async handleInvalidDbOtp(
    challengeId: string,
    currentAttemptCount: number
  ): Promise<never> {
```

- [ ] **Step 7: Accept `channel` in the controller**

In `apps/api/src/modules/auth/auth.controller.ts`, replace the `sendOtp` handler body:

```typescript
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @Post("auth/otp/send")
  async sendOtp(
    @Body() body: { phone_e164: string; purpose: string; channel?: "whatsapp" | "sms" },
    @Req() req: { ip?: string; headers?: Record<string, string | string[] | undefined> }
  ) {
    // req.ip is proxy-aware when Express trust proxy is configured in main.ts.
    const clientIp = req.ip || "unknown";
    return ok(
      await this.authService.sendOtp(body.phone_e164, body.purpose, clientIp, body.channel)
    );
  }
```

- [ ] **Step 8: Clean up unused imports**

`readOtpProviderConfig`, `randomInt` and `D7OtpVerifyError` may now be unreferenced in `auth.service.ts`. Check before deleting — `randomInt` is still used by `sendOtpInMemory`:

Run: `grep -n "randomInt\|readOtpProviderConfig\|D7OtpVerifyError\|timingSafeOtpEqual" apps/api/src/modules/auth/auth.service.ts`

Remove only genuinely unused imports. Keep the exported `timingSafeOtpEqual` function even if now unreferenced — it is part of the module's public surface.

Run: `pnpm --filter @cribliv/api exec tsc --noEmit`
Expected: exit 0, no "declared but never read" errors.

- [ ] **Step 9: Run the D7 regression gate**

Run: `pnpm --filter @cribliv/api exec vitest run test/auth-d7.provider.test.ts`
Expected: PASS, 4 tests, file unmodified.

If any fail, the refactor changed D7 behaviour. Fix the source, never the test.

- [ ] **Step 10: Run the full slice suite**

Run: `pnpm --filter @cribliv/api exec vitest run test/auth-d7.provider.test.ts test/whatsapp-otp.provider.test.ts test/otp-provider.resolver.test.ts test/whatsapp-client-auth-template.test.ts src/modules/auth`
Expected: all PASS.

Do **not** run the full API suite against a live `TEST_DATABASE_URL` — migration 0045's rollback drops `keyword_rankings` and `seo_indexing_queue`.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/auth/auth.service.ts \
        apps/api/src/modules/auth/auth.controller.ts \
        apps/api/src/modules/auth/auth.module.ts
git commit --no-verify -m "feat(api): route OTP through channel resolver with WhatsApp-first support"
```

---

### Task 7: Env plumbing, inert verification, PR

**Files:**
- Modify: `.env.example`
- Modify: `infra/set-env-vars.sh`

- [ ] **Step 1: Document the env vars**

Append to `.env.example` after the existing D7 block:

```bash
# --- OTP channel selection ---
# whatsapp = send login OTP over WhatsApp first, with D7 SMS as a gated
# fallback (offered only after 2 WhatsApp attempts). Defaults to sms, so the
# WhatsApp code path is inert until this is deliberately flipped.
OTP_CHANNEL_PRIMARY=sms

# --- WhatsApp (Meta Cloud API, direct — no BSP) ---
# Requires a Meta Business Portfolio registered under the INDIAN entity.
# A non-Indian entity is billed at the authentication-international rate
# (~22x more per message). No DLT registration is required for WhatsApp.
WHATSAPP_PROVIDER=mock
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_API_TOKEN=
# Approved authentication template; content is fixed by Meta and must contain
# the code placeholder. Needs approving in both en and hi.
WHATSAPP_OTP_TEMPLATE_NAME=
WHATSAPP_OTP_EXPIRY_SEC=300
```

- [ ] **Step 2: Add the vars to the Azure deploy script**

In `infra/set-env-vars.sh`, add beside the existing `OTP_PROVIDER` default (~line 64):

```bash
OTP_CHANNEL_PRIMARY="${OTP_CHANNEL_PRIMARY:-sms}"
WHATSAPP_OTP_TEMPLATE_NAME="${WHATSAPP_OTP_TEMPLATE_NAME:-}"
WHATSAPP_OTP_EXPIRY_SEC="${WHATSAPP_OTP_EXPIRY_SEC:-300}"
```

And in the `az containerapp update` argument list beside `OTP_PROVIDER="${OTP_PROVIDER}"` (~line 130):

```bash
    OTP_CHANNEL_PRIMARY="${OTP_CHANNEL_PRIMARY}" \
    WHATSAPP_OTP_TEMPLATE_NAME="${WHATSAPP_OTP_TEMPLATE_NAME}" \
    WHATSAPP_OTP_EXPIRY_SEC="${WHATSAPP_OTP_EXPIRY_SEC}" \
```

- [ ] **Step 3: Prove the change is inert by default**

```bash
cd apps/api && env -u OTP_CHANNEL_PRIMARY -u WHATSAPP_OTP_TEMPLATE_NAME OTP_PROVIDER=d7 \
  pnpm exec vitest run test/auth-d7.provider.test.ts test/otp-provider.resolver.test.ts
```

Expected: PASS. With `OTP_CHANNEL_PRIMARY` unset the resolver returns D7 for every send, and `sms_fallback_available` is always false.

- [ ] **Step 4: Prove mock still wins for local dev**

```bash
cd apps/api && OTP_PROVIDER=mock OTP_CHANNEL_PRIMARY=whatsapp \
  pnpm exec vitest run test/otp-provider.resolver.test.ts
```

Expected: PASS — E2E and local logins never reach a real provider.

- [ ] **Step 5: Lint and typecheck**

```bash
pnpm --filter @cribliv/api lint && pnpm --filter @cribliv/api exec tsc --noEmit
```

Expected: exit 0 both.

- [ ] **Step 6: Open the PR**

```bash
git push -u origin claude/msg91-sms-integration-578a86
```

PR body must state: ships inert (`OTP_CHANNEL_PRIMARY` defaults to `sms`), no env changes needed at merge, the web UI is a separate slice, and go-live is blocked on Meta business verification plus template approval in `en` and `hi`.

---

## Slice 2 (not this plan): web UI

Three call sites need the same treatment, and the logic should live in one shared hook rather than being written three times:

- `apps/web/app/[locale]/auth/login/page.tsx:115`
- `apps/web/app/auth/login/page.tsx:123`
- `apps/web/components/unlock-contact-panel.tsx:170`

Behaviour: no channel picker; show "Sent to your WhatsApp" using the response's `channel`; a "Resend on WhatsApp" control after `retry_after_sec`; and render "Didn't get it? Send by SMS instead" only when `sms_fallback_available` is true, posting `{ channel: "sms" }`.

## Go-live runbook (not code — do not execute during implementation)

1. Create a Meta Business Portfolio **under the Indian entity** and submit business verification (CoI or GST certificate). 2–5 business days. Until it clears you are capped at 250 business-initiated conversations/24h.
2. Add a dedicated phone number not active in the WhatsApp consumer app.
3. Create and get approved an authentication template in **both `en` and `hi`**.
4. Set `WHATSAPP_PROVIDER=meta`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_TOKEN`, `WHATSAPP_OTP_TEMPLATE_NAME` on `cribliv-api`. Leave `OTP_CHANNEL_PRIMARY=sms`. Nothing changes yet.
5. Ship slice 2 (web UI).
6. Flip `OTP_CHANNEL_PRIMARY=whatsapp`. Watch the WhatsApp/SMS split and Meta's delivery-failure rate.
7. Rollback at any point: `OTP_CHANNEL_PRIMARY=sms`. In-flight `wa:` challenges still verify, because verify routes by marker.
8. Migrate the WABA to INR billing before 2026-12-31 or Meta stops delivering from 2027-01-01.
