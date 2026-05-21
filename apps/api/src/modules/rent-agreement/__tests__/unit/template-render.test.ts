import { beforeEach, describe, expect, it } from "vitest";
import Handlebars from "handlebars";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Load real templates (no mocking — this is a template correctness test)
// ---------------------------------------------------------------------------

const TEMPLATES_DIR = resolve(__dirname, "../../pdf/templates");

function loadPartial(name: string): string {
  return readFileSync(join(TEMPLATES_DIR, "partials", `${name}.hbs`), "utf-8");
}

function loadMainTemplate(locale: string): string {
  return readFileSync(join(TEMPLATES_DIR, `agreement.${locale}.hbs`), "utf-8");
}

// ---------------------------------------------------------------------------
// Stub data matching a complete agreement
// ---------------------------------------------------------------------------

function stubData(): Record<string, unknown> {
  return {
    agreement_id_short: "cccc-dddd",
    state_code: "KA",
    agreement_date_formatted: "1st June, 2026",
    commencement_date_formatted: "1st June, 2026",
    owner_full_name: "Rajesh Kumar",
    owner_father_name: "Mohan Kumar",
    owner_age: 45,
    owner_phone: "+919876543210",
    owner_email: "rajesh@example.com",
    owner_permanent_address: "123 MG Road, Bengaluru",
    owner_pan_display: "ABCDE1234F",
    owner_aadhaar_last4: "1234",
    tenant_full_name: "Priya Sharma",
    tenant_father_name: "Vijay Sharma",
    tenant_age: 30,
    tenant_phone: "+919876543211",
    tenant_email: "priya@example.com",
    tenant_permanent_address: "456 Brigade Road, Bengaluru",
    tenant_pan_display: "XYZAB5678C",
    tenant_aadhaar_last4: "5678",
    tenant_company_name: "TechCorp Pvt Ltd",
    property_full_address: "789 Whitefield Main Road, Bengaluru, Karnataka 560066",
    property_type: "apartment",
    property_area_sqft: 1200,
    property_furnishing: "semi_furnished",
    property_purpose: "residential",
    property_parking: "covered",
    property_flat_number: "301",
    property_floor_number: 3,
    property_total_floors: 10,
    property_municipal_number: "WF-789",
    property_survey_number: "SY/123",
    tenure_months: 11,
    lock_in_months: 3,
    notice_period_months: 1,
    annual_increment_pct: 5,
    city: "Bengaluru",
    rent_formatted: "₹25,000.00",
    rent_in_words: "Twenty Five Thousand",
    deposit_formatted: "₹50,000.00",
    deposit_in_words: "Fifty Thousand",
    maintenance_included: true,
    maintenance_formatted: null,
    stamp_duty_formatted: "₹500.00",
    rent_due_day: 5,
    rent_due_day_suffix: "th",
    rent_payment_method: "bank_transfer",
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
    inventory_items: [
      { item: "Air Conditioner", quantity: 2, condition: "Good" },
      { item: "Refrigerator", quantity: 1, condition: "New" }
    ],
    has_inventory: true,
    additional_terms: ["No loud music after 10 PM.", "Tenant shall maintain the garden."],
    has_additional_terms: true,
    witness_1: {
      name: "Witness One",
      father_name: "Father One",
      address: "Addr 1",
      phone: "+919000000001"
    },
    witness_2: { name: "Witness Two", father_name: "Father Two", address: "Addr 2", phone: null },
    has_witnesses: true,
    owner_signature_data_uri: "data:image/png;base64,iVBORw0KGgo=",
    tenant_signature_data_uri: null,
    acknowledge_registration_required: false
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let hbs: typeof Handlebars;

beforeEach(() => {
  hbs = Handlebars.create();
  // Register partials
  for (const name of ["header", "footer", "witness-block", "signature-block", "watermark"]) {
    hbs.registerPartial(name, loadPartial(name));
  }
  // Register helpers
  hbs.registerHelper("add", (a: number, b: number) => a + b);
  hbs.registerHelper("safeDataUri", (uri: string) => {
    if (!uri || typeof uri !== "string") return "";
    if (!uri.startsWith("data:image/")) return "";
    return new Handlebars.SafeString(uri);
  });
});

describe("agreement.en.hbs template rendering", () => {
  it("renders without throwing for complete stub data", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const html = template(stubData());
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(500);
  });

  it("contains the agreement title", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const html = template(stubData());
    expect(html).toContain("Rent Agreement");
  });

  it("contains both parties' names", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const html = template(stubData());
    expect(html).toContain("Rajesh Kumar");
    expect(html).toContain("Priya Sharma");
  });

  it("contains the property address", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const html = template(stubData());
    expect(html).toContain("789 Whitefield Main Road");
  });

  it("contains formatted rent amount", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const html = template(stubData());
    expect(html).toContain("₹25,000.00");
    expect(html).toContain("Twenty Five Thousand");
  });

  it("contains deposit information", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const html = template(stubData());
    expect(html).toContain("₹50,000.00");
    expect(html).toContain("Fifty Thousand");
  });

  it("renders inventory table when has_inventory is true", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const html = template(stubData());
    expect(html).toContain("Air Conditioner");
    expect(html).toContain("Refrigerator");
  });

  it("omits inventory section when has_inventory is false", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const data = { ...stubData(), has_inventory: false, inventory_items: [] };
    const html = template(data);
    expect(html).not.toContain("Inventory of Fixtures");
  });

  it("renders additional terms when present", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const html = template(stubData());
    expect(html).toContain("No loud music after 10 PM.");
    expect(html).toContain("Tenant shall maintain the garden.");
  });

  it("renders witnesses section", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const html = template(stubData());
    expect(html).toContain("Witness One");
    expect(html).toContain("Witness Two");
  });

  it("renders owner signature image when data URI is provided", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const html = template(stubData());
    expect(html).toContain("data:image/png;base64,iVBORw0KGgo=");
  });

  it("renders blank signature line when no signature data URI", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const data = { ...stubData(), owner_signature_data_uri: null, tenant_signature_data_uri: null };
    const html = template(data);
    expect(html).toContain("___________________________");
  });

  it("contains stamp duty advisory", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const html = template(stubData());
    expect(html).toContain("Stamp Duty Advisory");
    expect(html).toContain("₹500.00");
  });

  it("contains legal disclaimer", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const html = template(stubData());
    expect(html).toContain("Cribliv");
    expect(html).toContain("does not provide legal advice");
  });

  it("renders lock-in period when set", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const html = template(stubData());
    expect(html).toContain("3 months");
    expect(html).toContain("Lock-in Period");
  });

  it("omits lock-in section when null", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const data = { ...stubData(), lock_in_months: null };
    const html = template(data);
    expect(html).not.toContain("Lock-in Period");
  });

  it("contains PAN display values when present", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const html = template(stubData());
    expect(html).toContain("ABCDE1234F");
    expect(html).toContain("XYZAB5678C");
  });

  it("auto-escapes HTML entities in user input", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const data = {
      ...stubData(),
      owner_full_name: "Rajesh <script>alert('xss')</script> Kumar",
      tenant_full_name: "Priya & Sons"
    };
    const html = template(data);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
  });

  it("does not use triple-stash anywhere in the template", () => {
    const source = loadMainTemplate("en");
    expect(source).not.toMatch(/\{\{\{[^!]/);
  });

  it("renders registration advisory when acknowledge_registration_required is true", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const data = { ...stubData(), acknowledge_registration_required: true };
    const html = template(data);
    expect(html).toContain("Registration Act, 1908");
  });

  it("renders maintenance included message when maintenance_included is true", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const html = template(stubData());
    expect(html).toContain("included in the monthly rent");
  });

  it("contains the watermark", () => {
    const source = loadMainTemplate("en");
    const template = hbs.compile(source);
    const html = template(stubData());
    expect(html).toContain("watermark");
    expect(html).toContain("Cribliv");
  });
});

describe("agreement.hi.hbs template", () => {
  it("exists as a stub marker file", () => {
    const source = loadMainTemplate("hi");
    expect(source).toContain("not yet implemented");
    expect(source).toContain('lang="hi"');
  });
});

describe("partials", () => {
  it("header partial contains agreement_id_short and state_code placeholders", () => {
    const source = loadPartial("header");
    expect(source).toContain("agreement_id_short");
    expect(source).toContain("state_code");
  });

  it("footer partial contains page number placeholders", () => {
    const source = loadPartial("footer");
    expect(source).toContain("pageNumber");
    expect(source).toContain("totalPages");
  });

  it("witness-block partial renders with test data", () => {
    const template = hbs.compile(loadPartial("witness-block"));
    const html = template({
      witness_number: "1",
      name: "Test Witness",
      father_name: "Father",
      address: "Addr"
    });
    expect(html).toContain("Test Witness");
    expect(html).toContain("Father");
  });

  it("signature-block partial renders image when data URI provided", () => {
    const template = hbs.compile(loadPartial("signature-block"));
    const html = template({
      party_label: "Owner",
      party_name: "Test",
      signature_data_uri: "data:image/png;base64,abc"
    });
    expect(html).toContain("data:image/png;base64,abc");
  });

  it("signature-block partial renders blank line when no data URI", () => {
    const template = hbs.compile(loadPartial("signature-block"));
    const html = template({ party_label: "Tenant", party_name: "Test", signature_data_uri: null });
    expect(html).toContain("___________________________");
  });
});
