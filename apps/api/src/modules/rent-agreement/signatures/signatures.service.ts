import { randomUUID } from "node:crypto";

import { canSaveSignature } from "./canvas-vs-upload.policy";
import {
  validateAndReencodeSignatureImage as defaultGuard,
  type SignatureContentType,
  type SignatureGuardResult
} from "./image.guard";

// In-memory backend for Phase 6. DB repository deferred to Phase 13 (mirrors drafts pattern).
// HTTP controller wiring (POST /:id/signature → save) lands in Phase 11.

export type Party = "owner" | "tenant";
export type Method = "canvas" | "upload";

export interface SaveSignatureInput {
  agreementId: string;
  party: Party;
  method: Method;
  plan: string;
  raw: Buffer;
  declaredContentType: string;
}

export interface SaveSignatureResult {
  saved: true;
  sha256: string;
}

interface SignatureRow {
  id: string;
  agreement_id: string;
  party: Party;
  method: Method;
  content_type: SignatureContentType;
  image_bytes: Buffer;
  sha256: string;
  created_at: string;
}

export type SignaturesServiceErrorCode =
  | "RENT_AGREEMENT_SIGNATURE_INVALID_PARTY"
  | "RENT_AGREEMENT_SIGNATURE_INVALID_METHOD"
  | "RENT_AGREEMENT_SIGNATURE_NOT_PREMIUM";

export interface SignaturesServiceError extends Error {
  code: string;
}

type Guard = (raw: Buffer, declared: string) => Promise<SignatureGuardResult>;

interface Deps {
  guard?: Guard;
  clock?: () => Date;
  uuid?: () => string;
}

const VALID_PARTIES: ReadonlySet<string> = new Set(["owner", "tenant"]);
const VALID_METHODS: ReadonlySet<string> = new Set(["canvas", "upload"]);

export class SignaturesService {
  private readonly rows = new Map<string, SignatureRow>();
  private readonly guard: Guard;
  private readonly clock: () => Date;
  private readonly uuid: () => string;

  constructor(deps: Deps = {}) {
    this.guard = deps.guard ?? defaultGuard;
    this.clock = deps.clock ?? (() => new Date());
    this.uuid = deps.uuid ?? randomUUID;
  }

  async save(input: SaveSignatureInput): Promise<SaveSignatureResult> {
    if (!VALID_PARTIES.has(input.party)) {
      throw this.err(
        "RENT_AGREEMENT_SIGNATURE_INVALID_PARTY",
        `party must be 'owner' or 'tenant' (got '${input.party}')`
      );
    }
    if (!VALID_METHODS.has(input.method)) {
      throw this.err(
        "RENT_AGREEMENT_SIGNATURE_INVALID_METHOD",
        `method must be 'canvas' or 'upload' (got '${input.method}')`
      );
    }
    if (!canSaveSignature(input.plan)) {
      throw this.err(
        "RENT_AGREEMENT_SIGNATURE_NOT_PREMIUM",
        `plan '${input.plan}' is not allowed to save signatures (premium only)`
      );
    }

    const guardResult = await this.guard(input.raw, input.declaredContentType);

    const key = this.keyFor(input.agreementId, input.party);
    const existing = this.rows.get(key);
    const row: SignatureRow = {
      id: existing?.id ?? this.uuid(),
      agreement_id: input.agreementId,
      party: input.party,
      method: input.method,
      content_type: guardResult.contentType,
      image_bytes: guardResult.bytes,
      sha256: guardResult.sha256,
      created_at: existing?.created_at ?? this.clock().toISOString()
    };
    this.rows.set(key, row);

    return { saved: true, sha256: guardResult.sha256 };
  }

  hasSignature(agreementId: string, party: Party): boolean {
    return this.rows.has(this.keyFor(agreementId, party));
  }

  hasBothSignatures(agreementId: string): boolean {
    return this.hasSignature(agreementId, "owner") && this.hasSignature(agreementId, "tenant");
  }

  count(agreementId: string): number {
    let n = 0;
    for (const row of this.rows.values()) {
      if (row.agreement_id === agreementId) n++;
    }
    return n;
  }

  // Phase 13: projection for the PDF renderer. Strips internal fields (id, sha256,
  // method, created_at) and exposes only what the renderer needs to embed the image.
  listForAgreement(
    agreementId: string
  ): { party: Party; content_type: SignatureContentType; image_bytes: Buffer }[] {
    const out: { party: Party; content_type: SignatureContentType; image_bytes: Buffer }[] = [];
    for (const row of this.rows.values()) {
      if (row.agreement_id !== agreementId) continue;
      out.push({
        party: row.party,
        content_type: row.content_type,
        image_bytes: row.image_bytes
      });
    }
    return out;
  }

  private keyFor(agreementId: string, party: Party): string {
    return `${agreementId}|${party}`;
  }

  private err(code: SignaturesServiceErrorCode, message: string): SignaturesServiceError {
    const e = new Error(message) as SignaturesServiceError;
    e.code = code;
    return e;
  }
}
