import type { PgSegmentationPath } from "@cribliv/shared-types";

export interface SegmentationInput {
  totalBeds: number;
  propertyCount: number;
  hasExistingListings: boolean;
}

export interface SegmentationRule {
  predicate: (i: SegmentationInput) => boolean;
  path: PgSegmentationPath;
  reason: string;
  next_step: string;
}

/**
 * Rules evaluated top -> bottom. First match wins.
 * Last rule is a catch-all (predicate always true).
 */
export const SEGMENTATION_RULES: SegmentationRule[] = [
  {
    predicate: (i) => i.hasExistingListings,
    path: "self_serve",
    reason: "existing_listings_fast_path",
    next_step: "/pg-operator/listings/new"
  },
  {
    predicate: (i) => i.totalBeds <= 29,
    path: "self_serve",
    reason: "small_pg_self_serve",
    next_step: "/pg-operator/listings/new"
  },
  {
    predicate: () => true,
    path: "sales_assist",
    reason: "large_pg_sales_assist",
    next_step: "/sales/lead-form"
  }
];
