import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";

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
  verificationStatus: "unverified" | "pending" | "verified" | "failed";
  status: "draft" | "pending_review" | "active" | "rejected" | "paused" | "archived";
  createdAt: number;
}

interface WalletTxn {
  id: string;
  userId: string;
  type: string;
  creditsDelta: number;
  referenceId?: string;
  createdAt: number;
  idempotencyKey?: string;
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
  unlocks = new Map<string, UnlockRecord>();
  unlockByIdempotency = new Map<string, UnlockRecord>();
  idempotencyResponses = new Map<string, unknown>();
  verificationAttempts: Array<Record<string, unknown>> = [];
  adminActions: Array<Record<string, unknown>> = [];

  constructor() {
    const ownerId = randomUUID();
    const tenantId = randomUUID();
    const adminId = randomUUID();

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

    [owner, tenant, admin].forEach((u) => {
      this.users.set(u.id, u);
      this.usersByPhone.set(u.phone, u);
      this.wallets.set(u.id, u.role === "tenant" ? 2 : 0);
      this.walletTxns.set(u.id, []);
    });

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

  ensureWallet(userId: string) {
    if (!this.wallets.has(userId)) {
      this.wallets.set(userId, 0);
      this.walletTxns.set(userId, []);
    }
  }

  addWalletTxn(input: Omit<WalletTxn, "id" | "createdAt">) {
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

  getWalletBalance(userId: string) {
    this.ensureWallet(userId);
    return this.wallets.get(userId) ?? 0;
  }

  listWalletTransactions(userId: string) {
    this.ensureWallet(userId);
    return [...(this.walletTxns.get(userId) ?? [])].sort((a, b) => b.createdAt - a.createdAt);
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
}
