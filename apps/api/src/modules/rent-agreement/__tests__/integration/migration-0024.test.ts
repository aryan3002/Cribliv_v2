import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION_PATH = resolve(
  __dirname,
  "../../../../../../../infra/migrations/0024_rent_agreement_v2.sql"
);

function readMigration(): string {
  return readFileSync(MIGRATION_PATH, "utf8");
}

describe("migration 0024_rent_agreement_v2.sql — structural contract", () => {
  const sql = readMigration();
  const lowered = sql.toLowerCase();

  describe("tables", () => {
    const tables = [
      "rent_agreement_plans",
      "stamp_duty_rules",
      "rent_agreements",
      "rent_agreement_step_audit",
      "rent_agreement_signatures",
      "rent_agreement_pdf_jobs",
      "rent_agreement_downloads",
      "rent_agreement_event_log"
    ];

    for (const tbl of tables) {
      it(`creates table ${tbl}`, () => {
        const re = new RegExp(`create\\s+table[\\s\\S]*?${tbl}\\b`, "i");
        expect(re.test(sql)).toBe(true);
      });
    }
  });

  describe("e-stamping / aadhaar eSign columns (folded in)", () => {
    it("declares e_stamp_reference text column on rent_agreements", () => {
      expect(/e_stamp_reference\s+text/i.test(sql)).toBe(true);
    });
    it("declares e_sign_session_id text column on rent_agreements", () => {
      expect(/e_sign_session_id\s+text/i.test(sql)).toBe(true);
    });
    it("declares e_sign_completed_at timestamptz column on rent_agreements", () => {
      expect(/e_sign_completed_at\s+timestamptz/i.test(sql)).toBe(true);
    });
  });

  describe("PAN ciphertext columns", () => {
    it("declares owner_pan_ct bytea", () => {
      expect(/owner_pan_ct\s+bytea/i.test(sql)).toBe(true);
    });
    it("declares tenant_pan_ct bytea", () => {
      expect(/tenant_pan_ct\s+bytea/i.test(sql)).toBe(true);
    });
  });

  describe("wizard state machine columns", () => {
    it("declares current_step int with CHECK BETWEEN 1 AND 7", () => {
      expect(/current_step\s+int[\s\S]*?between\s+1\s+and\s+7/i.test(sql)).toBe(true);
    });
    it("declares step_validated_at jsonb default", () => {
      expect(/step_validated_at\s+jsonb/i.test(sql)).toBe(true);
    });
    it("declares status text with draft/pending_payment/paid/... enum", () => {
      const required = [
        "'draft'",
        "'pending_payment'",
        "'paid'",
        "'generating_pdf'",
        "'generated'",
        "'expired'",
        "'refunded'"
      ];
      for (const value of required) {
        expect(sql.includes(value)).toBe(true);
      }
    });
  });

  describe("check constraints", () => {
    const checks: Array<[string, RegExp]> = [
      ["tenure_months 1..132", /tenure_months\s+between\s+1\s+and\s+132/i],
      [
        "lock_in_months ≤ tenure_months",
        /lock_in_months\s*<=\s*tenure_months|lock_in_months\s+between\s+0\s+and\s+tenure_months/i
      ],
      ["notice_period_months 1..6", /notice_period_months\s+between\s+1\s+and\s+6/i],
      ["rent_amount_paise > 0", /rent_amount_paise\s*>\s*0/i],
      ["annual_increment_pct 0..100", /annual_increment_pct\s+between\s+0\s+and\s+100/i],
      ["owner_age 18..120", /owner_age\s+between\s+18\s+and\s+120/i],
      ["tenant_age 18..120", /tenant_age\s+between\s+18\s+and\s+120/i],
      ["locale en|hi", /locale\s+in\s*\(\s*'en'\s*,\s*'hi'\s*\)/i],
      ["amount_paise >= 0 on plans", /amount_paise\s*>=\s*0/i]
    ];

    for (const [name, re] of checks) {
      it(`enforces ${name}`, () => {
        expect(re.test(sql)).toBe(true);
      });
    }
  });

  describe("indexes", () => {
    const indexes: Array<[string, RegExp]> = [
      [
        "UNIQUE (user_id, idempotency_key) on rent_agreements",
        /create\s+unique\s+index[\s\S]*?rent_agreements\s*\([\s\S]*?user_id[\s\S]*?idempotency_key/i
      ],
      [
        "(user_id, status) on rent_agreements",
        /create\s+index[\s\S]*?rent_agreements\s*\([\s\S]*?user_id[\s\S]*?status/i
      ],
      [
        "(state_code, created_at DESC) on rent_agreements",
        /create\s+index[\s\S]*?rent_agreements\s*\([\s\S]*?state_code[\s\S]*?created_at\s+desc/i
      ],
      [
        "(payment_order_id) WHERE NOT NULL on rent_agreements",
        /create\s+index[\s\S]*?rent_agreements\s*\(payment_order_id\)\s+where\s+payment_order_id\s+is\s+not\s+null/i
      ],
      [
        "(agreement_id, step, created_at) on rent_agreement_step_audit",
        /create\s+index[\s\S]*?rent_agreement_step_audit\s*\([\s\S]*?agreement_id[\s\S]*?step[\s\S]*?created_at/i
      ],
      [
        "(status, locked_until) WHERE pending/failed on rent_agreement_pdf_jobs",
        /create\s+index[\s\S]*?rent_agreement_pdf_jobs[\s\S]*?status[\s\S]*?locked_until[\s\S]*?where[\s\S]*?'pending'[\s\S]*?'failed'/i
      ],
      [
        "(created_at) WHERE posthog_sent_at IS NULL on rent_agreement_event_log",
        /create\s+index[\s\S]*?rent_agreement_event_log[\s\S]*?created_at[\s\S]*?where\s+posthog_sent_at\s+is\s+null/i
      ],
      [
        "(agreement_id, created_at DESC) on rent_agreement_downloads",
        /create\s+index[\s\S]*?rent_agreement_downloads\s*\([\s\S]*?agreement_id[\s\S]*?created_at\s+desc/i
      ],
      [
        "UNIQUE (state_code) WHERE active on stamp_duty_rules",
        /create\s+unique\s+index[\s\S]*?stamp_duty_rules\s*\(state_code\)\s+where\s+effective_until\s+is\s+null/i
      ]
    ];

    for (const [name, re] of indexes) {
      it(`creates index: ${name}`, () => {
        expect(re.test(sql)).toBe(true);
      });
    }
  });

  describe("updated_at triggers", () => {
    const tables = ["rent_agreement_plans", "rent_agreements", "stamp_duty_rules"];
    for (const tbl of tables) {
      it(`wires trigger_set_updated_at on ${tbl}`, () => {
        const re = new RegExp(
          `create\\s+trigger[\\s\\S]*?on\\s+${tbl}[\\s\\S]*?trigger_set_updated_at`,
          "i"
        );
        expect(re.test(sql)).toBe(true);
      });
    }
  });

  describe("seeds", () => {
    it("seeds three plans: basic, standard, premium", () => {
      expect(sql.includes("'basic'")).toBe(true);
      expect(sql.includes("'standard'")).toBe(true);
      expect(sql.includes("'premium'")).toBe(true);
      expect(sql.includes("9900")).toBe(true);
      expect(sql.includes("19900")).toBe(true);
      expect(sql.includes("49900")).toBe(true);
    });

    it("seeds eight stamp duty states: MH, KA, DL, UP, TN, RJ, GJ, HR", () => {
      for (const code of ["MH", "KA", "DL", "UP", "TN", "RJ", "GJ", "HR"]) {
        expect(sql).toContain(`'${code}'`);
      }
    });

    it("references three formula types", () => {
      expect(sql.includes("'percentage_of_annual_rent'")).toBe(true);
      expect(sql.includes("'percentage_of_total_rent'")).toBe(true);
      expect(sql.includes("'percentage_of_rent_plus_deposit'")).toBe(true);
    });
  });

  describe("safety", () => {
    it("is wrapped in BEGIN/COMMIT (transactional)", () => {
      // Strip line and block comments so the assertion checks SQL ordering
      // rather than file ordering.
      const stripped = sql.replace(/--[^\n]*\n/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "");
      const firstStatement = stripped.match(
        /\b(begin|commit|create|alter|insert|update|delete|drop)\b/i
      );
      expect(firstStatement?.[1]?.toLowerCase()).toBe("begin");
      const lastStatement = [
        ...stripped.matchAll(/\b(begin|commit|create|alter|insert|update|delete|drop)\b/gi)
      ].at(-1);
      expect(lastStatement?.[1]?.toLowerCase()).toBe("commit");
    });

    it("uses ON CONFLICT DO NOTHING on every seed INSERT", () => {
      const inserts = sql.match(/insert\s+into[\s\S]*?;/gi) ?? [];
      expect(inserts.length).toBeGreaterThan(0);
      for (const stmt of inserts) {
        expect(/on\s+conflict[\s\S]*?do\s+nothing/i.test(stmt)).toBe(true);
      }
    });
  });

  it("does not import or accidentally duplicate v1 migration content", () => {
    // Safety net: spec says baseline has no rent-agreement v1; this migration
    // should not contain compatibility shims for tables that never existed here.
    expect(/drop\s+table[\s\S]*?rent_agreements/i.test(sql)).toBe(false);
  });

  it("does not log plaintext PAN columns", () => {
    expect(/owner_pan\s+text|tenant_pan\s+text/i.test(sql)).toBe(false);
  });
});
