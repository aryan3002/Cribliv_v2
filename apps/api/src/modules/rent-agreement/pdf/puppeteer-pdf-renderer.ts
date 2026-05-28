// Real Puppeteer + Handlebars PDF renderer. Implements PdfRendererPort.
// Phase 8b: renders agreement data into a full HTML document via Handlebars
// templates, then converts to PDF via headless Chrome (Puppeteer).
//
// PAN decryption scope: PAN ciphertext is decrypted only inside hydrateTemplateData(),
// flows into the template `data` and the compiled `html` string, and is released
// to GC when render() returns. The page is reset to about:blank in pool.release()
// so plaintext does not persist in Chromium between renders. See [[Security]] §PII handling.
// Per [[PDF-Pipeline]] §Failure modes: PAN decryption failure MUST fail the job
// (security event), not silently emit a PDF without PAN.
//
// All user input is auto-escaped by Handlebars. Triple-stash {{{...}}} is
// BANNED — see [[PDF-Pipeline]] §PDF template.

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import Handlebars from "handlebars";
import type { PdfRendererPort, RenderInput, SignatureProjection } from "./pdf-renderer.port";
import type { BrowserPool } from "./browser-pool";
import type { RentAgreementRow } from "../drafts/draft-summary.mapper";
import { paiseToRupees } from "../format/money.format";
import { numberToIndianWords } from "../format/words.format";
import { formatLegalDate } from "../format/date.format";
import { decryptPan } from "../crypto/pan.crypto";

// ---------------------------------------------------------------------------
// Typed errors (matches PdfQueueError pattern from pdf-job-queue.service.ts)
// ---------------------------------------------------------------------------

export type PdfRendererErrorCode =
  | "RENT_AGREEMENT_PDF_TEMPLATE_NOT_FOUND"
  | "RENT_AGREEMENT_PDF_PARTIAL_NOT_FOUND"
  | "RENT_AGREEMENT_PDF_PAN_DECRYPT_FAILED";

export class PdfRendererError extends Error {
  readonly code: PdfRendererErrorCode;
  constructor(code: PdfRendererErrorCode, message: string) {
    super(message);
    this.name = "PdfRendererError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Template paths
// ---------------------------------------------------------------------------

const TEMPLATES_DIR = resolve(__dirname, "templates");

function loadTemplate(locale: string): string {
  const path = join(TEMPLATES_DIR, `agreement.${locale}.hbs`);
  if (!existsSync(path)) {
    throw new PdfRendererError(
      "RENT_AGREEMENT_PDF_TEMPLATE_NOT_FOUND",
      `Template not found for locale: ${locale}`
    );
  }
  return readFileSync(path, "utf-8");
}

function loadPartial(name: string): string {
  const path = join(TEMPLATES_DIR, "partials", `${name}.hbs`);
  if (!existsSync(path)) {
    throw new PdfRendererError(
      "RENT_AGREEMENT_PDF_PARTIAL_NOT_FOUND",
      `Partial not found: ${name}`
    );
  }
  return readFileSync(path, "utf-8");
}

// ---------------------------------------------------------------------------
// Handlebars setup (register partials + helpers once)
// ---------------------------------------------------------------------------

let hbsInitialized = false;

// Source strings for partials that page.pdf() uses directly as
// headerTemplate / footerTemplate (Puppeteer renders these in an iframe,
// independent of the main page Handlebars compile).
const partialSources: Record<string, string> = {};

function initHandlebars(): void {
  if (hbsInitialized) return;

  const partials = ["header", "footer", "witness-block", "signature-block", "watermark"];
  for (const name of partials) {
    const source = loadPartial(name);
    partialSources[name] = source;
    Handlebars.registerPartial(name, source);
  }

  // Helper: add two numbers (used for 1-indexed inventory rows)
  Handlebars.registerHelper("add", (a: number, b: number) => a + b);

  // Helper: output a data URI without HTML-escaping (avoids banned triple-stash).
  // Only used for signature image src attributes where the value is server-generated
  // (not user input), so SafeString is safe here.
  Handlebars.registerHelper("safeDataUri", (uri: string) => {
    if (!uri || typeof uri !== "string") return "";
    // Validate it's a data URI (not user-supplied arbitrary HTML)
    if (!uri.startsWith("data:image/")) return "";
    return new Handlebars.SafeString(uri);
  });

  hbsInitialized = true;
}

// ---------------------------------------------------------------------------
// Data hydration helpers
// ---------------------------------------------------------------------------

// Puppeteer's headerTemplate/footerTemplate render in an isolated frame with
// `font-size: 0` by default. Wrap the partial HTML in a styled div so it renders
// visibly. Inline because the partial's CSS (in the main template's <style>) is
// not inherited by the header/footer frame.
function wrapHeaderFooter(html: string): string {
  return `<div style="font-size: 9px; width: 100%; padding: 0 15mm; color: #444; display: flex; justify-content: space-between;">${html}</div>`;
}

function ordinalSuffix(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  switch (day % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

function buildSignatureDataUri(
  signatures: SignatureProjection[],
  party: "owner" | "tenant"
): string | null {
  const sig = signatures.find((s) => s.party === party);
  if (!sig) return null;
  const b64 = sig.image_bytes.toString("base64");
  return `data:${sig.content_type};base64,${b64}`;
}

// Per [[PDF-Pipeline]] §215: PAN decryption failure MUST fail the job (security
// event), not silently emit a PDF without PAN. Re-raise as a typed error so the
// worker's catch path in pdf-job-worker.ts marks the job failed with
// `render_failed: RENT_AGREEMENT_PDF_PAN_DECRYPT_FAILED: ...`.
function decryptPanOrNull(ct: Buffer | null, party: "owner" | "tenant"): string | null {
  if (!ct || ct.length === 0) return null;
  try {
    return decryptPan(ct);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new PdfRendererError(
      "RENT_AGREEMENT_PDF_PAN_DECRYPT_FAILED",
      `PAN decrypt failed for ${party}: ${cause}`
    );
  }
}

function hydrateTemplateData(
  row: RentAgreementRow,
  signatures: SignatureProjection[]
): Record<string, unknown> {
  // Decrypt PAN into local scope. If either side's ciphertext is corrupt/tampered,
  // this throws PdfRendererError(RENT_AGREEMENT_PDF_PAN_DECRYPT_FAILED) and aborts
  // the render before any page is acquired from the pool.
  let ownerPan: string | null = decryptPanOrNull(row.owner_pan_ct, "owner");
  let tenantPan: string | null = decryptPanOrNull(row.tenant_pan_ct, "tenant");

  const rentPaise = row.rent_amount_paise ?? 0;
  const depositPaise = row.security_deposit_paise ?? 0;
  const maintenancePaise = row.maintenance_paise ?? 0;
  const stampDutyPaise = row.stamp_duty_paise ?? 0;
  const rentRupees = Math.trunc(Math.abs(rentPaise) / 100);
  const depositRupees = Math.trunc(Math.abs(depositPaise) / 100);

  const data: Record<string, unknown> = {
    // Agreement metadata
    agreement_id_short: row.id.slice(-8),
    state_code: row.state_code ?? "",

    // Dates
    agreement_date_formatted: row.agreement_date ? formatLegalDate(row.agreement_date) : "",
    commencement_date_formatted: row.commencement_date
      ? formatLegalDate(row.commencement_date)
      : "",

    // Parties — Owner
    owner_full_name: row.owner_full_name ?? "",
    owner_father_name: row.owner_father_name ?? "",
    owner_age: row.owner_age ?? "",
    owner_phone: row.owner_phone ?? "",
    owner_email: row.owner_email ?? null,
    owner_permanent_address: row.owner_permanent_address ?? "",
    owner_pan_display: ownerPan ?? null,
    owner_aadhaar_last4: row.owner_aadhaar_last4 ?? null,

    // Parties — Tenant
    tenant_full_name: row.tenant_full_name ?? "",
    tenant_father_name: row.tenant_father_name ?? "",
    tenant_age: row.tenant_age ?? "",
    tenant_phone: row.tenant_phone ?? "",
    tenant_email: row.tenant_email ?? null,
    tenant_permanent_address: row.tenant_permanent_address ?? "",
    tenant_pan_display: tenantPan ?? null,
    tenant_aadhaar_last4: row.tenant_aadhaar_last4 ?? null,
    tenant_company_name: row.tenant_company_name ?? null,

    // Property
    property_full_address: row.property_full_address ?? "",
    property_type: row.property_type ?? "",
    property_area_sqft: row.property_area_sqft ?? "",
    property_furnishing: row.property_furnishing ?? "",
    property_purpose: row.property_purpose ?? "",
    property_parking: row.property_parking ?? null,
    property_flat_number: row.property_flat_number ?? null,
    property_floor_number: row.property_floor_number ?? null,
    property_total_floors: row.property_total_floors ?? null,
    property_municipal_number: row.property_municipal_number ?? null,
    property_survey_number: row.property_survey_number ?? null,

    // Terms
    tenure_months: row.tenure_months ?? "",
    lock_in_months: row.lock_in_months ?? null,
    notice_period_months: row.notice_period_months ?? "",
    annual_increment_pct: row.annual_increment_pct ?? null,
    city: row.city ?? "",

    // Money
    rent_formatted: paiseToRupees(rentPaise),
    rent_in_words: numberToIndianWords(rentRupees),
    deposit_formatted: paiseToRupees(depositPaise),
    deposit_in_words: numberToIndianWords(depositRupees),
    maintenance_included: row.maintenance_included ?? false,
    maintenance_formatted: maintenancePaise > 0 ? paiseToRupees(maintenancePaise) : null,
    stamp_duty_formatted: paiseToRupees(stampDutyPaise),

    // Rent payment
    rent_due_day: row.rent_due_day ?? 1,
    rent_due_day_suffix: ordinalSuffix(row.rent_due_day ?? 1),
    rent_payment_method: row.rent_payment_method ?? "bank_transfer",

    // Utilities
    electricity_allocation: row.electricity_allocation ?? "tenant",
    water_allocation: row.water_allocation ?? "tenant",
    gas_allocation: row.gas_allocation ?? "tenant",
    society_charges_allocation: row.society_charges_allocation ?? "owner",

    // Late payment
    late_payment_penalty_pct: row.late_payment_penalty_pct ?? null,

    // Restrictions
    pets_allowed: row.pets_allowed ?? false,
    subletting_allowed: row.subletting_allowed ?? false,
    renovation_allowed: row.renovation_allowed ?? false,
    commercial_use_allowed: row.commercial_use_allowed ?? false,
    max_occupants: row.max_occupants ?? null,

    // Inventory
    inventory_items: row.inventory_items ?? [],
    has_inventory: (row.inventory_items ?? []).length > 0,

    // Additional terms
    additional_terms: row.additional_terms ?? [],
    has_additional_terms: (row.additional_terms ?? []).length > 0,

    // Witnesses
    witness_1: row.witness_1 ?? null,
    witness_2: row.witness_2 ?? null,
    has_witnesses: !!(row.witness_1 || row.witness_2),

    // Signatures (base64 data URIs)
    owner_signature_data_uri: buildSignatureDataUri(signatures, "owner"),
    tenant_signature_data_uri: buildSignatureDataUri(signatures, "tenant"),

    // Registration
    acknowledge_registration_required: row.acknowledge_registration_required ?? false
  };

  // Clear PAN from local scope
  ownerPan = null;
  tenantPan = null;

  return data;
}

// ---------------------------------------------------------------------------
// Renderer class
// ---------------------------------------------------------------------------

interface PuppeteerPdfRendererDeps {
  pool: BrowserPool;
}

export class PuppeteerPdfRenderer implements PdfRendererPort {
  private readonly pool: BrowserPool;

  constructor(deps: PuppeteerPdfRendererDeps) {
    this.pool = deps.pool;
  }

  async render(input: RenderInput): Promise<Buffer> {
    initHandlebars();

    const templateSource = loadTemplate(input.locale);
    const compiled = Handlebars.compile(templateSource);
    const data = hydrateTemplateData(input.row, input.signatures);
    const html = compiled(data);

    // Per [[PDF-Pipeline]] §96: page.pdf must enable displayHeaderFooter and pass
    // headerTemplate/footerTemplate. Puppeteer renders these in an isolated iframe,
    // so we compile the source strings directly with the same data context.
    // Inline font-size is required (Puppeteer default is too small to read).
    const headerTemplate = wrapHeaderFooter(
      Handlebars.compile(partialSources["header"] ?? "")(data)
    );
    const footerTemplate = wrapHeaderFooter(
      Handlebars.compile(partialSources["footer"] ?? "")(data)
    );

    const page = await this.pool.acquire();
    try {
      await page.setContent(html, { waitUntil: "load" });
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate,
        footerTemplate,
        margin: {
          top: "20mm",
          bottom: "20mm",
          left: "15mm",
          right: "15mm"
        }
      });
      // pdfBuffer can be Buffer or Uint8Array depending on Puppeteer version
      return Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer);
    } finally {
      await this.pool.release(page);
    }
  }
}
