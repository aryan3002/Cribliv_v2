import { randomUUID } from "node:crypto";

import { canSaveSignature } from "./canvas-vs-upload.policy";
import {
  validateAndReencodeSignatureImage as defaultGuard,
  type SignatureContentType,
  type SignatureGuardResult
} from "./image.guard";
import {
  InMemorySignaturesRepository,
  type SignatureRow,
  type SignaturesRepository
} from "./signatures.repository";

// 7-step wizard signature capture (premium plan only). The image guard +
// canvas-vs-upload policy live here; row persistence is delegated to a
// `SignaturesRepository` (in-memory or DB-backed).

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

export type SignaturesServiceErrorCode =
  | "RENT_AGREEMENT_SIGNATURE_INVALID_PARTY"
  | "RENT_AGREEMENT_SIGNATURE_INVALID_METHOD"
  | "RENT_AGREEMENT_SIGNATURE_NOT_PREMIUM";

export interface SignaturesServiceError extends Error {
  code: string;
}

export interface SignatureProjection {
  party: Party;
  content_type: SignatureContentType;
  image_bytes: Buffer;
}

type Guard = (raw: Buffer, declared: string) => Promise<SignatureGuardResult>;

interface Deps {
  guard?: Guard;
  clock?: () => Date;
  uuid?: () => string;
  repository?: SignaturesRepository;
}

const VALID_PARTIES: ReadonlySet<string> = new Set(["owner", "tenant"]);
const VALID_METHODS: ReadonlySet<string> = new Set(["canvas", "upload"]);

export class SignaturesService {
  private readonly repo: SignaturesRepository;
  private readonly guard: Guard;
  private readonly clock: () => Date;
  private readonly uuid: () => string;

  constructor(deps: Deps = {}) {
    this.repo = deps.repository ?? new InMemorySignaturesRepository();
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

    // Preserve the original id + created_at on re-save of the same party.
    const existing = await this.repo.getByAgreementAndParty(input.agreementId, input.party);
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
    await this.repo.upsert(row);

    return { saved: true, sha256: guardResult.sha256 };
  }

  async hasSignature(agreementId: string, party: Party): Promise<boolean> {
    return (await this.repo.getByAgreementAndParty(agreementId, party)) !== null;
  }

  async hasBothSignatures(agreementId: string): Promise<boolean> {
    const parties = new Set((await this.repo.listForAgreement(agreementId)).map((r) => r.party));
    return parties.has("owner") && parties.has("tenant");
  }

  async count(agreementId: string): Promise<number> {
    return (await this.repo.listForAgreement(agreementId)).length;
  }

  // Projection for the PDF renderer. Strips internal fields (id, sha256, method,
  // created_at) and exposes only what the renderer needs to embed the image.
  async listForAgreement(agreementId: string): Promise<SignatureProjection[]> {
    const rows = await this.repo.listForAgreement(agreementId);
    return rows.map((row) => ({
      party: row.party,
      content_type: row.content_type,
      image_bytes: row.image_bytes
    }));
  }

  private err(code: SignaturesServiceErrorCode, message: string): SignaturesServiceError {
    const e = new Error(message) as SignaturesServiceError;
    e.code = code;
    return e;
  }
}
