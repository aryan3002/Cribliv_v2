# Lead Monetization Slice 2 (Funnel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the signup funnel per spec §5–§6: SEO-safe guest gating (blur listing cards after the first 6, gate listing photos beyond the first), a one-time welcome-credits celebration for new users, login-page benefit messaging, and the Hindi/i18n sweep of all monetization strings.

**Architecture:** Guest gating is a client `GuestGate` wrapper around server-rendered children — content stays in the SSR HTML (search results are already server-rendered; verified), only the blur+CTA overlay is client logic, behind `NEXT_PUBLIC_FF_GUEST_GATING` (default OFF). `is_new_user` — currently dropped at the NextAuth boundary — gets threaded authorize → jwt → session, and a `WelcomeCreditsModal` mounted in the `[locale]` layout fires once per user (localStorage guard) on their first landing after signup. All new user-facing strings live in `lib/i18n.ts` with real Hindi, and Slice-1's hardcoded monetization strings are converted to `t()`.

**Tech Stack:** Next.js 14 App Router (server components + client islands), next-auth 5 beta (Credentials/JWT), framer-motion (already a dependency — used for the count-up), Vitest (web unit), Playwright (E2E).

## Global Constraints

- Gating threshold: first **6** cards ungated, 7th+ gated. Flag `NEXT_PUBLIC_FF_GUEST_GATING` via `useFlag("ff_guest_gating")` (env OR PostHog), **default OFF** — flag off must render everything exactly as today.
- **No bot special-casing anywhere.** Gated card content must remain in the served HTML (blur via CSS; overlay is additive). Blur is friction, not security (spec §5, accepted).
- New-user grant is **2** credits (server-side, already live); the celebration counts 0 → **2** (literal, not walletBalance — the mock API path reads balance 0 for new users).
- Celebration copy (verbatim keys below): tenant _"You've got 2 free credits — request callbacks and get a call within 24 hours."_; owner/pg_operator _"Welcome! Your first 2 tenant leads are free."_ Shown exactly once per user: localStorage key `cribliv:welcome-credits-shown:<userId>`.
- Locale is ALWAYS a prop or `params.locale` — never `useParams` (repo convention, verified). `t(locale, key)` from `apps/web/lib/i18n.ts`; interpolation placeholders (`{n}`, `{time}`) are replaced by callers via `.replace()`.
- Hindi copy must be real translations (`hi !== en`); a native-speaker pass is a tracked follow-up, same as listening-hero.
- Branch: continue on `feat/lead-monetization` (PR #43 picks the commits up). Worktree: `.claude/worktrees/lead-monetization`.
- Gates per task: `pnpm --filter @cribliv/web typecheck` (repo `lint` is broken pre-existing — skip) and `pnpm --filter @cribliv/web test` where the task adds unit tests. After editing `packages/shared-types` (not expected this slice): rebuild it.
- Commits: conventional prefixes ending with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: i18n dictionary — all monetization + funnel keys (EN + HI)

**Files:**

- Modify: `apps/web/lib/i18n.ts` (append to the dictionary object, before the closing `};`)
- Test: `apps/web/lib/__tests__/i18n-monetization.test.ts` (create; check where existing web unit tests live — if `apps/web/lib/__tests__/` doesn't exist, mirror wherever `pnpm --filter @cribliv/web test` discovers tests, e.g. `apps/web/app/[locale]/__tests__/`)

**Interfaces:**

- Consumes: existing `Dictionary` shape `Record<string, { en: string; hi: string }>` and `t(locale, key)`.
- Produces: the exact keys below — Tasks 3–8 consume them verbatim. Placeholders `{n}`, `{time}` are caller-replaced.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/__tests__/i18n-monetization.test.ts
import { describe, it, expect } from "vitest";
import { t } from "../i18n";

const KEYS = [
  "cbGuaranteeIntro",
  "cbRequestButton",
  "cbVerifyButton",
  "cbRequestedTitle",
  "cbStepRequested",
  "cbStepOwnerNotified",
  "cbStepCallOnWay",
  "cbRefundReassure",
  "cbGuestHint",
  "cbMyCallbacks",
  "cbGuaranteeLine",
  "cbGotCall",
  "cbNoCall",
  "cbRefundedCaption",
  "cbConfirmedCaption",
  "cbDisputedCaption",
  "cbCallMadePrompt",
  "cbEmptyState",
  "cbLoginPrompt",
  "leadFreeBadge",
  "leadUnlockButton",
  "leadCallNow",
  "leadCallAgain",
  "leadCallReminder",
  "leadExpired",
  "leadNoCredits",
  "leadBuyPackSub",
  "leadBuyPackButton",
  "leadPaidRefresh",
  "leadOpenUpi",
  "leadCreditsAdded",
  "gateHeadline",
  "gateSub",
  "gateButton",
  "galleryGateCta",
  "welcomeTitle",
  "welcomeTenantBody",
  "welcomeOwnerBody",
  "welcomeCta",
  "loginBenefitsTitle",
  "loginBenefit1",
  "loginBenefit2",
  "loginBenefit3"
] as const;

describe("monetization i18n keys", () => {
  it.each(KEYS)("%s exists in both locales with real Hindi", (key) => {
    const en = t("en", key);
    const hi = t("hi", key);
    expect(en, `${key} en missing`).not.toBe(key); // t() returns the key when missing
    expect(hi, `${key} hi missing`).not.toBe(key);
    expect(hi, `${key} hi is a stub`).not.toBe(en);
  });

  it("keeps caller placeholders intact", () => {
    expect(t("en", "cbStepCallOnWay")).toContain("{time}");
    expect(t("hi", "cbStepCallOnWay")).toContain("{time}");
    expect(t("en", "cbRefundReassure")).toContain("{n}");
    expect(t("hi", "cbRefundReassure")).toContain("{n}");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- i18n-monetization`
Expected: FAIL — every key resolves to itself (missing).

- [ ] **Step 3: Add the dictionary block**

Append inside the `dictionary` object in `apps/web/lib/i18n.ts` (before the closing `};`):

```ts
  // ── Lead monetization: tenant callback flow ────────────────────────────────
  cbGuaranteeIntro: {
    en: "Use 1 credit — you'll get a call for this property within 24 hours. If nobody calls, your credit comes back automatically. Guaranteed.",
    hi: "1 क्रेडिट में — इस प्रॉपर्टी के लिए 24 घंटे के भीतर आपको कॉल आएगी। कॉल न आए तो आपका क्रेडिट अपने आप वापस। गारंटीड।"
  },
  cbRequestButton: { en: "Request Callback", hi: "कॉलबैक का अनुरोध करें" },
  cbVerifyButton: { en: "Verify & Request Callback", hi: "सत्यापित करें और कॉलबैक पाएं" },
  cbRequestedTitle: { en: "Callback requested ✓", hi: "कॉलबैक अनुरोध हो गया ✓" },
  cbStepRequested: { en: "Requested ✓", hi: "अनुरोध हो गया ✓" },
  cbStepOwnerNotified: { en: "Owner notified ✓", hi: "मालिक को सूचित किया गया ✓" },
  cbStepCallOnWay: { en: "Call on its way — by {time}", hi: "कॉल आने वाली है — {time} तक" },
  cbRefundReassure: {
    en: "No call by then? Your credit comes back automatically. Credits left: {n}",
    hi: "तब तक कॉल नहीं? आपका क्रेडिट अपने आप वापस आ जाएगा। बचे क्रेडिट: {n}"
  },
  cbGuestHint: {
    en: "Guest browsing is open. Sign in with OTP to request a callback — new accounts get 2 free credits.",
    hi: "मेहमान के तौर पर ब्राउज़िंग खुली है। कॉलबैक के लिए OTP से साइन इन करें — नए खातों को 2 मुफ़्त क्रेडिट मिलते हैं।"
  },
  cbMyCallbacks: { en: "My Callbacks", hi: "मेरी कॉलबैक" },
  cbGuaranteeLine: {
    en: "Every request is guaranteed: a call within 24 hours or your credit back.",
    hi: "हर अनुरोध की गारंटी: 24 घंटे में कॉल या आपका क्रेडिट वापस।"
  },
  cbGotCall: { en: "Yes, I got the call", hi: "हाँ, मुझे कॉल आई" },
  cbNoCall: { en: "No call — refund my credit", hi: "कॉल नहीं आई — मेरा क्रेडिट वापस करें" },
  cbRefundedCaption: {
    en: "Nobody called in time, so your credit came back automatically.",
    hi: "समय पर किसी ने कॉल नहीं की, इसलिए आपका क्रेडिट अपने आप वापस आ गया।"
  },
  cbConfirmedCaption: { en: "Confirmed — glad the call happened.", hi: "पुष्टि हो गई — अच्छा लगा कि कॉल हुई।" },
  cbDisputedCaption: {
    en: "Dispute recorded — your credit was refunded.",
    hi: "शिकायत दर्ज — आपका क्रेडिट वापस कर दिया गया।"
  },
  cbCallMadePrompt: { en: "Call made — did you get it?", hi: "कॉल की गई — क्या आपको मिली?" },
  cbEmptyState: {
    en: "No callback requests yet. Find a property and request a callback.",
    hi: "अभी कोई कॉलबैक अनुरोध नहीं। कोई प्रॉपर्टी चुनें और कॉलबैक मांगें।"
  },
  cbLoginPrompt: { en: "Please log in to see your callbacks.", hi: "अपनी कॉलबैक देखने के लिए कृपया लॉग इन करें।" },
  // ── Lead monetization: owner lead cards ────────────────────────────────────
  leadFreeBadge: { en: "FREE LEAD", hi: "मुफ़्त लीड" },
  leadUnlockButton: { en: "Unlock for 1 credit", hi: "1 क्रेडिट में अनलॉक करें" },
  leadCallNow: { en: "Call now", hi: "अभी कॉल करें" },
  leadCallAgain: { en: "Call again", hi: "फिर कॉल करें" },
  leadCallReminder: {
    en: "Call before the timer ends or the tenant is refunded.",
    hi: "टाइमर खत्म होने से पहले कॉल करें वरना किरायेदार को रिफंड हो जाएगा।"
  },
  leadExpired: { en: "Expired — respond faster next time.", hi: "समय समाप्त — अगली बार जल्दी जवाब दें।" },
  leadNoCredits: { en: "Not enough lead credits", hi: "लीड क्रेडिट कम हैं" },
  leadBuyPackSub: {
    en: "Buy 5 lead credits for ₹299 to unlock tenant contacts instantly.",
    hi: "किरायेदार का नंबर तुरंत अनलॉक करने के लिए ₹299 में 5 लीड क्रेडिट खरीदें।"
  },
  leadBuyPackButton: { en: "Buy 5 credits — ₹299", hi: "5 क्रेडिट खरीदें — ₹299" },
  leadPaidRefresh: { en: "I've paid — refresh", hi: "भुगतान कर दिया — रीफ्रेश करें" },
  leadOpenUpi: { en: "Open UPI App", hi: "UPI ऐप खोलें" },
  leadCreditsAdded: { en: "Credits added — unlock the lead now.", hi: "क्रेडिट जुड़ गए — अब लीड अनलॉक करें।" },
  // ── Guest gating ────────────────────────────────────────────────────────────
  gateHeadline: { en: "Sign up free — get 2 credits", hi: "मुफ़्त साइन अप करें — 2 क्रेडिट पाएं" },
  gateSub: { en: "Owners call you back within 24 hours.", hi: "मालिक 24 घंटे के भीतर आपको कॉल करते हैं।" },
  gateButton: { en: "Create free account", hi: "मुफ़्त खाता बनाएं" },
  galleryGateCta: { en: "Sign up free to see all photos", hi: "सभी फ़ोटो देखने के लिए मुफ़्त साइन अप करें" },
  // ── Welcome credits celebration ────────────────────────────────────────────
  welcomeTitle: { en: "Welcome to Cribliv! 🎉", hi: "Cribliv में आपका स्वागत है! 🎉" },
  welcomeTenantBody: {
    en: "You've got 2 free credits — request callbacks and get a call within 24 hours.",
    hi: "आपको 2 मुफ़्त क्रेडिट मिले हैं — कॉलबैक मांगें और 24 घंटे के भीतर कॉल पाएं।"
  },
  welcomeOwnerBody: {
    en: "Welcome! Your first 2 tenant leads are free.",
    hi: "स्वागत है! आपकी पहली 2 किरायेदार लीड मुफ़्त हैं।"
  },
  welcomeCta: { en: "Start exploring", hi: "खोजना शुरू करें" },
  // ── Login page benefits ─────────────────────────────────────────────────────
  loginBenefitsTitle: { en: "Why sign up?", hi: "साइन अप क्यों करें?" },
  loginBenefit1: { en: "2 free credits on signup", hi: "साइन अप पर 2 मुफ़्त क्रेडिट" },
  loginBenefit2: {
    en: "Guaranteed callback in 24 hours — or your credit back",
    hi: "24 घंटे में कॉलबैक की गारंटी — वरना क्रेडिट वापस"
  },
  loginBenefit3: { en: "Verified listings, no brokers", hi: "सत्यापित लिस्टिंग, कोई ब्रोकर नहीं" },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- i18n-monetization && pnpm --filter @cribliv/web typecheck`
Expected: PASS (2 test groups), typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/i18n.ts apps/web/lib/__tests__/i18n-monetization.test.ts
git commit -m "feat(web): monetization + funnel i18n keys with Hindi copy

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Thread `is_new_user` through NextAuth

**Files:**

- Modify: `apps/web/auth.config.ts` (`OtpVerifyResponse` interface :13-22, `authorize()` :36-82, `jwt` callback :90-135, `session` callback :141-170)
- Modify: `apps/web/auth.ts` (module augmentation :21-56)
- Test: `apps/web/lib/__tests__/auth-is-new-user.test.ts`

**Interfaces:**

- Consumes: API `/auth/otp/verify` response already carries `is_new_user: boolean` (verified in `auth.service.ts:299`).
- Produces: `session.isNewUser?: boolean` — Task 3's modal reads it via `useSession()`. `User.isNewUser: boolean`, `JWT.isNewUser?: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/__tests__/auth-is-new-user.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { authConfig } from "../../auth.config";

const VERIFY_PAYLOAD = {
  data: {
    access_token: "acc_test",
    refresh_token: "ref_test",
    is_new_user: true,
    user: { id: "u1", phone_e164: "+919999999902", role: "tenant", preferred_language: "en" }
  }
};

afterEach(() => vi.unstubAllGlobals());

describe("is_new_user threading", () => {
  it("authorize() returns isNewUser from the verify response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => VERIFY_PAYLOAD }))
    );
    const provider = authConfig.providers[0] as {
      authorize: (c: unknown) => Promise<Record<string, unknown> | null>;
    };
    const user = await provider.authorize({
      challengeId: "ch1",
      otpCode: "123456",
      phone: "+919999999902"
    });
    expect(user?.isNewUser).toBe(true);
  });

  it("jwt callback persists isNewUser on first sign-in", async () => {
    const jwt = authConfig.callbacks!.jwt! as (args: {
      token: Record<string, unknown>;
      user?: Record<string, unknown>;
    }) => Promise<Record<string, unknown>>;
    const token = await jwt({
      token: {},
      user: {
        id: "u1",
        phone: "+919999999902",
        role: "tenant",
        preferredLanguage: "en",
        accessToken: "acc_test",
        refreshToken: null,
        tokenIssuedAt: Date.now(),
        isNewUser: true
      }
    });
    expect(token.isNewUser).toBe(true);
  });
});
```

(Adjust the `authorize` extraction if the Credentials provider wraps it — inspect `authConfig.providers[0]` shape at runtime; next-auth v5 exposes `options.authorize` on some builds. If the provider object nests it, use `(authConfig.providers[0] as any).options?.authorize ?? (authConfig.providers[0] as any).authorize` — keep the test asserting behavior, not internals.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- auth-is-new-user`
Expected: FAIL — `isNewUser` undefined in both cases.

- [ ] **Step 3: Implement**

`apps/web/auth.config.ts`:

1. `OtpVerifyResponse` gains `is_new_user?: boolean;`
2. `authorize()` return object gains `isNewUser: data.is_new_user ?? false,`
3. `jwt` callback first-sign-in branch gains `isNewUser: user.isNewUser,` in the returned object.
4. `session` callback, inside `if (token)`: add `session.isNewUser = Boolean(token.isNewUser);`

`apps/web/auth.ts` augmentation:

- `Session` gains `/** True only during the session created by first-ever OTP verify (signup). */ isNewUser?: boolean;`
- `User` gains `isNewUser: boolean;`
- `JWT` gains `isNewUser?: boolean;`

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @cribliv/web test -- auth-is-new-user && pnpm --filter @cribliv/web typecheck`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/auth.config.ts apps/web/auth.ts apps/web/lib/__tests__/auth-is-new-user.test.ts
git commit -m "feat(web): thread is_new_user from OTP verify into the NextAuth session

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: WelcomeCreditsModal + layout mount

**Files:**

- Create: `apps/web/components/welcome-credits-modal.tsx`
- Create: `apps/web/lib/welcome-credits.ts` (pure gating helper)
- Modify: `apps/web/app/[locale]/layout.tsx:38-45` (mount next to `PageviewTracker`)
- Test: `apps/web/lib/__tests__/welcome-credits.test.ts`

**Interfaces:**

- Consumes: `session.isNewUser` + `session.user.id` + `session.user.role` (Task 2); i18n keys `welcomeTitle`, `welcomeTenantBody`, `welcomeOwnerBody`, `welcomeCta` (Task 1); `.modal-overlay`/`.modal` classes from `globals.css` (existing, see `boost-modal.tsx`); `framer-motion`.
- Produces: `<WelcomeCreditsModal locale={locale} />` client component; `shouldShowWelcome(input): boolean` and `markWelcomeShown(userId, storage)` helpers; storage key format `cribliv:welcome-credits-shown:<userId>`.

- [ ] **Step 1: Write the failing test (pure helper)**

```ts
// apps/web/lib/__tests__/welcome-credits.test.ts
import { describe, it, expect } from "vitest";
import { shouldShowWelcome, markWelcomeShown, welcomeStorageKey } from "../welcome-credits";

function memStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    }
  } as Storage;
}

describe("welcome credits gating", () => {
  it("shows once for a new user, then never again", () => {
    const storage = memStorage();
    expect(shouldShowWelcome({ isNewUser: true, userId: "u1", storage })).toBe(true);
    markWelcomeShown("u1", storage);
    expect(shouldShowWelcome({ isNewUser: true, userId: "u1", storage })).toBe(false);
  });

  it("never shows for returning users or missing ids", () => {
    const storage = memStorage();
    expect(shouldShowWelcome({ isNewUser: false, userId: "u1", storage })).toBe(false);
    expect(shouldShowWelcome({ isNewUser: true, userId: undefined, storage })).toBe(false);
  });

  it("keys storage per user", () => {
    expect(welcomeStorageKey("u1")).toBe("cribliv:welcome-credits-shown:u1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- welcome-credits`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the helper**

```ts
// apps/web/lib/welcome-credits.ts
export function welcomeStorageKey(userId: string): string {
  return `cribliv:welcome-credits-shown:${userId}`;
}

export function shouldShowWelcome(input: {
  isNewUser: boolean | undefined;
  userId: string | undefined;
  storage: Storage;
}): boolean {
  if (!input.isNewUser || !input.userId) return false;
  try {
    return input.storage.getItem(welcomeStorageKey(input.userId)) === null;
  } catch {
    return false;
  }
}

export function markWelcomeShown(userId: string, storage: Storage): void {
  try {
    storage.setItem(welcomeStorageKey(userId), new Date().toISOString());
  } catch {
    // Private-mode storage failures just skip the celebration; never crash.
  }
}
```

- [ ] **Step 4: Run helper test to verify it passes**

Run: `pnpm --filter @cribliv/web test -- welcome-credits`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement the modal**

```tsx
// apps/web/components/welcome-credits-modal.tsx
"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { t, type Locale } from "../lib/i18n";
import { shouldShowWelcome, markWelcomeShown } from "../lib/welcome-credits";
import { trackEvent } from "../lib/analytics";

const CONFETTI_PIECES = 24;

/**
 * One-time celebration on a new user's first landing after signup.
 * Fires only when session.isNewUser is set (first-ever OTP verify) and the
 * per-user localStorage marker is absent; marks immediately on open so a
 * mid-animation reload can't re-trigger it.
 */
export function WelcomeCreditsModal({ locale }: { locale: Locale }) {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  const role = session?.user?.role;
  const isOwnerSide = role === "owner" || role === "pg_operator";

  useEffect(() => {
    if (status !== "authenticated") return;
    const s = session as { isNewUser?: boolean; user?: { id?: string } } | null;
    if (
      typeof window !== "undefined" &&
      shouldShowWelcome({
        isNewUser: s?.isNewUser,
        userId: s?.user?.id,
        storage: window.localStorage
      })
    ) {
      markWelcomeShown(s!.user!.id!, window.localStorage);
      setOpen(true);
      trackEvent("welcome_credits_shown", { role: role ?? "tenant" });
    }
  }, [status, session, role]);

  useEffect(() => {
    if (!open) return;
    const timers = [setTimeout(() => setCount(1), 600), setTimeout(() => setCount(2), 1100)];
    return () => timers.forEach(clearTimeout);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal
      aria-label={t(locale, "welcomeTitle")}
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <motion.div
        className="modal"
        style={{
          maxWidth: 420,
          width: "min(420px, 94vw)",
          textAlign: "center",
          overflow: "hidden",
          position: "relative"
        }}
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div aria-hidden="true" style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {Array.from({ length: CONFETTI_PIECES }, (_, i) => (
            <motion.span
              key={i}
              initial={{ y: -20, x: `${(i * 41) % 100}%`, opacity: 1, rotate: 0 }}
              animate={{ y: 480, rotate: 360 * ((i % 3) + 1), opacity: 0 }}
              transition={{ duration: 2.2 + (i % 5) * 0.3, delay: (i % 7) * 0.12, ease: "easeIn" }}
              style={{
                position: "absolute",
                width: 8,
                height: 12,
                borderRadius: 2,
                background: ["#f59e0b", "#22c55e", "#3b82f6", "#ec4899"][i % 4]
              }}
            />
          ))}
        </div>
        <div className="modal__body" style={{ padding: "var(--space-6) var(--space-5)" }}>
          <h2 className="modal__title" style={{ marginBottom: "var(--space-3)" }}>
            {t(locale, "welcomeTitle")}
          </h2>
          <motion.div
            data-testid="welcome-credit-count"
            initial={{ scale: 0.6 }}
            animate={{ scale: count === 2 ? [1.2, 1] : 1 }}
            style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.1 }}
          >
            ✦ {count}
          </motion.div>
          <p
            className="body-sm"
            style={{ color: "var(--text-secondary)", margin: "var(--space-3) 0 var(--space-5)" }}
          >
            {t(locale, isOwnerSide ? "welcomeOwnerBody" : "welcomeTenantBody")}
          </p>
          <button
            type="button"
            className="btn btn--primary"
            style={{ width: "100%" }}
            onClick={() => setOpen(false)}
          >
            {t(locale, "welcomeCta")}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
```

Add `"welcome_credits_shown"` to `analyticsEvents` in `packages/shared-types/src/events.ts` (same pattern as `callback_requested`) and run `pnpm --filter @cribliv/shared-types build`.

- [ ] **Step 6: Mount in the locale layout**

In `apps/web/app/[locale]/layout.tsx`, import `{ WelcomeCreditsModal }` and render inside the fragment, after `LocaleChrome`:

```tsx
      <LocaleChrome locale={params.locale as Locale}>{children}</LocaleChrome>
      <WelcomeCreditsModal locale={params.locale as Locale} />
```

(`LocaleChrome` almost certainly hosts the NextAuth `SessionProvider`; verify `useSession` is available at layout level — if the provider lives inside `LocaleChrome`, move the modal render into `LocaleChrome`'s JSX instead, right after `{children}`. Check `apps/web/components/locale-chrome.tsx` and place accordingly.)

- [ ] **Step 7: Gates**

Run: `pnpm --filter @cribliv/web test -- welcome-credits && pnpm --filter @cribliv/web typecheck && pnpm --filter @cribliv/api exec tsc --noEmit -p tsconfig.json`
Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/welcome-credits-modal.tsx apps/web/lib/welcome-credits.ts apps/web/lib/__tests__/welcome-credits.test.ts apps/web/app/\[locale\]/layout.tsx packages/shared-types/src/events.ts apps/web/components/locale-chrome.tsx
git commit -m "feat(web): one-time welcome-credits celebration for new signups

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: GuestGate component + search-page gating

**Files:**

- Create: `apps/web/components/guest-gate.tsx`
- Modify: `apps/web/app/[locale]/search/page.tsx` (add `await auth()`; wrap cards in the grid loop :394-417)
- Modify: `apps/web/lib/feature-flags.ts` (ENV_FLAG_MAP gains `ff_guest_gating`)
- Test: `apps/web/lib/__tests__/guest-gate.test.ts` (pure slice logic) — the visual behavior is E2E'd in Task 9

**Interfaces:**

- Consumes: i18n keys `gateHeadline`/`gateSub`/`gateButton` (Task 1); `useFlag("ff_guest_gating")`; `auth()` from `apps/web/auth`.
- Produces: `<GuestGate gated locale={locale}>{card}</GuestGate>` — client component; when `gated` is false OR the flag is off, renders children unchanged. Constant `GUEST_FREE_CARDS = 6` exported from `guest-gate.tsx`. Task 5 reuses both.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/__tests__/guest-gate.test.ts
import { describe, it, expect } from "vitest";
import { GUEST_FREE_CARDS, isCardGated } from "../../components/guest-gate";

describe("guest gating threshold", () => {
  it("first 6 cards are never gated", () => {
    for (let i = 0; i < GUEST_FREE_CARDS; i++) {
      expect(isCardGated({ index: i, isGuest: true, flagOn: true })).toBe(false);
    }
  });
  it("7th+ cards gate only for guests with the flag on", () => {
    expect(isCardGated({ index: 6, isGuest: true, flagOn: true })).toBe(true);
    expect(isCardGated({ index: 6, isGuest: false, flagOn: true })).toBe(false);
    expect(isCardGated({ index: 6, isGuest: true, flagOn: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @cribliv/web test -- guest-gate`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement GuestGate**

```tsx
// apps/web/components/guest-gate.tsx
"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useFlag } from "../lib/feature-flags";
import { t, type Locale } from "../lib/i18n";
import { trackEvent } from "../lib/analytics";

export const GUEST_FREE_CARDS = 6;

export function isCardGated(input: { index: number; isGuest: boolean; flagOn: boolean }): boolean {
  return input.flagOn && input.isGuest && input.index >= GUEST_FREE_CARDS;
}

/**
 * SEO-safe guest gate: children (a server-rendered listing card) stay in the
 * HTML; a CSS blur + signup CTA overlays them for logged-out visitors when
 * ff_guest_gating is on. Blur is friction, not security (spec §5).
 */
export function GuestGate({
  gated,
  locale,
  children
}: {
  gated: boolean;
  locale: Locale;
  children: ReactNode;
}) {
  const flagOn = useFlag("ff_guest_gating");
  if (!gated || !flagOn) return <>{children}</>;

  return (
    <div style={{ position: "relative" }} data-testid="guest-gate">
      <div
        style={{ filter: "blur(7px)", pointerEvents: "none", userSelect: "none" }}
        aria-hidden="true"
      >
        {children}
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-2)",
          textAlign: "center",
          padding: "var(--space-4)",
          background: "color-mix(in srgb, var(--surface-default) 55%, transparent)",
          borderRadius: "var(--radius-md)"
        }}
      >
        <p style={{ fontWeight: 700 }}>{t(locale, "gateHeadline")}</p>
        <p className="caption" style={{ color: "var(--text-secondary)" }}>
          {t(locale, "gateSub")}
        </p>
        <Link
          href={`/${locale}/auth/login?tab=signup`}
          className="btn btn--primary btn--sm"
          style={{ textDecoration: "none" }}
          onClick={() => trackEvent("guest_gate_signup_clicked", { surface: "card" })}
        >
          {t(locale, "gateButton")}
        </Link>
      </div>
    </div>
  );
}
```

Add to `analyticsEvents` in `packages/shared-types/src/events.ts`: `"guest_gate_signup_clicked"` (and `"guest_gate_viewed"` for Task 6's gallery), then `pnpm --filter @cribliv/shared-types build`.

Add to `ENV_FLAG_MAP` in `apps/web/lib/feature-flags.ts`:

```ts
ff_guest_gating: process.env.NEXT_PUBLIC_FF_GUEST_GATING;
```

- [ ] **Step 4: Wire the search page**

In `apps/web/app/[locale]/search/page.tsx`:

1. Import: `import { auth } from "../../../auth";` and `import { GuestGate, GUEST_FREE_CARDS } from "../../../components/guest-gate";` (verify relative depth — the page is 3 levels under app/).
2. Inside the async component, before rendering: `const session = await auth();` then `const isGuest = !session?.user?.id;`
3. Replace the card loop (`response.items.map(...)` at ~:394) so each card is wrapped:

```tsx
{
  response.items.map((item, index) => (
    <GuestGate key={item.id} gated={isGuest && index >= GUEST_FREE_CARDS} locale={params.locale}>
      <ListingCardItem
        locale={params.locale}
        listing={{
          id: item.id,
          title: item.title,
          city: item.city,
          city_name: item.city_name ?? cityLabel(item.city),
          locality: item.locality,
          listing_type: item.listing_type,
          monthly_rent: item.monthly_rent,
          bhk: item.bhk ?? null,
          furnishing: item.furnishing ?? null,
          area_sqft: item.area_sqft ?? null,
          verification_status: item.verification_status,
          cover_photo: item.cover_photo ?? null
        }}
      />
    </GuestGate>
  ));
}
```

(Note: `key` moves to `GuestGate`. The `gated` prop bakes in the index check server-side; `isCardGated` is used by the map rail where the flag+guest state is client-side.)

- [ ] **Step 5: Gates**

Run: `pnpm --filter @cribliv/web test -- guest-gate && pnpm --filter @cribliv/web typecheck`
Expected: PASS + clean. Sanity: `pnpm --filter @cribliv/web test` full unit suite still green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/guest-gate.tsx apps/web/lib/__tests__/guest-gate.test.ts apps/web/app/\[locale\]/search/page.tsx apps/web/lib/feature-flags.ts packages/shared-types/src/events.ts
git commit -m "feat(web): SEO-safe guest gating — blur cards after 6 on search (ff_guest_gating)

Co-Authored-By: Claude Fable 5 <noreply@amthropic.com>"
```

(Fix the trailer typo above when committing: `noreply@anthropic.com`.)

---

### Task 5: Map rail gating

**Files:**

- Modify: `apps/web/components/criblmap/MapResultsRail.tsx` (the `orderedPins.slice(0, 12).map(...)` loop :166-174 and `ResultCard`)

**Interfaces:**

- Consumes: `GuestGate` + `isCardGated` (Task 4). Guest detection client-side: `useSession()` from next-auth/react + `readAuthSession()` from `../../lib/client-auth` (same dual-source pattern as `unlock-contact-panel.tsx`).
- Produces: rail cards 7+ gated for guests; no SEO concern (rail is `ssr:false`).

- [ ] **Step 1: Implement**

In `MapResultsRail.tsx`:

1. Imports: `useSession` from `next-auth/react`, `readAuthSession` from the client-auth lib (verify relative path), `GuestGate` from `../guest-gate`, `useFlag` from `../../lib/feature-flags`.
2. Inside the rail component (the one containing the `.map`), derive guest state:

```tsx
const { data: session, status: sessionStatus } = useSession();
const isGuest =
  sessionStatus !== "loading" &&
  !((session as { accessToken?: string } | null)?.accessToken ?? readAuthSession()?.access_token);
const gatingOn = useFlag("ff_guest_gating");
```

3. Wrap each card in the loop:

```tsx
orderedPins.slice(0, 12).map((pin, index) => (
  <GuestGate key={pin.id} gated={isCardGated({ index, isGuest, flagOn: gatingOn })} locale={locale}>
    <ResultCard
      pin={pin}
      selected={pin.id === selectedPinId}
      locale={locale}
      onSelect={() => selectPin(pin)}
    />
  </GuestGate>
));
```

(Note `GuestGate` internally checks the flag again — passing `flagOn` through `isCardGated` keeps the gate's own `useFlag` redundant-but-harmless here; do NOT remove the gate's internal check, Task 4's search page relies on it.)

- [ ] **Step 2: Gates**

Run: `pnpm --filter @cribliv/web typecheck && pnpm --filter @cribliv/web test`
Expected: clean, unit suite green. Manual/E2E verification in Task 9.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/criblmap/MapResultsRail.tsx
git commit -m "feat(web): guest gating on the map results rail

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Listing gallery gating (photos beyond the first)

**Files:**

- Modify: `apps/web/app/[locale]/listing/[listingId]/page.tsx` (add `await auth()`, pass `isGuest` at the `<ListingGallery ...>` call :327-328)
- Modify: `apps/web/components/listing/listing-gallery.tsx`

**Interfaces:**

- Consumes: i18n key `galleryGateCta` (Task 1); `useFlag("ff_guest_gating")`; `auth()`.
- Produces: `ListingGallery` gains optional `isGuest?: boolean`. For gated guests: thumbs (`photos.slice(1,5)`) blurred with one CTA overlay; lightbox restricted to `photos[0]`.

- [ ] **Step 1: Implement page-side**

In `listing/[listingId]/page.tsx`: `import { auth } from "../../../../auth";` (verify depth), inside the component `const session = await auth(); const isGuest = !session?.user?.id;`, and pass `isGuest={isGuest}` to `<ListingGallery photos={photos} title={listing.title} locale={locale} isGuest={isGuest} />`.

- [ ] **Step 2: Implement gallery-side**

In `listing-gallery.tsx`:

1. Props gain `isGuest?: boolean`. Add `const gatingOn = useFlag("ff_guest_gating");` (import from `../../lib/feature-flags`) and `const gated = Boolean(isGuest) && gatingOn;`
2. Thumb grid: wrap the `photos.slice(1, 5).map(...)` block so that when `gated`, each thumb `<img>` gets `style={{ filter: "blur(10px)" }}` and its click handler opens the signup link instead of the lightbox. Concretely, replace the thumb's `onClick` with:

```tsx
            onClick={() => {
              if (gated) {
                trackEvent("guest_gate_viewed", { surface: "gallery" });
                window.location.href = `/${locale}/auth/login?tab=signup`;
                return;
              }
              onPhotoClick?.(i + 1);
              openLightbox();
            }}
```

and add the blur style conditionally: `<img src={url} ... style={gated ? { filter: "blur(10px)" } : undefined} />`. 3. Over the thumb grid, when `gated`, render one absolutely-positioned CTA chip (position the gallery container `relative`):

```tsx
{
  gated ? (
    <Link
      href={`/${locale}/auth/login?tab=signup`}
      className="btn btn--primary btn--sm"
      data-testid="gallery-gate-cta"
      style={{
        position: "absolute",
        bottom: "var(--space-3)",
        left: "50%",
        transform: "translateX(-50%)",
        textDecoration: "none",
        zIndex: 2
      }}
      onClick={() => trackEvent("guest_gate_signup_clicked", { surface: "gallery" })}
    >
      {t(locale, "galleryGateCta")}
    </Link>
  ) : null;
}
```

4. Lightbox: when `gated`, render only `photos.slice(0, 1)` in the lightbox map (the hero photo remains fully viewable; everything else requires signup). The "show all photos" overlay button opens the lightbox as today (which now contains just the hero when gated).
5. Imports needed: `Link` from `next/link`, `useFlag`, `trackEvent`, and `t` is already imported.

- [ ] **Step 3: Gates**

Run: `pnpm --filter @cribliv/web typecheck && pnpm --filter @cribliv/web test`
Expected: clean + green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/\[locale\]/listing/\[listingId\]/page.tsx apps/web/components/listing/listing-gallery.tsx
git commit -m "feat(web): gate listing photos beyond the first for guests

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Login-page benefit messaging + signup-tab deep link

**Files:**

- Modify: `apps/web/app/[locale]/auth/login/page.tsx` (tab init :113, tab switcher region :341-369)

**Interfaces:**

- Consumes: i18n keys `loginBenefitsTitle`, `loginBenefit1..3` (Task 1). Gate CTAs (Tasks 4/6) link to `?tab=signup` — this task makes that parameter work.
- Produces: `?tab=signup` opens the Sign up tab; a benefits strip renders under the tab switcher when the signup tab is active.

- [ ] **Step 1: Implement**

1. Tab init honors the query param. The page already reads search params for `from` — find that mechanism (likely `useSearchParams()`), then:

```tsx
const initialTab = searchParams?.get("tab") === "signup" ? "signup" : "login";
const [tab, setTab] = useState<"login" | "signup">(initialTab);
```

2. Under the tab switcher (after the `motion.div` at :341-369), render the benefits strip when `tab === "signup"` (the page pins `const locale = "en"` — use it, the strings are dictionary-backed and switch when the page gains locale support):

```tsx
{
  tab === "signup" ? (
    <div
      className="auth-benefits"
      data-testid="signup-benefits"
      style={{
        margin: "var(--space-3) 0",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-1)"
      }}
    >
      {(["loginBenefit1", "loginBenefit2", "loginBenefit3"] as const).map((key) => (
        <p
          key={key}
          className="caption"
          style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}
        >
          <span aria-hidden="true">✦</span> {t(locale, key)}
        </p>
      ))}
    </div>
  ) : null;
}
```

3. Import `t` from `../../../../lib/i18n` (verify depth; the page already imports from lib — check existing imports).

- [ ] **Step 2: Gates**

Run: `pnpm --filter @cribliv/web typecheck && pnpm --filter @cribliv/web test`
Expected: clean + green.

- [ ] **Step 3: Commit**

```bash
git add apps/web/app/\[locale\]/auth/login/page.tsx
git commit -m "feat(web): signup benefits strip + ?tab=signup deep link on login page

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Convert Slice-1 monetization strings to i18n

**Files:**

- Modify: `apps/web/components/unlock-contact-panel.tsx` (+ its render site `apps/web/app/[locale]/listing/[listingId]/page.tsx` to pass `locale`)
- Modify: `apps/web/components/owner/lead-card.tsx`, `apps/web/components/owner/lead-credits-panel.tsx` (+ `leads-pipeline.tsx` / `dashboard-client.tsx` to thread `locale` if not already present)
- Modify: `apps/web/components/tenant/callbacks-client.tsx` (+ its page to pass `params.locale`)

**Interfaces:**

- Consumes: Task 1 keys, exactly: panel → `cbGuaranteeIntro`, `cbRequestButton`, `cbVerifyButton`, `cbRequestedTitle`, `cbStepRequested`, `cbStepOwnerNotified`, `cbStepCallOnWay` (`{time}` → `refundTimeLabel`), `cbRefundReassure` (`{n}` → credits), `cbGuestHint`; lead card → `leadFreeBadge`, `leadUnlockButton`, `leadCallNow`, `leadCallAgain`, `leadCallReminder`, `leadExpired`; credits panel → `leadNoCredits`, `leadBuyPackSub`, `leadBuyPackButton`, `leadPaidRefresh`, `leadOpenUpi`, `leadCreditsAdded`; callbacks client → `cbMyCallbacks`, `cbGuaranteeLine`, `cbGotCall`, `cbNoCall`, `cbRefundedCaption`, `cbConfirmedCaption`, `cbDisputedCaption`, `cbCallMadePrompt`, `cbStepRequested`, `cbStepOwnerNotified`, `cbStepCallOnWay`, `cbEmptyState`, `cbLoginPrompt`.
- Produces: every flag-ON monetization string renders via `t(locale, …)`; components gain a `locale: Locale` prop (defaulting to `"en"` where threading is impractical is NOT allowed — thread it).

- [ ] **Step 1: Implement, surface by surface**

For each component: add `locale: Locale` to props (import `t, type Locale` from the right relative `lib/i18n` path), replace each hardcoded flag-ON English string with its key from the table above (flag-OFF legacy strings — "Unlock Number", "Unlock contact for 1 credit…" — stay hardcoded; they die with the flag). Interpolations: `t(locale, "cbStepCallOnWay").replace("{time}", refundTimeLabel)` and `t(locale, "cbRefundReassure").replace("{n}", String(unlock.credits_remaining))`.

Thread the prop at every render site:

- `unlock-contact-panel.tsx` is rendered in `listing/[listingId]/page.tsx` (server component — it has `locale`): pass `locale={locale}`.
- `lead-card.tsx` / `lead-credits-panel.tsx`: rendered via `leads-pipeline.tsx` ← `dashboard-client.tsx` / `leads-client.tsx`. Grep each for an existing `locale` prop; the dashboard pages are under `[locale]`, so their server `page.tsx` files have `params.locale` — thread it down the same way `accessToken` was threaded in Slice 1.
- `callbacks-client.tsx`: its `page.tsx` receives `params` — change the page to `export default function TenantCallbacksPage({ params }: { params: { locale: string } })` and pass `locale={isValidLocale(params.locale) ? params.locale : "en"}`.

- [ ] **Step 2: Verify no hardcoded flag-ON strings remain**

Run: `grep -rn "Request Callback\|Unlock for 1 credit\|FREE LEAD\|My Callbacks\|did you get it" apps/web/components apps/web/app --include="*.tsx" | grep -v i18n`
Expected: no hits outside `lib/i18n.ts` (E2E specs in apps/web/tests may still reference the EN strings — that's fine, E2E runs in `en`).

Update any E2E selector in `apps/web/tests/callback-leads.spec.ts` ONLY if this refactor changed the rendered EN text (it should not — the EN values in the dictionary are byte-identical to the old hardcoded strings).

- [ ] **Step 3: Gates**

Run: `pnpm --filter @cribliv/web typecheck && pnpm --filter @cribliv/web test`
Expected: clean + green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/components apps/web/app
git commit -m "feat(web): monetization strings via i18n with Hindi — panel, lead cards, callbacks

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: E2E + full gates

**Files:**

- Create: `apps/web/tests/guest-gating.spec.ts`
- Create: `apps/web/tests/welcome-credits.spec.ts`

**Interfaces:**

- Consumes: flag-guard pattern from `apps/web/tests/listening-hero.spec.ts:7-11`; helpers `loginWithOtp`/`setSessionOnPage` from `apps/web/tests/utils/auth.ts`; testids `guest-gate`, `gallery-gate-cta`, `signup-benefits`, `welcome-credit-count`.

- [ ] **Step 1: Write the guest-gating spec**

```ts
// apps/web/tests/guest-gating.spec.ts
// Run with: NEXT_PUBLIC_FF_GUEST_GATING=true (web) — self-skips otherwise.
import { test, expect } from "@playwright/test";
import { loginWithOtp, setSessionOnPage } from "./utils/auth";

const FLAG_ON =
  process.env.NEXT_PUBLIC_FF_GUEST_GATING === "1" ||
  process.env.NEXT_PUBLIC_FF_GUEST_GATING === "true";

test.describe("guest gating (flag on)", () => {
  test.skip(!FLAG_ON, "NEXT_PUBLIC_FF_GUEST_GATING not set for this run");

  test("guest sees first 6 cards clean, later cards gated with signup CTA", async ({ page }) => {
    await page.goto("/en/search");
    const cards = page.locator(".listing-grid > *");
    const total = await cards.count();
    test.skip(total <= 6, "seed data has too few listings to exercise the gate");
    const gates = page.getByTestId("guest-gate");
    await expect(gates.first()).toBeVisible();
    expect(await gates.count()).toBe(total - 6);
    await expect(gates.first().getByRole("link", { name: "Create free account" })).toBeVisible();
    // SEO: gated card content is still in the served HTML
    const html = await page.content();
    expect(html).toContain("guest-gate");
  });

  test("logged-in tenant sees no gates", async ({ page, request }) => {
    const session = await loginWithOtp(request, "+919999999902");
    await page.goto("/en");
    await setSessionOnPage(page, session);
    await page.goto("/en/search");
    await expect(page.getByTestId("guest-gate")).toHaveCount(0);
  });
});

test.describe("guest gating (flag off guard)", () => {
  test.skip(FLAG_ON, "guard only applies to flag-off runs");
  test("no gates render", async ({ page }) => {
    await page.goto("/en/search");
    await expect(page.getByTestId("guest-gate")).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Write the welcome-credits spec**

```ts
// apps/web/tests/welcome-credits.spec.ts
// Exercises the full NextAuth signup path with a fresh random phone.
import { test, expect } from "@playwright/test";

function randomPhone() {
  return `+9196${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;
}

test("new signup sees the welcome-credits celebration exactly once", async ({ page }) => {
  const phone = randomPhone();
  await page.goto("/en/auth/login?tab=signup");
  await expect(page.getByTestId("signup-benefits")).toBeVisible();

  await page.getByRole("textbox").first().fill(phone);
  const [sendRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/auth/otp/send")),
    page.getByRole("button", { name: /send otp|continue/i }).click()
  ]);
  const otp = (await sendRes.json())?.data?.dev_otp as string;
  expect(otp).toBeTruthy();

  await page.getByRole("textbox").last().fill(otp);
  await page.getByRole("button", { name: /verify/i }).click();

  // Hard navigation to the destination page; modal fires there
  await expect(page.getByTestId("welcome-credit-count")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("welcome-credit-count")).toContainText("2", { timeout: 5_000 });

  await page.getByRole("button", { name: /start exploring/i }).click();
  await page.reload();
  await expect(page.getByTestId("welcome-credit-count")).toHaveCount(0);
});
```

(Adapt the form selectors to the real login page structure — read the page component first; the OTP input and buttons may have specific labels/testids. The `waitForResponse` capture of `dev_otp` is the reliable path with `OTP_PROVIDER=mock`.)

- [ ] **Step 3: Run E2E (three configurations)**

```bash
# gating on:
NEXT_PUBLIC_FF_GUEST_GATING=true PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 \
  pnpm --filter @cribliv/web test:e2e -- guest-gating
# gating off guard:
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 pnpm --filter @cribliv/web test:e2e -- guest-gating
# welcome modal (no gating flag needed):
PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 pnpm --filter @cribliv/web test:e2e -- welcome-credits
# regression: slice-1 E2E still green flag-on
FF_CALLBACK_LEADS=true FF_LEAD_MANAGEMENT_ENABLED=true NEXT_PUBLIC_FF_CALLBACK_LEADS=true \
  PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=mac15-arm64 pnpm --filter @cribliv/web test:e2e -- callback-leads
```

Check ports 3000/4000 are free before each run (`lsof -nP -i :3000 -i :4000`).

- [ ] **Step 4: Full gate battery**

```bash
pnpm --filter @cribliv/shared-types build && pnpm typecheck && pnpm --filter @cribliv/web test && pnpm --filter @cribliv/api test && pnpm build
```

Expected: all green (lint stays broken pre-existing; don't run it as a gate).

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/guest-gating.spec.ts apps/web/tests/welcome-credits.spec.ts
git commit -m "test(web): guest gating + welcome celebration E2E

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Self-review notes (already applied)

- **Spec coverage:** §5 search grid → Task 4; §5 map → Task 5; §5 gallery → Task 6; §5 flag/kill-switch → Tasks 4–6 (all render-paths check `useFlag`); §6 is_new_user threading → Task 2; §6 modal/one-time/role copy → Task 3; §6 pre-signup messaging → Tasks 4 (overlay) + 7 (login page); §9 Hindi acceptance → Tasks 1 + 8. Search Console monitoring after enabling the flag is an ops step (PR body), not a code task.
- Slice 3 (Razorpay checkout widget, pricing tuning, owner upsells) remains out of scope.
- Known simplifications, accepted: the login page stays EN-pinned (its full i18n conversion is pre-existing debt, out of scope — only the new benefits strip is dictionary-backed); the unlock-panel's inline OTP signup path does not fire the celebration (panel users are mid-unlock; the NextAuth path covers the login page funnel this slice builds).
- Hindi strings need a native-speaker pass before launch (tracked follow-up, same as listening-hero).
