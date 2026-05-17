import { validate, type ValidationError } from "class-validator";
import { plainToInstance, type ClassConstructor } from "class-transformer";

import { Step1PartiesDto } from "./step-1-parties.dto";
import { Step2PropertyDto } from "./step-2-property.dto";
import { Step3TermsDto } from "./step-3-terms.dto";
import { Step4InventoryUtilitiesDto } from "./step-4-inventory-utilities.dto";
import { Step5ClausesWitnessesDto } from "./step-5-clauses-witnesses.dto";
import { validateCrossField, type CrossFieldRow } from "./cross-field.validator";

// Composed checkout pre-flight schema. Runs all step DTOs + cross-field rules + premium signature gate
// against a cumulative agreement input. Returns a flat error list tagged by source step.

export type FinalAgreementStep = 1 | 2 | 3 | 4 | 5 | 6 | "cross_field";

export interface FinalAgreementError {
  step: FinalAgreementStep;
  code: string;
  field: string;
  message: string;
}

export interface FinalAgreementInput {
  plan_id: string;
  step1?: unknown;
  step2?: unknown;
  step3?: unknown;
  step4?: unknown;
  step5?: unknown;
  signatures?: { owner_present: boolean; tenant_present: boolean };
}

type StepKey = "step1" | "step2" | "step3" | "step4" | "step5";

interface StepDtoBinding {
  step: 1 | 2 | 3 | 4 | 5;
  key: StepKey;
  Cls: ClassConstructor<object>;
}

const STEP_DTOS: StepDtoBinding[] = [
  { step: 1, key: "step1", Cls: Step1PartiesDto },
  { step: 2, key: "step2", Cls: Step2PropertyDto },
  { step: 3, key: "step3", Cls: Step3TermsDto },
  { step: 4, key: "step4", Cls: Step4InventoryUtilitiesDto },
  { step: 5, key: "step5", Cls: Step5ClausesWitnessesDto }
];

function flattenValidationErrors(
  errors: ValidationError[],
  prefix: string
): { field: string; code: string; message: string }[] {
  const out: { field: string; code: string; message: string }[] = [];
  for (const err of errors) {
    const fieldPath = prefix ? `${prefix}.${err.property}` : err.property;
    if (err.constraints) {
      for (const [code, message] of Object.entries(err.constraints)) {
        out.push({ field: fieldPath, code, message });
      }
    }
    if (err.children && err.children.length > 0) {
      out.push(...flattenValidationErrors(err.children, fieldPath));
    }
  }
  return out;
}

function deriveCrossFieldRow(input: FinalAgreementInput): CrossFieldRow {
  const s1 = (input.step1 ?? {}) as Record<string, Record<string, unknown>>;
  const s2 = (input.step2 ?? {}) as Record<string, unknown>;
  const s3 = (input.step3 ?? {}) as Record<string, unknown>;
  const s4 = (input.step4 ?? {}) as Record<string, unknown>;
  return {
    tenure_months: s3.tenure_months as number | undefined,
    lock_in_months: s3.lock_in_months as number | undefined,
    rent_amount_paise: s3.rent_amount_paise as number | undefined,
    owner_pan: s1.owner?.pan as string | undefined,
    tenant_pan: s1.tenant?.pan as string | undefined,
    acknowledge_registration_required: s3.acknowledge_registration_required as boolean | undefined,
    furnishing: s2.furnishing as string | undefined,
    inventory_items: s4.inventory_items as CrossFieldRow["inventory_items"]
  };
}

export async function validateFinalAgreement(
  input: FinalAgreementInput
): Promise<FinalAgreementError[]> {
  const errors: FinalAgreementError[] = [];

  for (const { step, key, Cls } of STEP_DTOS) {
    const payload = input[key];
    if (payload === undefined || payload === null) {
      errors.push({
        step,
        code: "step_missing",
        field: key,
        message: `Step ${step} payload is missing`
      });
      continue;
    }
    const dto = plainToInstance(Cls, payload);
    const validationErrors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true
    });
    const flat = flattenValidationErrors(validationErrors, "");
    for (const f of flat) {
      errors.push({ step, code: f.code, field: f.field, message: f.message });
    }
  }

  const cfErrors = validateCrossField(deriveCrossFieldRow(input));
  for (const cf of cfErrors) {
    errors.push({ step: "cross_field", code: cf.code, field: cf.field, message: cf.message });
  }

  if (input.plan_id === "premium") {
    const owner = input.signatures?.owner_present === true;
    const tenant = input.signatures?.tenant_present === true;
    if (!owner) {
      errors.push({
        step: 6,
        code: "owner_signature_required",
        field: "signatures.owner",
        message: "Owner signature is required for premium plan"
      });
    }
    if (!tenant) {
      errors.push({
        step: 6,
        code: "tenant_signature_required",
        field: "signatures.tenant",
        message: "Tenant signature is required for premium plan"
      });
    }
  }

  return errors;
}
