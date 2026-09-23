import { describe, expect, it } from "vitest";

import { renderReceiptHtml } from "../receipt/receipt-renderer";
import type { ReceiptSnapshot } from "../services/rent-receipt.service";

const snapshot: ReceiptSnapshot = {
  receipt_number: "SUN-0042",
  issued_on: "2026-09-03",
  property_name: "Sunrise PG",
  business_name: "Sunrise Hostels",
  address: "12 MG Road, Pune",
  footer: "Thank you",
  logo_path: null,
  tenant_name: "Rahul Verma",
  room_number: "102",
  bed_label: "A",
  amount_inr: 9000,
  amount_words: "Nine Thousand Rupees Only",
  method: "upi",
  reference: "123456789012",
  paid_on: "2026-09-03",
  covers: [
    {
      invoice_number: "SUN-INV-0007",
      period_label: "September 2026",
      allocated_inr: 8000,
      remaining_inr: 0
    }
  ],
  credit_inr: 1000
};

describe("renderReceiptHtml", () => {
  it("renders every snapshot field with Indian grouping and no template syntax left", () => {
    const html = renderReceiptHtml(snapshot, "en", false);
    for (const s of [
      "SUN-0042",
      "Sunrise Hostels",
      "12 MG Road, Pune",
      "Rahul Verma",
      "Room 102",
      "Bed A",
      "₹9,000",
      "Nine Thousand Rupees Only",
      "UPI",
      "123456789012",
      "SUN-INV-0007",
      "September 2026",
      "₹8,000",
      "₹1,000",
      "Thank you",
      "computer-generated"
    ]) {
      expect(html, s).toContain(s);
    }
    expect(html).not.toMatch(/\{\{/);
    expect(html).not.toContain("VOID");
  });
  it("renders the VOID banner and the Hindi template", () => {
    expect(renderReceiptHtml(snapshot, "en", true)).toContain("VOID");
    expect(renderReceiptHtml(snapshot, "hi", false)).toContain("रसीद");
  });
  it("escapes HTML in owner-typed fields", () => {
    expect(
      renderReceiptHtml({ ...snapshot, footer: "<script>x</script>" }, "en", false)
    ).not.toContain("<script>");
  });
});
