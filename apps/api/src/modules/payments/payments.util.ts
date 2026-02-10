import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { createHmac, createHash, timingSafeEqual } from "crypto";

export type PaymentProvider = "razorpay" | "upi";

export const CREDIT_PLANS = {
  starter_10: { amountPaise: 9900, credits: 10 },
  growth_20: { amountPaise: 19900, credits: 20 }
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
      key_id: process.env.PAYMENT_PROVIDER_KEY ?? "rzp_test_placeholder",
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
  if (!provided || provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
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

  return {
    providerEventId,
    eventType,
    providerOrderId,
    providerPaymentId,
    isCaptureSuccess,
    isFailure
  };
}
