import type { BlogPostType } from "./blog.types";

export interface EvergreenSeed {
  target_keyword: string;
  intent: string;
  category_slug: string;
  post_type: BlogPostType;
  outline: Array<{ heading: string }>;
}

export const EVERGREEN_SEEDS: EvergreenSeed[] = [
  {
    target_keyword: "rent agreement format in india",
    intent: "informational",
    category_slug: "tenancy",
    post_type: "evergreen",
    outline: [
      { heading: "What a rent agreement must include" },
      { heading: "Registration and stamp duty" },
      { heading: "Common clauses explained" }
    ]
  },
  {
    target_keyword: "security deposit rules for tenants",
    intent: "informational",
    category_slug: "tenancy",
    post_type: "evergreen",
    outline: [
      { heading: "How much deposit is normal" },
      { heading: "Getting your deposit back" },
      { heading: "State rules" }
    ]
  },
  {
    target_keyword: "hra exemption and rent receipts",
    intent: "informational",
    category_slug: "tenancy",
    post_type: "evergreen",
    outline: [
      { heading: "How HRA exemption works" },
      { heading: "Rent receipts you need" },
      { heading: "Landlord PAN rule" }
    ]
  },
  {
    target_keyword: "tenant rights in india",
    intent: "informational",
    category_slug: "tenancy",
    post_type: "evergreen",
    outline: [
      { heading: "Your core rights" },
      { heading: "Eviction protections" },
      { heading: "Model Tenancy Act" }
    ]
  },
  {
    target_keyword: "house moving checklist",
    intent: "informational",
    category_slug: "tenancy",
    post_type: "evergreen",
    outline: [
      { heading: "Before the move" },
      { heading: "Moving day" },
      { heading: "After moving in" }
    ]
  },
  {
    target_keyword: "pg vs flat which is better",
    intent: "commercial_investigation",
    category_slug: "tenancy",
    post_type: "evergreen",
    outline: [
      { heading: "Cost comparison" },
      { heading: "Who a PG suits" },
      { heading: "Who a flat suits" }
    ]
  }
];
