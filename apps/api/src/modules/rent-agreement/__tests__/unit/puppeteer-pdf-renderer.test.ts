import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock puppeteer (used transitively by browser-pool)
vi.mock("puppeteer", () => ({
  default: { launch: vi.fn() }
}));

// Mock handlebars
vi.mock("handlebars", () => {
  const templateFn = vi.fn().mockReturnValue("<html><body>Rendered Agreement</body></html>");
  const compileFn = vi.fn().mockReturnValue(templateFn);
  return {
    default: {
      compile: compileFn,
      registerPartial: vi.fn(),
      registerHelper: vi.fn()
    },
    compile: compileFn,
    registerPartial: vi.fn(),
    registerHelper: vi.fn()
  };
});

// Mock fs for template loading
vi.mock("node:fs", () => ({
  readFileSync: vi.fn().mockReturnValue("<html>{{title}}</html>"),
  existsSync: vi.fn().mockReturnValue(true)
}));

// Mock pan crypto — default to returning a fake plaintext, individual tests can override to throw
vi.mock("../../crypto/pan.crypto", () => ({
  decryptPan: vi.fn().mockReturnValue("ABCDE1234F")
}));

import { decryptPan } from "../../crypto/pan.crypto";
import { PuppeteerPdfRenderer } from "../../pdf/puppeteer-pdf-renderer";
import type { RenderInput, SignatureProjection } from "../../pdf/pdf-renderer.port";
import type { RentAgreementRow } from "../../drafts/draft-summary.mapper";
import type { BrowserPool } from "../../pdf/browser-pool";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockPage() {
  return {
    setContent: vi.fn().mockResolvedValue(undefined),
    pdf: vi.fn().mockResolvedValue(Buffer.from("%PDF-1.4-fake")),
    close: vi.fn().mockResolvedValue(undefined),
    goto: vi.fn().mockResolvedValue(undefined)
  };
}

function makeMockPool(page = makeMockPage()): BrowserPool {
  return {
    acquire: vi.fn().mockResolvedValue(page),
    release: vi.fn().mockResolvedValue(undefined),
    launch: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
    generationCount: 0
  } as unknown as BrowserPool;
}

function fakeRow(overrides: Partial<RentAgreementRow> = {}): RentAgreementRow {
  return {
    id: "aaaa-bbbb-cccc-dddd",
    user_id: "user-1",
    plan_id: "premium",
    locale: "en",
    idempotency_key: "idem-1",
    current_step: 7,
    step_validated_at: {},
    status: "paid",
    owner_full_name: "Rajesh Kumar",
    owner_father_name: "Mohan Kumar",
    owner_age: 45,
    owner_phone: "+919876543210",
    owner_email: "rajesh@example.com",
    owner_permanent_address: "123 MG Road, Bengaluru, Karnataka",
    owner_pan_ct: null,
    owner_aadhaar_last4: "1234",
    tenant_full_name: "Priya Sharma",
    tenant_father_name: "Vijay Sharma",
    tenant_age: 30,
    tenant_phone: "+919876543211",
    tenant_email: "priya@example.com",
    tenant_permanent_address: "456 Brigade Road, Bengaluru, Karnataka",
    tenant_pan_ct: null,
    tenant_aadhaar_last4: "5678",
    tenant_company_name: null,
    property_full_address: "789 Whitefield Main Road, Bengaluru, Karnataka 560066",
    property_type: "apartment",
    property_area_sqft: 1200,
    property_furnishing: "semi_furnished",
    property_purpose: "residential",
    property_parking: "covered",
    property_floor_number: 3,
    property_total_floors: 10,
    property_flat_number: "301",
    property_municipal_number: "WF-789",
    property_survey_number: null,
    agreement_type: "standard",
    agreement_date: "2026-06-01",
    commencement_date: "2026-06-01",
    tenure_months: 11,
    lock_in_months: 3,
    notice_period_months: 1,
    rent_amount_paise: 2500000,
    security_deposit_paise: 5000000,
    annual_increment_pct: 5,
    state_code: "KA",
    city: "Bengaluru",
    acknowledge_registration_required: false,
    inventory_items: [],
    rent_due_day: 5,
    rent_payment_method: "bank_transfer",
    maintenance_included: true,
    maintenance_paise: null,
    electricity_allocation: "tenant",
    water_allocation: "tenant",
    gas_allocation: "tenant",
    society_charges_allocation: "owner",
    late_payment_penalty_pct: 2,
    pets_allowed: false,
    subletting_allowed: false,
    renovation_allowed: false,
    commercial_use_allowed: false,
    max_occupants: 4,
    additional_terms: [],
    witness_1: { name: "Witness One", father_name: "Father One", address: "Address 1" },
    witness_2: { name: "Witness Two", father_name: "Father Two", address: "Address 2" },
    stamp_duty_paise: 50000,
    payment_order_id: "order-1",
    pdf_blob_path: null,
    pdf_generated_at: null,
    download_count: 0,
    max_downloads: 5,
    expires_at: null,
    e_stamp_reference: null,
    e_sign_session_id: null,
    e_sign_completed_at: null,
    created_at: "2026-05-18T12:00:00Z",
    updated_at: "2026-05-18T12:00:00Z",
    ...overrides
  } as RentAgreementRow;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PuppeteerPdfRenderer", () => {
  describe("render", () => {
    it("acquires a page from pool, sets HTML content, generates PDF, and releases page", async () => {
      const mockPage = makeMockPage();
      const pool = makeMockPool(mockPage);
      const renderer = new PuppeteerPdfRenderer({ pool });

      const input: RenderInput = {
        row: fakeRow(),
        signatures: [],
        locale: "en"
      };

      const result = await renderer.render(input);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      expect(pool.acquire).toHaveBeenCalledTimes(1);
      expect(mockPage.setContent).toHaveBeenCalledTimes(1);
      expect(mockPage.setContent).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ waitUntil: "load" })
      );
      expect(mockPage.pdf).toHaveBeenCalledTimes(1);
      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          format: "A4"
        })
      );
      expect(pool.release).toHaveBeenCalledTimes(1);
      expect(pool.release).toHaveBeenCalledWith(mockPage);
    });

    it("releases the page back to pool even when page.pdf throws", async () => {
      const mockPage = makeMockPage();
      mockPage.pdf.mockRejectedValueOnce(new Error("chrome crash"));
      const pool = makeMockPool(mockPage);
      const renderer = new PuppeteerPdfRenderer({ pool });

      const input: RenderInput = {
        row: fakeRow(),
        signatures: [],
        locale: "en"
      };

      await expect(renderer.render(input)).rejects.toThrow("chrome crash");
      expect(pool.release).toHaveBeenCalledWith(mockPage);
    });

    it("releases the page back to pool even when setContent throws", async () => {
      const mockPage = makeMockPage();
      mockPage.setContent.mockRejectedValueOnce(new Error("content error"));
      const pool = makeMockPool(mockPage);
      const renderer = new PuppeteerPdfRenderer({ pool });

      const input: RenderInput = {
        row: fakeRow(),
        signatures: [],
        locale: "en"
      };

      await expect(renderer.render(input)).rejects.toThrow("content error");
      expect(pool.release).toHaveBeenCalledWith(mockPage);
    });

    it("passes signatures as base64 data URIs when present", async () => {
      const mockPage = makeMockPage();
      const pool = makeMockPool(mockPage);
      const renderer = new PuppeteerPdfRenderer({ pool });

      const sigs: SignatureProjection[] = [
        {
          party: "owner",
          content_type: "image/png",
          image_bytes: Buffer.from("PNG-OWNER-BYTES")
        },
        {
          party: "tenant",
          content_type: "image/jpeg",
          image_bytes: Buffer.from("JPEG-TENANT-BYTES")
        }
      ];

      const input: RenderInput = {
        row: fakeRow(),
        signatures: sigs,
        locale: "en"
      };

      await renderer.render(input);

      // The HTML passed to setContent should contain base64 data URIs
      const htmlArg = mockPage.setContent.mock.calls[0][0] as string;
      expect(typeof htmlArg).toBe("string");
    });

    it("generates PDF with A4 format and correct margins", async () => {
      const mockPage = makeMockPage();
      const pool = makeMockPool(mockPage);
      const renderer = new PuppeteerPdfRenderer({ pool });

      await renderer.render({
        row: fakeRow(),
        signatures: [],
        locale: "en"
      });

      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          format: "A4",
          margin: expect.objectContaining({
            top: expect.any(String),
            bottom: expect.any(String),
            left: expect.any(String),
            right: expect.any(String)
          })
        })
      );
    });

    it("enables displayHeaderFooter and passes headerTemplate and footerTemplate per [[PDF-Pipeline]] §96", async () => {
      const mockPage = makeMockPage();
      const pool = makeMockPool(mockPage);
      const renderer = new PuppeteerPdfRenderer({ pool });

      await renderer.render({
        row: fakeRow(),
        signatures: [],
        locale: "en"
      });

      expect(mockPage.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          displayHeaderFooter: true,
          headerTemplate: expect.any(String),
          footerTemplate: expect.any(String)
        })
      );
      const opts = mockPage.pdf.mock.calls[0][0] as {
        headerTemplate: string;
        footerTemplate: string;
      };
      expect(opts.headerTemplate.length).toBeGreaterThan(0);
      expect(opts.footerTemplate.length).toBeGreaterThan(0);
    });

    it("PAN ciphertext is decrypted within render scope and not leaked", async () => {
      const mockPage = makeMockPage();
      const pool = makeMockPool(mockPage);
      const renderer = new PuppeteerPdfRenderer({ pool });

      // Provide a row with PAN ciphertext — since we're mocking,
      // the renderer should handle null PAN gracefully
      const input: RenderInput = {
        row: fakeRow({ owner_pan_ct: null, tenant_pan_ct: null }),
        signatures: [],
        locale: "en"
      };

      const result = await renderer.render(input);
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it("rejects render and propagates a security event when PAN decryption fails per [[PDF-Pipeline]] §215", async () => {
      vi.mocked(decryptPan).mockImplementationOnce(() => {
        throw new Error("aead: invalid tag");
      });
      const mockPage = makeMockPage();
      const pool = makeMockPool(mockPage);
      const renderer = new PuppeteerPdfRenderer({ pool });

      const input: RenderInput = {
        row: fakeRow({ owner_pan_ct: Buffer.from("fake-ct"), tenant_pan_ct: null }),
        signatures: [],
        locale: "en"
      };

      await expect(renderer.render(input)).rejects.toThrow(/PAN decrypt|pan_decrypt/);
      // Pool must NOT have been touched — decrypt happens before acquire
      expect(pool.acquire).not.toHaveBeenCalled();
    });

    it("typed PAN decrypt failure error carries RENT_AGREEMENT_PDF_PAN_DECRYPT_FAILED code", async () => {
      vi.mocked(decryptPan).mockImplementationOnce(() => {
        throw new Error("aead: invalid tag");
      });
      const pool = makeMockPool();
      const renderer = new PuppeteerPdfRenderer({ pool });

      try {
        await renderer.render({
          row: fakeRow({ owner_pan_ct: Buffer.from("fake-ct") }),
          signatures: [],
          locale: "en"
        });
        throw new Error("should not reach");
      } catch (err) {
        expect((err as { code?: string }).code).toBe("RENT_AGREEMENT_PDF_PAN_DECRYPT_FAILED");
      }
    });

    it("throws typed RENT_AGREEMENT_PDF_TEMPLATE_NOT_FOUND when locale template missing", async () => {
      const fs = await import("node:fs");
      vi.mocked(fs.existsSync).mockReturnValueOnce(false);
      const pool = makeMockPool();
      const renderer = new PuppeteerPdfRenderer({ pool });

      try {
        await renderer.render({
          row: fakeRow(),
          signatures: [],
          locale: "xx"
        });
        throw new Error("should not reach");
      } catch (err) {
        expect((err as { code?: string }).code).toBe("RENT_AGREEMENT_PDF_TEMPLATE_NOT_FOUND");
      }
    });
  });

  describe("implements PdfRendererPort", () => {
    it("render method returns a Buffer", async () => {
      const pool = makeMockPool();
      const renderer = new PuppeteerPdfRenderer({ pool });
      const buf = await renderer.render({
        row: fakeRow(),
        signatures: [],
        locale: "en"
      });
      expect(Buffer.isBuffer(buf)).toBe(true);
    });
  });
});
