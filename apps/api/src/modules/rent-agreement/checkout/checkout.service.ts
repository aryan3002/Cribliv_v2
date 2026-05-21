import { randomUUID } from "node:crypto";

import { buildRentAgreementProviderPayload, type ProviderOrderNotes } from "./checkout.mapper";
import type { RentAgreementPaymentProviderPort } from "../payments/payment-provider.port";

// In-memory backend for Phase 7. Wiring into payments.controller.ts and the live-DB
// `payment_orders` repository land in Phase 13. The state machine here mirrors the
// eventual DB schema: status ∈ {'pending_payment','paid'}, idempotent on (user_id,
// idempotency_key), provider_order_id indexed for webhook lookup.

export type Provider = "razorpay" | "upi";
export type PaymentOrderStatus = "pending_payment" | "paid";

interface DraftRowProjection {
  id: string;
  user_id: string;
  plan_id: string;
  state_code: string | null;
  locale: string;
  current_step: number;
  status: string;
  stamp_duty_paise: number | null;
}

interface DraftsServicePort {
  getOne(userId: string, draftId: string): Promise<DraftRowProjection | null>;
}

interface SignaturesServicePort {
  hasBothSignatures(agreementId: string): boolean;
}

export interface PaymentOrderRow {
  id: string;
  user_id: string;
  draft_id: string;
  provider: Provider;
  idempotency_key: string;
  provider_order_id: string;
  provider_payment_id: string | null;
  amount_paise: number;
  status: PaymentOrderStatus;
  metadata: ProviderOrderNotes;
  created_at: string;
}

export interface CreateOrderInput {
  userId: string;
  draftId: string;
  idempotencyKey: string;
  provider: Provider;
}

export interface CreateOrderResult {
  id: string;
  provider_order_id: string;
  amount_paise: number;
  currency: "INR";
  notes: ProviderOrderNotes;
  status: PaymentOrderStatus;
}

interface Deps {
  draftsService: DraftsServicePort;
  signaturesService: SignaturesServicePort;
  planLookup: (planId: string) => { amount_paise: number };
  providerOrderIdGenerator?: () => string;
  uuid?: () => string;
  clock?: () => Date;
  // Phase 13: real provider call (Razorpay or MockPaymentProvider in dev). When
  // supplied, overrides providerOrderIdGenerator. The mapper still builds the
  // amount/notes payload; the provider just mints the upstream order id.
  paymentProvider?: RentAgreementPaymentProviderPort;
  // Phase 13: after a new order is persisted, flip the draft to pending_payment +
  // record the provider_order_id on the agreement row. Skipped on idempotency-replay.
  onOrderCreated?: (draftId: string, providerOrderId: string) => Promise<void>;
}

export type CheckoutServiceErrorCode =
  | "RENT_AGREEMENT_CHECKOUT_INVALID_PROVIDER"
  | "RENT_AGREEMENT_CHECKOUT_DRAFT_NOT_FOUND"
  | "RENT_AGREEMENT_CHECKOUT_DRAFT_NOT_READY"
  | "RENT_AGREEMENT_CHECKOUT_SIGNATURES_MISSING"
  | "RENT_AGREEMENT_CHECKOUT_ORDER_NOT_FOUND";

export interface CheckoutServiceError extends Error {
  code: string;
}

const VALID_PROVIDERS: ReadonlySet<string> = new Set(["razorpay", "upi"]);

export class CheckoutService {
  private readonly orders = new Map<string, PaymentOrderRow>();
  private readonly idemIndex = new Map<string, string>();
  private readonly providerOrderIndex = new Map<string, string>();
  private readonly draftsService: DraftsServicePort;
  private readonly signaturesService: SignaturesServicePort;
  private readonly planLookup: (planId: string) => { amount_paise: number };
  private readonly providerOrderIdGenerator: () => string;
  private readonly uuid: () => string;
  private readonly clock: () => Date;
  private readonly onOrderCreated:
    | ((draftId: string, providerOrderId: string) => Promise<void>)
    | null;
  private readonly paymentProvider: RentAgreementPaymentProviderPort | null;

  constructor(deps: Deps) {
    this.draftsService = deps.draftsService;
    this.signaturesService = deps.signaturesService;
    this.planLookup = deps.planLookup;
    this.uuid = deps.uuid ?? randomUUID;
    this.clock = deps.clock ?? (() => new Date());
    this.providerOrderIdGenerator = deps.providerOrderIdGenerator ?? (() => `order_${this.uuid()}`);
    this.onOrderCreated = deps.onOrderCreated ?? null;
    this.paymentProvider = deps.paymentProvider ?? null;
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    if (!VALID_PROVIDERS.has(input.provider)) {
      throw this.err(
        "RENT_AGREEMENT_CHECKOUT_INVALID_PROVIDER",
        `provider must be 'razorpay' or 'upi' (got '${input.provider}')`
      );
    }

    const idemKey = `${input.userId}|${input.idempotencyKey}`;
    const existingId = this.idemIndex.get(idemKey);
    if (existingId) {
      const existing = this.orders.get(existingId);
      if (existing) return this.toResult(existing);
    }

    const draft = await this.draftsService.getOne(input.userId, input.draftId);
    if (!draft) {
      throw this.err(
        "RENT_AGREEMENT_CHECKOUT_DRAFT_NOT_FOUND",
        `Draft ${input.draftId} not found for user ${input.userId}`
      );
    }
    if (draft.current_step !== 7 || draft.status !== "draft") {
      throw this.err(
        "RENT_AGREEMENT_CHECKOUT_DRAFT_NOT_READY",
        `Draft must be at step 7 with status='draft' (got step ${draft.current_step}, status '${draft.status}')`
      );
    }
    if (draft.plan_id === "premium" && !this.signaturesService.hasBothSignatures(draft.id)) {
      throw this.err(
        "RENT_AGREEMENT_CHECKOUT_SIGNATURES_MISSING",
        "Premium plan requires both owner + tenant signatures before checkout"
      );
    }

    const plan = this.planLookup(draft.plan_id);
    const stampDutyPaise = draft.stamp_duty_paise ?? 0;
    const payload = buildRentAgreementProviderPayload({
      row: {
        id: draft.id,
        user_id: draft.user_id,
        plan_id: draft.plan_id,
        state_code: draft.state_code,
        locale: draft.locale
      } as Parameters<typeof buildRentAgreementProviderPayload>[0]["row"],
      planAmountPaise: plan.amount_paise,
      stampDutyPaise,
      idempotencyKey: input.idempotencyKey
    });

    const id = this.uuid();
    const providerOrderId = this.paymentProvider
      ? (
          await this.paymentProvider.createOrder({
            amountPaise: payload.amount_paise,
            currency: "INR",
            notes: payload.notes as unknown as Record<string, string | number>,
            receipt: id
          })
        ).providerOrderId
      : this.providerOrderIdGenerator();
    const row: PaymentOrderRow = {
      id,
      user_id: input.userId,
      draft_id: input.draftId,
      provider: input.provider,
      idempotency_key: input.idempotencyKey,
      provider_order_id: providerOrderId,
      provider_payment_id: null,
      amount_paise: payload.amount_paise,
      status: "pending_payment",
      metadata: payload.notes,
      created_at: this.clock().toISOString()
    };
    this.orders.set(id, row);
    this.idemIndex.set(idemKey, id);
    this.providerOrderIndex.set(providerOrderId, id);
    if (this.onOrderCreated) {
      await this.onOrderCreated(input.draftId, providerOrderId);
    }
    return this.toResult(row);
  }

  findByProviderOrderId(providerOrderId: string): PaymentOrderRow | null {
    const id = this.providerOrderIndex.get(providerOrderId);
    if (!id) return null;
    return this.orders.get(id) ?? null;
  }

  markPaid(orderId: string, providerPaymentId: string): void {
    const order = this.orders.get(orderId);
    if (!order) {
      throw this.err("RENT_AGREEMENT_CHECKOUT_ORDER_NOT_FOUND", `Order ${orderId} not found`);
    }
    if (order.status === "paid") return; // idempotent
    order.status = "paid";
    order.provider_payment_id = providerPaymentId;
  }

  private toResult(row: PaymentOrderRow): CreateOrderResult {
    return {
      id: row.id,
      provider_order_id: row.provider_order_id,
      amount_paise: row.amount_paise,
      currency: "INR",
      notes: row.metadata,
      status: row.status
    };
  }

  private err(code: CheckoutServiceErrorCode, message: string): CheckoutServiceError {
    const e = new Error(message) as CheckoutServiceError;
    e.code = code;
    return e;
  }
}
