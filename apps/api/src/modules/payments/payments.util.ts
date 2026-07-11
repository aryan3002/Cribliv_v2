import { BadRequestException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { readFeatureFlags } from "../../config/feature-flags";

export type PaymentProvider = "razorpay" | "upi";

export type CreditPlanAudience = "tenant" | "owner";

export const CREDIT_PLANS = {
  starter_10: {
    audience: "tenant",
    amountPaise: 9900,
    credits: 10,
    label: "10 callback credits",
    recommended: false
  },
  growth_20: {
    audience: "tenant",
    amountPaise: 19900,
    credits: 20,
    label: "20 callback credits",
    recommended: true
  },
  // Owner lead-unlock packs (placeholder pricing per 2026-07-10 spec §4 — tune before launch)
  leads_5: {
    audience: "owner",
    amountPaise: 29900,
    credits: 5,
    label: "5 lead credits",
    recommended: false
  },
  leads_15: {
    audience: "owner",
    amountPaise: 69900,
    credits: 15,
    label: "15 lead credits",
    recommended: true
  }
} as const;

export type CreditPlanId = keyof typeof CREDIT_PLANS;

export function parseCreditPlan(planId: string) {
  const plan = CREDIT_PLANS[planId as CreditPlanId];
  if (!plan) {
    throw new BadRequestException({
      code: "invalid_plan",
      message: "Invalid credit plan"
    });
  }
  return { planId: planId as CreditPlanId, ...plan };
}

export function planAudienceForRole(role: string): CreditPlanAudience | null {
  if (role === "tenant") return "tenant";
  if (role === "owner" || role === "pg_operator") return "owner";
  return null;
}

export function assertCreditPurchaseEnabled() {
  if (!readFeatureFlags().ff_credit_purchase_enabled) {
    throw new ForbiddenException({
      code: "feature_disabled",
      message: "Credit purchase is not enabled"
    });
  }
}

export function parseCreditPlanForRole(planId: string, role: string) {
  const plan = parseCreditPlan(planId);
  const audience = planAudienceForRole(role);
  if (!audience || plan.audience !== audience) {
    throw new ForbiddenException({
      code: "plan_not_available_for_role",
      message: "This credit plan is not available for the current role"
    });
  }
  return plan;
}

export function listCreditPlansForRole(role: string) {
  const audience = planAudienceForRole(role);
  if (!audience) return [];
  return Object.entries(CREDIT_PLANS)
    .filter(([, plan]) => plan.audience === audience)
    .map(([planId, plan]) => ({
      plan_id: planId,
      audience: plan.audience,
      amount_paise: plan.amountPaise,
      credits: plan.credits,
      label: plan.label,
      unit_price_paise: Math.round(plan.amountPaise / plan.credits),
      recommended: plan.recommended
    }));
}

export function parsePaymentProvider(provider: string): PaymentProvider {
  if (provider === "razorpay" || provider === "upi") {
    return provider;
  }

  throw new BadRequestException({
    code: "invalid_provider",
    message: "Unsupported payment provider"
  });
}

export function buildProviderPayload(input: {
  provider: PaymentProvider;
  providerOrderId: string;
  amountPaise: number;
  planId: CreditPlanId;
  creditsToGrant: number;
  keyId?: string;
}) {
  const base = {
    provider: input.provider,
    order_id: input.providerOrderId,
    amount_paise: input.amountPaise,
    currency: "INR"
  };

  if (input.provider === "razorpay") {
    return {
      ...base,
      key_id: input.keyId ?? process.env.PAYMENT_PROVIDER_KEY ?? "rzp_test_placeholder",
      notes: {
        plan_id: input.planId,
        credits_to_grant: input.creditsToGrant
      }
    };
  }

  return {
    ...base,
    deep_link: `upi://pay?tr=${input.providerOrderId}&am=${(input.amountPaise / 100).toFixed(2)}&cu=INR&tn=Cribliv Credits`,
    metadata: {
      plan_id: input.planId,
      credits_to_grant: input.creditsToGrant
    }
  };
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      normalized[key] = normalizeValue(obj[key]);
    }
    return normalized;
  }

  return value;
}

export function canonicalPayload(input: unknown): string {
  return JSON.stringify(normalizeValue(input ?? {}));
}

function verifyHmacSignature(payload: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const provided = signature.trim();
  if (!provided) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  // timingSafeEqual throws on unequal BYTE lengths; multibyte UTF-8 input can
  // pass a string-length check while differing in bytes.
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function ensureWebhookSignature(input: {
  payloadForSignature: string;
  signature: string | undefined;
  provider: PaymentProvider;
}) {
  const signature = input.signature?.trim();
  if (!signature) {
    throw new UnauthorizedException({
      code: "invalid_signature",
      message: "Missing signature"
    });
  }

  const globalSecret = process.env.PAYMENT_WEBHOOK_SECRET?.trim();
  const providerSecret =
    input.provider === "razorpay"
      ? process.env.RAZORPAY_WEBHOOK_SECRET?.trim()
      : process.env.UPI_WEBHOOK_SECRET?.trim();

  const secrets = [providerSecret, globalSecret].filter((secret): secret is string =>
    Boolean(secret)
  );
  if (secrets.length === 0) {
    throw new UnauthorizedException({
      code: "invalid_signature",
      message: "Webhook secret is not configured"
    });
  }

  const matched = secrets.some((secret) =>
    verifyHmacSignature(input.payloadForSignature, signature, secret)
  );

  if (!matched) {
    throw new UnauthorizedException({
      code: "invalid_signature",
      message: "Signature verification failed"
    });
  }
}

/**
 * Verifies a Razorpay Checkout.js success-handler signature:
 * HMAC-SHA256 of `${orderId}|${paymentId}` under the account's key secret.
 * This is distinct from `ensureWebhookSignature` above, which verifies the
 * server-to-server webhook payload signature — checkout and webhook
 * signatures use different inputs and (in live mode) different secrets.
 */
export function verifyRazorpayCheckoutSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
  secret: string;
}): boolean {
  const expected = createHmac("sha256", input.secret)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest("hex");
  const provided = input.signature.trim();
  if (!provided) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  // timingSafeEqual throws on unequal BYTE lengths; multibyte UTF-8 input can
  // pass a string-length check while differing in bytes.
  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

/**
 * Mode resolution kept in sync with RazorpayOrdersService.mode() — mock vs
 * live must agree so the checkout signature secret and the order-creation
 * secret follow the same rule.
 */
function razorpayCheckoutMode(): "mock" | "live" {
  const configured = process.env.RAZORPAY_ORDERS_MODE?.trim().toLowerCase();
  if (configured === "mock" || configured === "live") {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? "live" : "mock";
}

export function ensureRazorpayCheckoutSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string | undefined;
}) {
  const signature = input.signature?.trim();
  if (!signature) {
    throw new UnauthorizedException({
      code: "invalid_payment_signature",
      message: "Missing checkout signature"
    });
  }

  const liveSecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  const mockSecret = process.env.RAZORPAY_CHECKOUT_SECRET?.trim();
  const secrets =
    razorpayCheckoutMode() === "live"
      ? [liveSecret].filter((secret): secret is string => Boolean(secret))
      : [mockSecret, liveSecret].filter((secret): secret is string => Boolean(secret));

  if (secrets.length === 0) {
    throw new UnauthorizedException({
      code: "invalid_payment_signature",
      message: "Checkout secret is not configured"
    });
  }

  const matched = secrets.some((secret) =>
    verifyRazorpayCheckoutSignature({
      orderId: input.orderId,
      paymentId: input.paymentId,
      signature,
      secret
    })
  );

  if (!matched) {
    throw new UnauthorizedException({
      code: "invalid_payment_signature",
      message: "Checkout signature verification failed"
    });
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

export interface ParsedWebhookEvent {
  providerEventId: string;
  eventType: string;
  providerOrderId?: string;
  providerPaymentId?: string;
  isCaptureSuccess: boolean;
  isFailure: boolean;
  /** Undefined when the payload doesn't carry payment.entity.amount/.currency — older/other payload shapes still work. */
  amountPaise?: number;
  currency?: string;
}

export function parseWebhookEvent(
  provider: PaymentProvider,
  payload: Record<string, unknown>,
  payloadForHash: string
): ParsedWebhookEvent {
  const paymentEntity = (payload.payload as Record<string, unknown> | undefined)?.payment as
    | Record<string, unknown>
    | undefined;
  const paymentData = paymentEntity?.entity as Record<string, unknown> | undefined;
  const data = payload.data as Record<string, unknown> | undefined;

  const eventType = firstString(payload.event, payload.status, data?.event, "unknown_event")!;
  const providerOrderId = firstString(
    paymentData?.order_id,
    payload.order_id,
    data?.order_id,
    data?.provider_order_id
  );
  const providerPaymentId = firstString(
    paymentData?.id,
    payload.payment_id,
    payload.transaction_id,
    data?.payment_id,
    data?.transaction_id
  );

  const rawEventId = firstString(
    payload.id,
    payload.event_id,
    data?.id,
    providerPaymentId,
    providerOrderId
  );
  const hashId = createHash("sha256").update(payloadForHash).digest("hex").slice(0, 24);
  const providerEventId = `${eventType}:${rawEventId ?? hashId}`;

  const status = firstString(payload.status, data?.status)?.toLowerCase() ?? "";
  const eventTypeLower = eventType.toLowerCase();

  const successEventTokens =
    provider === "razorpay"
      ? ["payment.captured"]
      : ["captured", "success", "completed", "payment_success", "charge.succeeded"];
  const failureEventTokens =
    provider === "razorpay" ? ["payment.failed"] : ["failed", "payment_failed", "charge.failed"];

  const isCaptureSuccess =
    successEventTokens.includes(eventTypeLower) || successEventTokens.includes(status);
  const isFailure =
    failureEventTokens.includes(eventTypeLower) || failureEventTokens.includes(status);

  const amountPaise = typeof paymentData?.amount === "number" ? paymentData.amount : undefined;
  const currency = typeof paymentData?.currency === "string" ? paymentData.currency : undefined;

  return {
    providerEventId,
    eventType,
    providerOrderId,
    providerPaymentId,
    isCaptureSuccess,
    isFailure,
    amountPaise,
    currency
  };
}
