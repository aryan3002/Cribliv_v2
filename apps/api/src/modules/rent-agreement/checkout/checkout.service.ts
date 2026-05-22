import { randomUUID } from "node:crypto";

import { buildRentAgreementProviderPayload, type ProviderOrderNotes } from "./checkout.mapper";
import {
  InMemoryPaymentOrdersRepository,
  type PaymentOrdersRepository
} from "./payment-orders.repository";
import type { RentAgreementPaymentProviderPort } from "../payments/payment-provider.port";

// Payment order state machine. Row persistence is delegated to a
// `PaymentOrdersRepository` (in-memory or DB-backed, table
// rent_agreement_payment_orders). status ∈ {'pending_payment','paid'}, idempotent
// on (user_id, idempotency_key), provider_order_id indexed for webhook lookup.
//
// The payment provider stays dev-based (MockPaymentProvider). In dev, `devMockCapture`
// settles the order with a mock provider_payment_id right after creation so the
// persisted record is complete. In production this dep is absent and the real
// webhook (handlePaymentCaptured -> markPaid) settles the order instead.

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
  hasBothSignatures(agreementId: string): Promise<boolean>;
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
  repository?: PaymentOrdersRepository;
  // Real provider call (Razorpay or MockPaymentProvider in dev). When supplied,
  // overrides providerOrderIdGenerator. The mapper still builds the amount/notes
  // payload; the provider just mints the upstream order id.
  paymentProvider?: RentAgreementPaymentProviderPort;
  // After a new order is persisted, flip the draft to pending_payment + link the
  // payment order (by its uuid id) onto the agreement row. Skipped on
  // idempotency-replay. `providerOrderId` is passed for analytics only.
  onOrderCreated?: (draftId: string, providerOrderId: string, orderId: string) => Promise<void>;
  // Dev-only: settle the freshly-created order with a mock provider_payment_id.
  // Absent in production — the real payment webhook settles the order there.
  devMockCapture?: (orderId: string) => string;
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
  private readonly repo: PaymentOrdersRepository;
  private readonly draftsService: DraftsServicePort;
  private readonly signaturesService: SignaturesServicePort;
  private readonly planLookup: (planId: string) => { amount_paise: number };
  private readonly providerOrderIdGenerator: () => string;
  private readonly uuid: () => string;
  private readonly clock: () => Date;
  private readonly onOrderCreated:
    | ((draftId: string, providerOrderId: string, orderId: string) => Promise<void>)
    | null;
  private readonly paymentProvider: RentAgreementPaymentProviderPort | null;
  private readonly devMockCapture: ((orderId: string) => string) | null;

  constructor(deps: Deps) {
    this.repo = deps.repository ?? new InMemoryPaymentOrdersRepository();
    this.draftsService = deps.draftsService;
    this.signaturesService = deps.signaturesService;
    this.planLookup = deps.planLookup;
    this.uuid = deps.uuid ?? randomUUID;
    this.clock = deps.clock ?? (() => new Date());
    this.providerOrderIdGenerator = deps.providerOrderIdGenerator ?? (() => `order_${this.uuid()}`);
    this.onOrderCreated = deps.onOrderCreated ?? null;
    this.paymentProvider = deps.paymentProvider ?? null;
    this.devMockCapture = deps.devMockCapture ?? null;
  }

  async createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
    if (!VALID_PROVIDERS.has(input.provider)) {
      throw this.err(
        "RENT_AGREEMENT_CHECKOUT_INVALID_PROVIDER",
        `provider must be 'razorpay' or 'upi' (got '${input.provider}')`
      );
    }

    const replay = await this.repo.findByIdempotency(input.userId, input.idempotencyKey);
    if (replay) return this.toResult(replay);

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
    if (
      draft.plan_id === "premium" &&
      !(await this.signaturesService.hasBothSignatures(draft.id))
    ) {
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
    await this.repo.insert(row);

    // insert is idempotent at the storage layer. Re-read so a concurrent create
    // that won the (user_id, idempotency_key) conflict returns the canonical row.
    const stored = (await this.repo.findByIdempotency(input.userId, input.idempotencyKey)) ?? row;
    if (stored.id !== row.id) {
      // Lost the race — another create already owns this idempotency key.
      return this.toResult(stored);
    }

    if (this.onOrderCreated) {
      await this.onOrderCreated(input.draftId, providerOrderId, id);
    }
    if (this.devMockCapture) {
      // Dev: no real provider, so settle the order immediately with a mock id.
      await this.markPaid(id, this.devMockCapture(id));
    }

    return this.toResult((await this.repo.findById(id)) ?? row);
  }

  async findByProviderOrderId(providerOrderId: string): Promise<PaymentOrderRow | null> {
    return this.repo.findByProviderOrderId(providerOrderId);
  }

  async markPaid(orderId: string, providerPaymentId: string): Promise<void> {
    const order = await this.repo.findById(orderId);
    if (!order) {
      throw this.err("RENT_AGREEMENT_CHECKOUT_ORDER_NOT_FOUND", `Order ${orderId} not found`);
    }
    if (order.status === "paid") return; // idempotent
    await this.repo.markPaid(orderId, providerPaymentId);
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
