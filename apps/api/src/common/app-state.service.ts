import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { signupReward, type SignupReward } from "../modules/auth/signup-credits";

interface UserRecord {
  id: string;
  phone: string;
  role: "tenant" | "owner" | "pg_operator" | "admin";
  preferred_language: "en" | "hi";
  full_name?: string;
  whatsapp_opt_in?: boolean;
}

interface Challenge {
  id: string;
  phone: string;
  purpose: string;
  otp: string;
  attempts: number;
  expiresAt: number;
  blockedUntil?: number;
  /** Populated when OTP_PROVIDER=d7 in in-memory mode */
  d7OtpId?: string;
}

interface SessionRecord {
  accessToken: string;
  refreshToken: string;
  userId: string;
}

interface ListingRecord {
  id: string;
  ownerUserId: string;
  listingType: "flat_house" | "pg";
  title: string;
  city: string;
  locality?: string;
  monthlyRent: number;
  furnishing?: "unfurnished" | "semi_furnished" | "fully_furnished";
  verificationStatus: "unverified" | "pending" | "verified" | "failed";
  status: "draft" | "pending_review" | "active" | "rejected" | "paused" | "archived";
  createdAt: number;
  amenities?: string[];
}

interface WalletTxn {
  id: string;
  userId: string;
  type: string;
  creditsDelta: number;
  referenceId?: string;
  createdAt: number;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}

export interface PromotionalWalletState {
  granted: number;
  remaining: number;
  expiresAt: number | null;
}

interface UnlockRecord {
  id: string;
  tenantUserId: string;
  listingId: string;
  idempotencyKey: string;
  ownerResponseStatus: "pending" | "responded" | "timeout_refunded";
  unlockStatus: "active" | "refunded" | "cancelled";
  responseDeadlineAt: number;
  ownerRespondedAt?: number;
  refundTxnId?: string;
  tenantConfirmedAt?: number;
  disputedAt?: number;
}

type LeadStatus = "new" | "contacted" | "visit_scheduled" | "deal_done" | "lost";
type LeadAccessState = "free" | "locked" | "unlocked" | "expired";

interface LeadRecord {
  id: string;
  listingId: string;
  ownerUserId: string;
  tenantUserId: string;
  contactUnlockId?: string;
  tenantPhoneMasked?: string | null;
  status: LeadStatus;
  accessState: LeadAccessState;
  callDeadlineAt?: number | null;
  calledAt?: number | null;
  calledBy?: "owner" | "team" | null;
  ownerNotes?: string | null;
  preferredSharing?: string | null;
  createdAt: number;
  statusChangedAt: number;
  updatedAt: number;
}

export interface PaymentOrderRecord {
  id: string;
  userId: string;
  provider: "razorpay" | "upi";
  /** Unset while the order is reserved but the provider call hasn't completed yet. */
  providerOrderId?: string;
  amountPaise: number;
  creditsToGrant: number;
  planId: "starter_10" | "growth_20" | "leads_5" | "leads_15";
  status: "created" | "authorized" | "captured" | "failed" | "refunded";
  providerPaymentId?: string;
}

interface SalesLeadRecord {
  id: string;
  createdByUserId: string;
  listingId?: string;
  source: "pg_sales_assist" | "property_management";
  status: "new" | "contacted" | "qualified" | "closed_won" | "closed_lost";
  idempotencyKey?: string;
  notes?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

interface OutboundEventRecord {
  id: number;
  eventType: string;
  aggregateType: string;
  aggregateId?: string;
  payload: Record<string, unknown>;
  status: "pending" | "dispatched" | "failed";
  attemptCount: number;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface RoleRequestRecord {
  id: string;
  userId: string;
  requestedRole: "owner" | "pg_operator";
  status: "pending" | "approved" | "rejected";
  reason?: string;
  createdAt: number;
  decidedAt?: number;
  decidedByAdminId?: string;
}

@Injectable()
export class AppStateService {
  users = new Map<string, UserRecord>();
  usersByPhone = new Map<string, UserRecord>();
  challenges = new Map<string, Challenge>();
  sessions = new Map<string, SessionRecord>();
  listings = new Map<string, ListingRecord>();
  shortlists = new Map<string, Set<string>>();
  wallets = new Map<string, number>();
  walletTxns = new Map<string, WalletTxn[]>();
  promotionalWallets = new Map<string, PromotionalWalletState>();
  unlocks = new Map<string, UnlockRecord>();
  unlockByIdempotency = new Map<string, UnlockRecord>();
  leads = new Map<string, LeadRecord>();
  leadByListingTenant = new Map<string, string>();
  idempotencyResponses = new Map<string, unknown>();
  paymentOrders = new Map<string, PaymentOrderRecord>();
  paymentOrderByProviderOrderId = new Map<string, PaymentOrderRecord>();
  paymentOrderByIdempotency = new Map<string, PaymentOrderRecord>();
  processedPaymentWebhookEvents = new Set<string>();
  salesLeads = new Map<string, SalesLeadRecord>();
  salesLeadByIdempotency = new Map<string, SalesLeadRecord>();
  outboundEvents: OutboundEventRecord[] = [];
  verificationAttempts: Array<Record<string, unknown>> = [];
  adminActions: Array<Record<string, unknown>> = [];
  /** Role upgrade requests submitted by users */
  roleRequests = new Map<string, RoleRequestRecord>();
  /** Lookup: userId → latest pending/decided request id */
  roleRequestsByUser = new Map<string, string>();
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
  private outboundEventCounter = 1;

  constructor() {
    const ownerId = randomUUID();
    const tenantId = randomUUID();
    const adminId = randomUUID();
    const pgOperatorId = randomUUID();

    const owner: UserRecord = {
      id: ownerId,
      phone: "+919999999901",
      role: "owner",
      preferred_language: "en"
    };
    const tenant: UserRecord = {
      id: tenantId,
      phone: "+919999999902",
      role: "tenant",
      preferred_language: "en"
    };
    const admin: UserRecord = {
      id: adminId,
      phone: "+919999999903",
      role: "admin",
      preferred_language: "en"
    };
    const pgOperator: UserRecord = {
      id: pgOperatorId,
      phone: "+919999999904",
      role: "pg_operator",
      preferred_language: "en"
    };

    [owner, tenant, admin, pgOperator].forEach((u) => {
      this.users.set(u.id, u);
      this.usersByPhone.set(u.phone, u);
      this.wallets.set(u.id, 0);
      this.walletTxns.set(u.id, []);
    });
    this.grantSignupReward(tenant.id, signupReward());

    const seedListings: ListingRecord[] = [
      {
        id: randomUUID(),
        ownerUserId: ownerId,
        listingType: "flat_house",
        title: "2BHK near Cyber City",
        city: "gurugram",
        locality: "dlf-phase-2",
        monthlyRent: 32000,
        verificationStatus: "verified",
        status: "active",
        createdAt: Date.now()
      },
      {
        id: randomUUID(),
        ownerUserId: ownerId,
        listingType: "pg",
        title: "Premium PG in Noida Sector 62",
        city: "noida",
        locality: "sector-62",
        monthlyRent: 14000,
        verificationStatus: "pending",
        status: "active",
        createdAt: Date.now()
      },
      {
        id: randomUUID(),
        ownerUserId: pgOperatorId,
        listingType: "pg",
        title: "Girls PG near Huda City Centre",
        city: "gurugram",
        locality: "sector-29",
        monthlyRent: 12000,
        verificationStatus: "unverified",
        status: "draft",
        createdAt: Date.now()
      }
    ];

    seedListings.forEach((l) => this.listings.set(l.id, l));
  }

  createSession(userId: string) {
    const accessToken = `acc_${randomUUID()}`;
    const refreshToken = `ref_${randomUUID()}`;
    this.sessions.set(accessToken, { accessToken, refreshToken, userId });
    return { accessToken, refreshToken };
  }

  getUserByAccessToken(accessToken?: string) {
    if (!accessToken) {
      return undefined;
    }

    const session = this.sessions.get(accessToken);
    if (!session) {
      return undefined;
    }

    return this.users.get(session.userId);
  }

  getSessionByRefreshToken(refreshToken?: string): SessionRecord | undefined {
    if (!refreshToken) return undefined;
    for (const session of this.sessions.values()) {
      if (session.refreshToken === refreshToken) return session;
    }
    return undefined;
  }

  rotateSession(oldRefreshToken: string): { accessToken: string; refreshToken: string } | null {
    const old = this.getSessionByRefreshToken(oldRefreshToken);
    if (!old) return null;
    this.sessions.delete(old.accessToken);
    const newAccessToken = `acc_${randomUUID()}`;
    const newRefreshToken = `ref_${randomUUID()}`;
    this.sessions.set(newAccessToken, {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      userId: old.userId
    });
    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  ensureWallet(userId: string) {
    if (!this.wallets.has(userId)) {
      this.wallets.set(userId, 0);
    }
    if (!this.walletTxns.has(userId)) {
      this.walletTxns.set(userId, []);
    }
  }

  addWalletTxn(input: Omit<WalletTxn, "id" | "createdAt">) {
    if (input.creditsDelta < 0) {
      return this.debitWalletCredits({
        userId: input.userId,
        credits: -input.creditsDelta,
        type: input.type,
        referenceId: input.referenceId,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata
      });
    }
    return this.appendWalletTxn(input);
  }

  private appendWalletTxn(input: Omit<WalletTxn, "id" | "createdAt">) {
    const txn: WalletTxn = {
      ...input,
      id: randomUUID(),
      createdAt: Date.now()
    };

    this.ensureWallet(input.userId);
    const current = this.wallets.get(input.userId) ?? 0;
    this.wallets.set(input.userId, current + input.creditsDelta);
    this.walletTxns.get(input.userId)?.push(txn);
    return txn;
  }

  grantSignupReward(userId: string, reward: SignupReward): WalletTxn {
    this.ensureWallet(userId);
    this.promotionalWallets.set(userId, {
      granted: reward.credits,
      remaining: reward.credits,
      expiresAt: reward.expiresAt?.getTime() ?? null
    });
    return this.addWalletTxn({
      userId,
      type: "grant_signup",
      creditsDelta: reward.credits,
      referenceId: userId
    });
  }

  getWalletDetails(userId: string, now = Date.now()) {
    this.ensureWallet(userId);
    const promotional = this.promotionalWallets.get(userId) ?? {
      granted: 0,
      remaining: 0,
      expiresAt: null
    };

    if (
      promotional.remaining > 0 &&
      promotional.expiresAt !== null &&
      promotional.expiresAt <= now
    ) {
      const expiredCredits = promotional.remaining;
      promotional.remaining = 0;
      this.promotionalWallets.set(userId, promotional);
      this.appendWalletTxn({
        userId,
        type: "expire_signup",
        creditsDelta: -expiredCredits,
        referenceId: userId,
        metadata: {
          expiredCredits,
          expiresAt: promotional.expiresAt
        }
      });
    }

    return {
      balanceCredits: this.wallets.get(userId) ?? 0,
      freeCreditsGranted: promotional.granted,
      promotionalCreditsRemaining: promotional.remaining,
      promotionalCreditsExpiresAt: promotional.expiresAt
    };
  }

  debitWalletCredits(
    input: {
      userId: string;
      credits: number;
      type: string;
      referenceId?: string;
      idempotencyKey?: string;
      metadata?: Record<string, unknown>;
    },
    now = Date.now()
  ): WalletTxn {
    const wallet = this.getWalletDetails(input.userId, now);
    if (!Number.isInteger(input.credits) || input.credits <= 0) {
      throw new Error("Wallet debit credits must be a positive integer");
    }

    if (input.idempotencyKey) {
      const existing = (this.walletTxns.get(input.userId) ?? []).find(
        (txn) => txn.idempotencyKey === input.idempotencyKey
      );
      if (existing) {
        if (
          existing.type === input.type &&
          existing.referenceId === input.referenceId &&
          existing.creditsDelta === -input.credits
        ) {
          return existing;
        }
        throw new Error("Wallet idempotency key conflicts with a different transaction");
      }
    }

    if (wallet.balanceCredits < input.credits) {
      throw new Error("Insufficient wallet credits");
    }

    const promotional = this.promotionalWallets.get(input.userId);
    const promotionalCreditsUsed = Math.min(promotional?.remaining ?? 0, input.credits);
    if (promotional) {
      promotional.remaining -= promotionalCreditsUsed;
    }

    return this.appendWalletTxn({
      userId: input.userId,
      type: input.type,
      creditsDelta: -input.credits,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      metadata: {
        ...input.metadata,
        promotionalCreditsUsed
      }
    });
  }

  getWalletBalance(userId: string) {
    return this.getWalletDetails(userId).balanceCredits;
  }

  listWalletTransactions(userId: string) {
    this.ensureWallet(userId);
    return [...(this.walletTxns.get(userId) ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  }

  createOwnerLead(input: {
    listingId: string;
    ownerUserId: string;
    tenantUserId: string;
    contactUnlockId?: string;
    tenantPhoneMasked?: string | null;
    callDeadlineAt?: number | null;
    preferredSharing?: string | null;
  }) {
    const dedupeKey = `${input.listingId}:${input.tenantUserId}`;
    const existingId = this.leadByListingTenant.get(dedupeKey);
    const existing = existingId ? this.leads.get(existingId) : undefined;
    const now = Date.now();

    if (existing && now - existing.createdAt < 7 * 24 * 60 * 60 * 1000) {
      existing.contactUnlockId = existing.contactUnlockId ?? input.contactUnlockId;
      existing.callDeadlineAt = existing.callDeadlineAt ?? input.callDeadlineAt ?? null;
      // Mirror the DB COALESCE: a specific pick updates; "Any" (null) never wipes.
      existing.preferredSharing = input.preferredSharing ?? existing.preferredSharing ?? null;
      existing.updatedAt = now;
      return { lead: existing, created: false };
    }

    const ownerLeadCount = [...this.leads.values()].filter(
      (lead) => lead.ownerUserId === input.ownerUserId
    ).length;
    const lead: LeadRecord = {
      id: randomUUID(),
      listingId: input.listingId,
      ownerUserId: input.ownerUserId,
      tenantUserId: input.tenantUserId,
      contactUnlockId: input.contactUnlockId,
      tenantPhoneMasked: input.tenantPhoneMasked ?? null,
      status: "new",
      accessState: ownerLeadCount < 2 ? "free" : "locked",
      callDeadlineAt: input.callDeadlineAt ?? null,
      calledAt: null,
      calledBy: null,
      ownerNotes: null,
      preferredSharing: input.preferredSharing ?? null,
      createdAt: now,
      statusChangedAt: now,
      updatedAt: now
    };

    this.leads.set(lead.id, lead);
    this.leadByListingTenant.set(dedupeKey, lead.id);
    return { lead, created: true };
  }

  getOwnerLead(leadId: string, ownerUserId: string) {
    const lead = this.leads.get(leadId);
    return lead?.ownerUserId === ownerUserId ? lead : undefined;
  }

  listOwnerLeads(
    ownerUserId: string,
    status: LeadStatus | undefined,
    page: number,
    pageSize: number,
    revealTenantPhone: boolean
  ) {
    const filtered = [...this.leads.values()]
      .filter((lead) => lead.ownerUserId === ownerUserId && (!status || lead.status === status))
      .sort((a, b) => b.createdAt - a.createdAt);
    const offset = (page - 1) * pageSize;
    const items = filtered.slice(offset, offset + pageSize).map((lead) => {
      const listing = this.listings.get(lead.listingId);
      const tenant = this.users.get(lead.tenantUserId);
      const tenantPhone =
        revealTenantPhone && (lead.accessState === "free" || lead.accessState === "unlocked")
          ? (tenant?.phone ?? null)
          : null;

      return {
        id: lead.id,
        listing_id: lead.listingId,
        listing_title: listing?.title ?? "Listing",
        tenant_user_id: lead.tenantUserId,
        tenant_name: tenant?.full_name ?? "Tenant",
        tenant_phone_masked: lead.tenantPhoneMasked ?? null,
        status: lead.status,
        status_changed_at: new Date(lead.statusChangedAt).toISOString(),
        owner_notes: lead.ownerNotes ?? null,
        created_at: new Date(lead.createdAt).toISOString(),
        access_state: lead.accessState,
        call_deadline_at: lead.callDeadlineAt ? new Date(lead.callDeadlineAt).toISOString() : null,
        called_at: lead.calledAt ? new Date(lead.calledAt).toISOString() : null,
        called_by: lead.calledBy ?? null,
        preferred_sharing: lead.preferredSharing ?? null,
        tenant_phone: tenantPhone
      };
    });

    return { items, total: filtered.length, page, page_size: pageSize };
  }

  getOwnerLeadStats(ownerUserId: string) {
    const stats: Record<LeadStatus | "total", number> = {
      new: 0,
      contacted: 0,
      visit_scheduled: 0,
      deal_done: 0,
      lost: 0,
      total: 0
    };

    for (const lead of this.leads.values()) {
      if (lead.ownerUserId !== ownerUserId) continue;
      stats[lead.status] += 1;
      stats.total += 1;
    }

    return stats;
  }

  updateOwnerLeadStatus(leadId: string, ownerUserId: string, status: LeadStatus, notes?: string) {
    const lead = this.getOwnerLead(leadId, ownerUserId);
    if (!lead) return undefined;

    lead.status = status;
    lead.ownerNotes = notes ?? lead.ownerNotes ?? null;
    lead.statusChangedAt = Date.now();
    lead.updatedAt = lead.statusChangedAt;
    return lead;
  }

  runRefundSweep() {
    const now = Date.now();
    const refunded: UnlockRecord[] = [];

    for (const unlock of this.unlocks.values()) {
      if (
        unlock.ownerResponseStatus === "pending" &&
        unlock.responseDeadlineAt <= now &&
        unlock.unlockStatus === "active"
      ) {
        const refund = this.addWalletTxn({
          userId: unlock.tenantUserId,
          type: "refund_no_response",
          creditsDelta: 1,
          referenceId: unlock.id
        });

        unlock.ownerResponseStatus = "timeout_refunded";
        unlock.unlockStatus = "refunded";
        unlock.refundTxnId = refund.id;
        refunded.push(unlock);
      }
    }

    return refunded;
  }

  getIdempotentResponse<T>(key: string): T | undefined {
    return this.idempotencyResponses.get(key) as T | undefined;
  }

  setIdempotentResponse<T>(key: string, value: T): T {
    this.idempotencyResponses.set(key, value);
    return value;
  }

  createSalesLead(input: {
    createdByUserId: string;
    listingId?: string;
    source: "pg_sales_assist" | "property_management";
    status?: "new" | "contacted" | "qualified" | "closed_won" | "closed_lost";
    idempotencyKey?: string;
    notes?: string;
    metadata?: Record<string, unknown>;
  }) {
    if (input.idempotencyKey) {
      const existing = this.salesLeadByIdempotency.get(
        `${input.createdByUserId}:${input.idempotencyKey}`
      );
      if (existing) {
        return existing;
      }
    }

    const now = Date.now();
    const lead: SalesLeadRecord = {
      id: randomUUID(),
      createdByUserId: input.createdByUserId,
      listingId: input.listingId,
      source: input.source,
      status: input.status ?? "new",
      idempotencyKey: input.idempotencyKey,
      notes: input.notes,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now
    };

    this.salesLeads.set(lead.id, lead);
    if (lead.idempotencyKey) {
      this.salesLeadByIdempotency.set(`${lead.createdByUserId}:${lead.idempotencyKey}`, lead);
    }
    return lead;
  }

  listSalesLeads() {
    return [...this.salesLeads.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  updateSalesLeadStatus(
    id: string,
    status: "new" | "contacted" | "qualified" | "closed_won" | "closed_lost"
  ) {
    const lead = this.salesLeads.get(id);
    if (!lead) {
      return undefined;
    }

    lead.status = status;
    lead.updatedAt = Date.now();
    return lead;
  }

  enqueueOutboundEvent(input: {
    eventType: string;
    aggregateType: string;
    aggregateId?: string;
    payload: Record<string, unknown>;
  }) {
    const now = Date.now();
    const event: OutboundEventRecord = {
      id: this.outboundEventCounter++,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payload: input.payload,
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now
    };

    this.outboundEvents.push(event);
    return event;
  }

  // ── Role request management (in-memory) ─────────────────────────────────

  createRoleRequest(userId: string, requestedRole: "owner" | "pg_operator"): RoleRequestRecord {
    const request: RoleRequestRecord = {
      id: randomUUID(),
      userId,
      requestedRole,
      status: "pending",
      createdAt: Date.now()
    };
    this.roleRequests.set(request.id, request);
    this.roleRequestsByUser.set(userId, request.id);
    return request;
  }

  getPendingRoleRequest(userId: string): RoleRequestRecord | undefined {
    const id = this.roleRequestsByUser.get(userId);
    if (!id) return undefined;
    const req = this.roleRequests.get(id);
    return req?.status === "pending" ? req : undefined;
  }

  decideRoleRequest(
    requestId: string,
    decision: "approved" | "rejected",
    adminId: string
  ): RoleRequestRecord | undefined {
    const req = this.roleRequests.get(requestId);
    if (!req) return undefined;
    req.status = decision;
    req.decidedAt = Date.now();
    req.decidedByAdminId = adminId;

    if (decision === "approved") {
      const user = this.users.get(req.userId);
      if (user) {
        user.role = req.requestedRole;
      }
    }
    return req;
  }

  listRoleRequests(status?: "pending" | "approved" | "rejected"): RoleRequestRecord[] {
    const all = [...this.roleRequests.values()];
    return status ? all.filter((r) => r.status === status) : all;
  }

  /** Admin hard-set of a user's role (bypasses request flow) */
  setUserRole(
    userId: string,
    role: "tenant" | "owner" | "pg_operator" | "admin"
  ): UserRecord | undefined {
    const user = this.users.get(userId);
    if (!user) return undefined;
    user.role = role;
    return user;
  }

  // ─────────────────────────────────────────────────────────────────────
  // PG Operator V1 — in-memory stores (DB-first when DATABASE_URL set)
  // ─────────────────────────────────────────────────────────────────────

  /** pg_properties — V1 keeps exactly one per operator (multi-property gated by flag) */
  pgProperties = new Map<string, Record<string, unknown>>();
  pgPropertiesByOperator(operatorId: string): Record<string, unknown>[] {
    return [...this.pgProperties.values()].filter((p) => p.operator_id === operatorId);
  }
  insertPgProperty(p: Record<string, unknown>): void {
    this.pgProperties.set(p.id as string, p);
  }

  /** pg_listing_drafts — voice-mediated or manual partials before commit to listings */
  pgListingDrafts = new Map<string, Record<string, unknown>>();
  insertPgListingDraft(d: Record<string, unknown>): void {
    this.pgListingDrafts.set(d.id as string, d);
  }
  getPgListingDraft(id: string): Record<string, unknown> | null {
    return this.pgListingDrafts.get(id) ?? null;
  }
  updatePgListingDraftCommitted(id: string, listingId: string): void {
    const d = this.pgListingDrafts.get(id);
    if (d) {
      d.committed_listing_id = listingId;
      d.updated_at = new Date().toISOString();
      this.pgListingDrafts.set(id, d);
    }
  }

  /** Idempotency cache for voice -> listing hydrate */
  pgVoiceIdempotency = new Map<string, string>(); // key -> listing_id
  getPgVoiceIdempotent(key: string): string | null {
    return this.pgVoiceIdempotency.get(key) ?? null;
  }
  setPgVoiceIdempotent(key: string, listingId: string): void {
    this.pgVoiceIdempotency.set(key, listingId);
  }

  /** pg_voice_agent_sessions — transcript + extraction log */
  pgVoiceSessions = new Map<string, Record<string, unknown>>();
  insertPgVoiceSession(s: Record<string, unknown>): void {
    this.pgVoiceSessions.set(s.id as string, s);
  }
  getPgVoiceSession(id: string): Record<string, unknown> | null {
    return this.pgVoiceSessions.get(id) ?? null;
  }
  updatePgVoiceSession(id: string, patch: Record<string, unknown>): void {
    const s = this.pgVoiceSessions.get(id);
    if (s) {
      this.pgVoiceSessions.set(id, { ...s, ...patch, updated_at: new Date().toISOString() });
    }
  }
}
