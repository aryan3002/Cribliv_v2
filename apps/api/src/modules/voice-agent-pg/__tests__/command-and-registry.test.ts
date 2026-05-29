import { describe, it, expect } from "vitest";
import { commitFieldTool } from "../tools/commit-field.tool";
import { summarizeForConfirmTool } from "../tools/summarize-for-confirm.tool";
import { requestPhotoUploadTool } from "../tools/request-photo-upload.tool";
import { PG_TOOLS, getToolByName, toolNames } from "../tools/pg-realtime-tools";

const ctx = { sessionId: "s1", phase: "confirmation" as const, locale: "en" as const };

describe("command tools", () => {
  describe("commit_field", () => {
    it("accepts {path, value} and echoes them", () => {
      const r = commitFieldTool.handler({ path: "pg_details.curfew_time", value: "23:00" }, ctx);
      expect(r.ok).toBe(true);
      expect(r.extracted[0].field).toBe("pg_details.curfew_time");
      expect(r.extracted[0].value).toBe("23:00");
      expect(r.extracted[0].confidence).toBe(1.0);
    });
    it("rejects missing path", () => {
      const r = commitFieldTool.handler({ value: "x" }, ctx);
      expect(r.ok).toBe(false);
    });
  });

  describe("summarize_for_confirm", () => {
    it("returns ok=true with empty extracted (signal-only)", () => {
      const r = summarizeForConfirmTool.handler({}, ctx);
      expect(r.ok).toBe(true);
      expect(r.extracted).toEqual([]);
    });
  });

  describe("request_photo_upload", () => {
    it("returns ok=true with empty extracted (signal-only)", () => {
      const r = requestPhotoUploadTool.handler({}, ctx);
      expect(r.ok).toBe(true);
      expect(r.extracted).toEqual([]);
    });
  });
});

describe("pg-realtime-tools registry", () => {
  it("contains all 10 tools", () => {
    expect(toolNames().sort()).toEqual(
      [
        "commit_field",
        "extract_amenities",
        "extract_food",
        "extract_house_rules",
        "extract_payment_terms",
        "extract_pricing_matrix",
        "extract_property_basics",
        "extract_room_config",
        "request_photo_upload",
        "summarize_for_confirm"
      ].sort()
    );
  });

  it("resolves a tool by name", () => {
    expect(getToolByName("extract_pricing_matrix")?.name).toBe("extract_pricing_matrix");
  });

  it("returns undefined for an unknown tool", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(getToolByName("extract_quantum" as any)).toBeUndefined();
  });

  it("every tool has a non-empty description and handler", () => {
    for (const t of PG_TOOLS) {
      expect(t.description.length).toBeGreaterThan(0);
      expect(typeof t.handler).toBe("function");
    }
  });
});
