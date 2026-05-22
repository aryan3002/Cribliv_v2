import "reflect-metadata";
import { randomUUID } from "node:crypto";

import { validate, type ValidationError } from "class-validator";
import { plainToInstance, type ClassConstructor } from "class-transformer";

import { encryptPan as defaultEncryptPan } from "../crypto/pan.crypto";
import { validateCrossField, type CrossFieldRow } from "../validators/cross-field.validator";
import { Step1PartiesDto } from "../validators/step-1-parties.dto";
import { Step2PropertyDto } from "../validators/step-2-property.dto";
import { Step3TermsDto } from "../validators/step-3-terms.dto";
import { Step4InventoryUtilitiesDto } from "../validators/step-4-inventory-utilities.dto";
import { Step5ClausesWitnessesDto } from "../validators/step-5-clauses-witnesses.dto";
import { Step6SignaturesDto } from "../validators/step-6-signatures.dto";
import { Step7ReviewDto } from "../validators/step-7-review.dto";

import {
  mapToFull,
  mapToSummary,
  type DraftFull,
  type DraftSummary,
  type RentAgreementRow
} from "./draft-summary.mapper";
import { DraftsRepository, InMemoryDraftsRepository } from "./drafts.repository";
import { isValidStep, nextStep, type PlanId } from "./step-registry";
import { blankRow, writeStep } from "./step-row.mapper";

// Server-enforced state machine for the 7-step wizard. Storage is delegated to a
// `DraftsRepository` (in-memory or DB-backed); the service owns validation and the
// state machine. Mutating methods follow load -> mutate -> repo.save(row).

const VALID_PLANS: ReadonlySet<string> = new Set(["basic", "standard", "premium"]);

const STEP_DTO_MAP: Record<number, ClassConstructor<object> | null> = {
  1: Step1PartiesDto,
  2: Step2PropertyDto,
  3: Step3TermsDto,
  4: Step4InventoryUtilitiesDto,
  5: Step5ClausesWitnessesDto,
  6: Step6SignaturesDto,
  7: Step7ReviewDto
};

export interface CreateDraftDto {
  plan_id: PlanId;
  locale: "en" | "hi";
}

export interface AdvanceResult {
  current_step: number;
  step_validated_at: Record<string, string>;
  terminal: boolean;
}

export interface PatchResult {
  saved: true;
  current_step: number;
}

export interface BackResult {
  current_step: number;
}

export interface DraftErrorDetail {
  code: string;
  field: string;
  message: string;
}

export interface DraftError extends Error {
  code: string;
  errors?: DraftErrorDetail[];
}

interface ServiceDeps {
  clock?: () => Date;
  uuid?: () => string;
  panEncryptor?: (plaintext: string) => Buffer;
  repository?: DraftsRepository;
}

export class DraftsService {
  private readonly repo: DraftsRepository;
  private readonly clock: () => Date;
  private readonly uuid: () => string;
  private readonly encryptPan: (plaintext: string) => Buffer;

  constructor(deps: ServiceDeps = {}) {
    this.repo = deps.repository ?? new InMemoryDraftsRepository();
    this.clock = deps.clock ?? (() => new Date());
    this.uuid = deps.uuid ?? randomUUID;
    this.encryptPan = deps.panEncryptor ?? defaultEncryptPan;
  }

  async create(userId: string, dto: CreateDraftDto, idempotencyKey: string): Promise<DraftFull> {
    if (!VALID_PLANS.has(dto.plan_id)) {
      throw this.makeError("RENT_AGREEMENT_INVALID_PLAN", `Plan ${dto.plan_id} is not valid`);
    }
    const existing = await this.repo.findByIdempotency(userId, idempotencyKey);
    if (existing) return mapToFull(existing);

    const id = this.uuid();
    const ts = this.clock().toISOString();
    const row = blankRow({
      id,
      userId,
      planId: dto.plan_id,
      locale: dto.locale,
      idempotencyKey,
      timestamp: ts
    });
    await this.repo.insert(row);
    // insert is idempotent at the storage layer (ON CONFLICT). Re-read so a
    // concurrent create that won the conflict returns the authoritative row.
    const stored = await this.repo.findByIdempotency(userId, idempotencyKey);
    return mapToFull(stored ?? row);
  }

  async getOne(userId: string, id: string): Promise<DraftFull | null> {
    const row = await this.repo.findById(id);
    if (!row || row.user_id !== userId) return null;
    return mapToFull(row);
  }

  async listForUser(userId: string): Promise<DraftSummary[]> {
    const rows = await this.repo.findByUser(userId);
    return rows.map(mapToSummary);
  }

  async patchStep(
    userId: string,
    id: string,
    step: number,
    partial: unknown
  ): Promise<PatchResult> {
    const row = await this.requireOwnedRow(userId, id);
    if (step > row.current_step) {
      throw this.makeError(
        "RENT_AGREEMENT_STEP_MISMATCH",
        `Cannot autosave step ${step} when current step is ${row.current_step}`
      );
    }
    writeStep(row, step, partial, this.encryptPan);
    row.updated_at = this.clock().toISOString();
    await this.repo.save(row);
    return { saved: true, current_step: row.current_step };
  }

  async advance(
    userId: string,
    id: string,
    step: number,
    payload: unknown
  ): Promise<AdvanceResult> {
    const row = await this.requireOwnedRow(userId, id);
    const plan = row.plan_id as PlanId;
    if (!isValidStep(plan, step)) {
      throw this.makeError(
        "RENT_AGREEMENT_STEP_MISMATCH",
        `Step ${step} is not valid for plan ${plan}`
      );
    }
    if (step !== row.current_step) {
      throw this.makeError(
        "RENT_AGREEMENT_STEP_MISMATCH",
        `Expected step ${row.current_step}, got ${step}`
      );
    }

    const StepDto = STEP_DTO_MAP[step];
    if (StepDto) {
      const dtoInstance = plainToInstance(StepDto, payload ?? {});
      const validationErrors = await validate(dtoInstance, {
        whitelist: true,
        forbidNonWhitelisted: true
      });
      if (validationErrors.length > 0) {
        throw this.makeErrorWithDetails(
          "RENT_AGREEMENT_STEP_VALIDATION_FAILED",
          `Step ${step} validation failed`,
          this.flattenErrors(validationErrors)
        );
      }
    }

    writeStep(row, step, payload, this.encryptPan);

    const crossFieldErrors = validateCrossField(this.deriveCrossFieldRow(row));
    if (crossFieldErrors.length > 0) {
      throw this.makeErrorWithDetails(
        "RENT_AGREEMENT_CROSS_FIELD_FAILED",
        `Cross-field validation failed at step ${step}`,
        crossFieldErrors
      );
    }

    const ts = this.clock().toISOString();
    row.step_validated_at[String(step)] = ts;
    const next = nextStep(plan, step);
    const terminal = next === null;
    if (next !== null) {
      row.current_step = next;
    }
    row.updated_at = ts;
    await this.repo.save(row);

    return {
      current_step: row.current_step,
      step_validated_at: { ...row.step_validated_at },
      terminal
    };
  }

  // ── Phase 13 state-transition mutations ──────────────────────────────────────
  // Called from CheckoutService (markPendingPayment), webhook handler / dev pipeline
  // (markPaid), and PDF worker callback (markGenerated). user_id is NOT checked because
  // these flow from server-side trusted contexts (webhook signature already verified,
  // worker dispatches its own job, checkout already authenticated the user).

  // `paymentOrderId` is the rent_agreement_payment_orders.id uuid — the column
  // FK-references that table (migration 0030).
  async markPendingPayment(agreementId: string, paymentOrderId: string): Promise<void> {
    const row = await this.requireRowById(agreementId);
    row.status = "pending_payment";
    row.payment_order_id = paymentOrderId;
    row.updated_at = this.clock().toISOString();
    await this.repo.save(row);
  }

  async markPaid(agreementId: string): Promise<void> {
    const row = await this.requireRowById(agreementId);
    if (row.status === "paid" || row.status === "generating_pdf" || row.status === "generated") {
      return;
    }
    row.status = "paid";
    row.updated_at = this.clock().toISOString();
    await this.repo.save(row);
  }

  async markGenerated(
    agreementId: string,
    opts: { blobPath: string; expiresAt: string }
  ): Promise<void> {
    const row = await this.requireRowById(agreementId);
    const ts = this.clock().toISOString();
    row.status = "generated";
    row.pdf_blob_path = opts.blobPath;
    row.pdf_generated_at = ts;
    row.expires_at = opts.expiresAt;
    row.updated_at = ts;
    await this.repo.save(row);
  }

  async markEStampIssued(agreementId: string, referenceId: string): Promise<void> {
    const row = await this.requireRowById(agreementId);
    row.e_stamp_reference = referenceId;
    row.updated_at = this.clock().toISOString();
    await this.repo.save(row);
  }

  async markESignSession(agreementId: string, sessionId: string): Promise<void> {
    const row = await this.requireRowById(agreementId);
    row.e_sign_session_id = sessionId;
    row.updated_at = this.clock().toISOString();
    await this.repo.save(row);
  }

  async markESignCompleted(agreementId: string): Promise<void> {
    const row = await this.requireRowById(agreementId);
    const ts = this.clock().toISOString();
    row.e_sign_completed_at = ts;
    row.updated_at = ts;
    await this.repo.save(row);
  }

  async incrementDownloadCount(agreementId: string): Promise<void> {
    const row = await this.requireRowById(agreementId);
    row.download_count = (row.download_count ?? 0) + 1;
    row.updated_at = this.clock().toISOString();
    await this.repo.save(row);
  }

  // Persists the stamp duty computed by StampDutyService onto the agreement row.
  // Server-side trusted context — no user_id check (mirrors the mark* mutations).
  async setStampDuty(agreementId: string, stampDutyPaise: number): Promise<void> {
    const row = await this.requireRowById(agreementId);
    row.stamp_duty_paise = stampDutyPaise;
    row.updated_at = this.clock().toISOString();
    await this.repo.save(row);
  }

  async getByIdUnscoped(id: string): Promise<DraftFull | null> {
    const row = await this.repo.findById(id);
    if (!row) return null;
    return mapToFull(row);
  }

  // PAN-ct-bearing row for the PDF renderer scope ONLY. The renderer decrypts PAN
  // inside its own boundary per Security §PAN handling; no other caller should use
  // this method.
  async getRowByIdForRender(id: string): Promise<RentAgreementRow | null> {
    return this.repo.findById(id);
  }

  private async requireRowById(id: string): Promise<RentAgreementRow> {
    const row = await this.repo.findById(id);
    if (!row) {
      throw this.makeError("RENT_AGREEMENT_NOT_FOUND", `Agreement ${id} not found`);
    }
    return row;
  }

  async back(userId: string, id: string, targetStep: number): Promise<BackResult> {
    const row = await this.requireOwnedRow(userId, id);
    if (targetStep >= row.current_step) {
      throw this.makeError(
        "RENT_AGREEMENT_STEP_MISMATCH",
        `Cannot go back to step ${targetStep} when current step is ${row.current_step}`
      );
    }
    if (!isValidStep(row.plan_id as PlanId, targetStep)) {
      throw this.makeError(
        "RENT_AGREEMENT_STEP_MISMATCH",
        `Step ${targetStep} is not valid for plan ${row.plan_id}`
      );
    }
    row.current_step = targetStep;
    row.updated_at = this.clock().toISOString();
    await this.repo.save(row);
    return { current_step: row.current_step };
  }

  private async requireOwnedRow(userId: string, id: string): Promise<RentAgreementRow> {
    const row = await this.repo.findById(id);
    if (!row || row.user_id !== userId) {
      throw this.makeError("RENT_AGREEMENT_NOT_FOUND", `Draft ${id} not found`);
    }
    return row;
  }

  // PAN ciphertext is opaque to cross-field rules; pass a valid-shape sentinel when present so the
  // high-rent gate sees "has PAN" without decrypting. Plaintext stays in PDF renderer scope only
  // per Security §PAN handling.
  private deriveCrossFieldRow(row: RentAgreementRow): CrossFieldRow {
    return {
      tenure_months: row.tenure_months ?? undefined,
      lock_in_months: row.lock_in_months ?? undefined,
      rent_amount_paise: row.rent_amount_paise ?? undefined,
      owner_pan: this.panSentinel(row.owner_pan_ct, "ABCDE1234F"),
      tenant_pan: this.panSentinel(row.tenant_pan_ct, "ZYXWV9876A"),
      acknowledge_registration_required: row.acknowledge_registration_required,
      furnishing: row.property_furnishing ?? undefined,
      inventory_items: row.inventory_items
    };
  }

  private panSentinel(ct: Buffer | null, sentinel: string): string | undefined {
    return Buffer.isBuffer(ct) && ct.length > 0 ? sentinel : undefined;
  }

  private flattenErrors(errors: ValidationError[], prefix = ""): DraftErrorDetail[] {
    const out: DraftErrorDetail[] = [];
    for (const err of errors) {
      const fieldPath = prefix ? `${prefix}.${err.property}` : err.property;
      if (err.constraints) {
        for (const [code, message] of Object.entries(err.constraints)) {
          out.push({ code, field: fieldPath, message });
        }
      }
      if (err.children && err.children.length > 0) {
        out.push(...this.flattenErrors(err.children, fieldPath));
      }
    }
    return out;
  }

  private makeError(code: string, message: string): DraftError {
    const err = new Error(message) as DraftError;
    err.code = code;
    return err;
  }

  private makeErrorWithDetails(
    code: string,
    message: string,
    errors: DraftErrorDetail[]
  ): DraftError {
    const err = this.makeError(code, message);
    err.errors = errors;
    return err;
  }
}
