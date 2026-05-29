import { describe, it, expect } from "vitest";
import { PgSegmentationService } from "../services/pg-segmentation.service";

describe("PgSegmentationService", () => {
  const svc = new PgSegmentationService();

  describe("segment()", () => {
    it("routes 10 beds, 1 property, no existing listings -> self_serve", () => {
      const r = svc.segment({ totalBeds: 10, propertyCount: 1, hasExistingListings: false });
      expect(r.path).toBe("self_serve");
      expect(r.next_step).toBe("/pg-operator/listings/new");
    });

    it("routes 29 beds (boundary) -> self_serve", () => {
      const r = svc.segment({ totalBeds: 29, propertyCount: 1, hasExistingListings: false });
      expect(r.path).toBe("self_serve");
    });

    it("routes 30 beds (boundary) -> sales_assist", () => {
      const r = svc.segment({ totalBeds: 30, propertyCount: 1, hasExistingListings: false });
      expect(r.path).toBe("sales_assist");
      expect(r.next_step).toBe("/sales/lead-form");
    });

    it("routes 50 beds -> sales_assist regardless of property count", () => {
      const r = svc.segment({ totalBeds: 50, propertyCount: 1, hasExistingListings: false });
      expect(r.path).toBe("sales_assist");
    });

    it("routes operator with existing approved listings -> self_serve fast-path", () => {
      const r = svc.segment({ totalBeds: 100, propertyCount: 1, hasExistingListings: true });
      expect(r.path).toBe("self_serve");
      expect(r.reason).toMatch(/existing/i);
    });

    it("throws InvalidBedCount when totalBeds <= 0", () => {
      expect(() =>
        svc.segment({ totalBeds: 0, propertyCount: 1, hasExistingListings: false })
      ).toThrow(/invalid_bed_count|InvalidBedCount/i);
    });

    it("throws InvalidBedCount when totalBeds is not a finite number", () => {
      expect(() =>
        svc.segment({ totalBeds: NaN, propertyCount: 1, hasExistingListings: false })
      ).toThrow(/invalid_bed_count|InvalidBedCount/i);
    });
  });
});
