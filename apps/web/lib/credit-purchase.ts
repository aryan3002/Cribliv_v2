import { fetchApi } from "./api";
import type { CreditPlanDto } from "@cribliv/shared-types";

export type { CreditPlanDto };

export type PaymentProvider = "razorpay" | "upi";

/**
 * Mirrors PaymentOrderStatus on the API. `captured` and `failed` are the only
 * terminal states callers should act on — crediting stays webhook-only, so
 * `authorized` (checkout signature verified, wallet not yet credited) is
 * still a waiting state, not success.
 */
export type PurchaseOrderStatus = "created" | "authorized" | "captured" | "failed" | "refunded";

export interface RazorpayProviderPayload {
  provider: "razorpay";
  order_id: string;
  amount_paise: number;
  currency: string;
  key_id: string;
  notes?: Record<string, unknown>;
}

export interface UpiProviderPayload {
  provider: "upi";
  order_id: string;
  amount_paise: number;
  currency: string;
  deep_link: string;
  metadata?: Record<string, unknown>;
}

export type CreditPurchaseProviderPayload = RazorpayProviderPayload | UpiProviderPayload;

export interface CreditPurchaseIntent {
  order_id: string;
  amount_paise: number;
  credits_to_grant: number;
  provider_payload: CreditPurchaseProviderPayload;
}

export interface RazorpayCheckoutHandlerResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}

export interface ConfirmCreditPurchaseResult {
  order_id: string;
  status: PurchaseOrderStatus;
  credits_to_grant: number;
}

export interface CreditPurchaseStatus {
  order_id: string;
  status: PurchaseOrderStatus;
  plan_id: string;
  amount_paise: number;
  credits_to_grant: number;
  provider: PaymentProvider;
}

function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/**
 * Fresh idempotency key for a single purchase attempt. Callers must mint a
 * new one per Pay click / provider switch — reusing a key across attempts
 * (e.g. after a cancelled or failed checkout) would hit the server's
 * idempotent-replay path and hand back the same abandoned order instead of
 * starting a clean one.
 */
export function createIdempotencyKey(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export async function fetchCreditPlans(accessToken: string): Promise<CreditPlanDto[]> {
  const result = await fetchApi<{ items: CreditPlanDto[] }>("/wallet/plans", {
    headers: authHeaders(accessToken)
  });
  return result.items;
}

export async function createCreditPurchaseIntent(
  accessToken: string,
  planId: string,
  provider: PaymentProvider,
  idempotencyKey: string
): Promise<CreditPurchaseIntent> {
  return fetchApi<CreditPurchaseIntent>("/wallet/purchase-intents", {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ plan_id: planId, provider })
  });
}

export async function confirmRazorpayPurchase(
  accessToken: string,
  orderId: string,
  response: RazorpayCheckoutHandlerResponse
): Promise<ConfirmCreditPurchaseResult> {
  return fetchApi<ConfirmCreditPurchaseResult>(
    `/wallet/purchase-intents/${encodeURIComponent(orderId)}/confirm`,
    {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({
        razorpay_order_id: response.razorpay_order_id,
        razorpay_payment_id: response.razorpay_payment_id,
        razorpay_signature: response.razorpay_signature
      })
    }
  );
}

export async function fetchCreditPurchaseStatus(
  accessToken: string,
  orderId: string
): Promise<CreditPurchaseStatus> {
  return fetchApi<CreditPurchaseStatus>(`/wallet/purchase-intents/${encodeURIComponent(orderId)}`, {
    headers: authHeaders(accessToken)
  });
}

export interface PollCreditPurchaseStatusInput {
  accessToken: string;
  orderId: string;
  /** @default 1000 */
  intervalMs?: number;
  /** @default 15 */
  maxAttempts?: number;
  fetchStatus?: (accessToken: string, orderId: string) => Promise<CreditPurchaseStatus>;
  delay?: (ms: number) => Promise<void>;
}

/**
 * `timedOut: true` on exhaustion — deliberately NOT one of the real
 * PurchaseOrderStatus values, so a caller can never mistake "we stopped
 * asking" for a server-confirmed outcome.
 */
export type PollCreditPurchaseStatusResult =
  | CreditPurchaseStatus
  | { status: "pending"; timedOut: true };

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_POLL_MAX_ATTEMPTS = 15;
const TERMINAL_STATUSES: ReadonlySet<PurchaseOrderStatus> = new Set(["captured", "failed"]);

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Polls purchase-intent status until it reaches a terminal state (`captured`
 * or `failed`) or the attempt budget runs out. Crediting is webhook-only, so
 * `authorized` (checkout signature verified) is still a waiting state here —
 * only `captured` means the wallet was actually credited.
 */
export async function pollCreditPurchaseStatus(
  input: PollCreditPurchaseStatusInput
): Promise<PollCreditPurchaseStatusResult> {
  const {
    accessToken,
    orderId,
    intervalMs = DEFAULT_POLL_INTERVAL_MS,
    maxAttempts = DEFAULT_POLL_MAX_ATTEMPTS,
    fetchStatus = fetchCreditPurchaseStatus,
    delay = defaultDelay
  } = input;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await fetchStatus(accessToken, orderId);
    if (TERMINAL_STATUSES.has(result.status)) {
      return result;
    }
    if (attempt < maxAttempts - 1) {
      await delay(intervalMs);
    }
  }

  return { status: "pending", timedOut: true };
}
