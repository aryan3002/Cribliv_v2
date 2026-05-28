// Storage port for rent-agreement signatures. `SignaturesService` keeps the
// image guard + canvas-vs-upload policy; only row persistence flows through here.
//
// Two implementations: `InMemorySignaturesRepository` and `DbSignaturesRepository`
// (table `rent_agreement_signatures`, unique on (agreement_id, party)).

import type { DatabaseService } from "../../../common/database.service";
import type { SignatureContentType } from "./image.guard";
import type { Method, Party } from "./signatures.service";

export interface SignatureRow {
  id: string;
  agreement_id: string;
  party: Party;
  method: Method;
  content_type: SignatureContentType;
  image_bytes: Buffer;
  sha256: string;
  created_at: string;
}

export interface SignaturesRepository {
  /** Insert or replace the signature for (agreement_id, party). */
  upsert(row: SignatureRow): Promise<void>;
  getByAgreementAndParty(agreementId: string, party: Party): Promise<SignatureRow | null>;
  listForAgreement(agreementId: string): Promise<SignatureRow[]>;
}

function cloneRow(row: SignatureRow): SignatureRow {
  return { ...row };
}

export class InMemorySignaturesRepository implements SignaturesRepository {
  private readonly rows = new Map<string, SignatureRow>();

  private keyFor(agreementId: string, party: Party): string {
    return `${agreementId}|${party}`;
  }

  async upsert(row: SignatureRow): Promise<void> {
    this.rows.set(this.keyFor(row.agreement_id, row.party), cloneRow(row));
  }

  async getByAgreementAndParty(agreementId: string, party: Party): Promise<SignatureRow | null> {
    const row = this.rows.get(this.keyFor(agreementId, party));
    return row ? cloneRow(row) : null;
  }

  async listForAgreement(agreementId: string): Promise<SignatureRow[]> {
    return Array.from(this.rows.values())
      .filter((row) => row.agreement_id === agreementId)
      .map(cloneRow);
  }
}

function dbRowToSignature(row: Record<string, unknown>): SignatureRow {
  const createdAt = row.created_at;
  return {
    id: String(row.id),
    agreement_id: String(row.agreement_id),
    party: row.party as Party,
    method: row.method as Method,
    content_type: row.content_type as SignatureContentType,
    image_bytes: row.image_bytes as Buffer,
    sha256: String(row.sha256),
    created_at: createdAt instanceof Date ? createdAt.toISOString() : String(createdAt)
  };
}

export class DbSignaturesRepository implements SignaturesRepository {
  constructor(private readonly db: DatabaseService) {}

  async upsert(row: SignatureRow): Promise<void> {
    await this.db.query(
      `INSERT INTO rent_agreement_signatures
         (id, agreement_id, party, method, content_type, image_bytes, sha256, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (agreement_id, party) DO UPDATE SET
         method = EXCLUDED.method,
         content_type = EXCLUDED.content_type,
         image_bytes = EXCLUDED.image_bytes,
         sha256 = EXCLUDED.sha256`,
      [
        row.id,
        row.agreement_id,
        row.party,
        row.method,
        row.content_type,
        row.image_bytes,
        row.sha256,
        row.created_at
      ]
    );
  }

  async getByAgreementAndParty(agreementId: string, party: Party): Promise<SignatureRow | null> {
    const result = await this.db.query(
      `SELECT * FROM rent_agreement_signatures WHERE agreement_id = $1 AND party = $2`,
      [agreementId, party]
    );
    return result.rows[0] ? dbRowToSignature(result.rows[0]) : null;
  }

  async listForAgreement(agreementId: string): Promise<SignatureRow[]> {
    const result = await this.db.query(
      `SELECT * FROM rent_agreement_signatures WHERE agreement_id = $1`,
      [agreementId]
    );
    return result.rows.map(dbRowToSignature);
  }
}
