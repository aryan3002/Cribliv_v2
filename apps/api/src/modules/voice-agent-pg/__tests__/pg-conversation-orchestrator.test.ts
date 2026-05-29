import { describe, it, expect } from "vitest";
import {
  PgConversationOrchestrator,
  PHASE_REQUIREMENTS
} from "../services/pg-conversation-orchestrator.service";

describe("PgConversationOrchestrator", () => {
  describe("PHASE_REQUIREMENTS", () => {
    it("declares required fields for discovery/pricing/food/rules", () => {
      expect(PHASE_REQUIREMENTS.discovery.length).toBeGreaterThan(0);
      expect(PHASE_REQUIREMENTS.pricing.length).toBeGreaterThan(0);
      expect(PHASE_REQUIREMENTS.food.length).toBeGreaterThan(0);
      expect(PHASE_REQUIREMENTS.rules.length).toBeGreaterThan(0);
    });
    it("greeting/media/confirmation/done have no requirements (orchestrator-driven)", () => {
      expect(PHASE_REQUIREMENTS.greeting).toEqual([]);
      expect(PHASE_REQUIREMENTS.media).toEqual([]);
      expect(PHASE_REQUIREMENTS.confirmation).toEqual([]);
      expect(PHASE_REQUIREMENTS.done).toEqual([]);
    });
  });

  describe("computeNextPhase()", () => {
    const orch = new PgConversationOrchestrator();

    it("greeting always advances on first call to discovery", () => {
      expect(orch.computeNextPhase("greeting", {})).toBe("discovery");
    });

    it("stays in discovery when required discovery fields missing", () => {
      const next = orch.computeNextPhase("discovery", { property: { display_name: "A" } });
      expect(next).toBe("discovery");
    });

    it("advances discovery → pricing when discovery requirements met", () => {
      const draft = {
        property: { display_name: "A" },
        pg_details: { total_beds: 24 },
        room_types: []
      };
      expect(orch.computeNextPhase("discovery", draft)).toBe("pricing");
    });

    it("advances pricing → food when at least one room_types cell exists", () => {
      const draft = {
        property: { display_name: "A" },
        pg_details: { total_beds: 24 },
        room_types: [
          { sharing: "double", ac: true, monthly_rent_paise: 1_200_000, vacancy_count: 4 }
        ]
      };
      expect(orch.computeNextPhase("pricing", draft)).toBe("food");
    });

    it("advances food → rules when pg_details.meals is set", () => {
      const draft = { pg_details: { meals: { provided: false } }, room_types: [{}] };
      expect(orch.computeNextPhase("food", draft as any)).toBe("rules");
    });

    it("advances rules → media when house_rules set", () => {
      const draft = {
        pg_details: { house_rules: { smoking: false, alcohol: false } },
        room_types: [{}]
      };
      expect(orch.computeNextPhase("rules", draft as any)).toBe("media");
    });

    it("force=true advances to done from any phase", () => {
      expect(orch.computeNextPhase("confirmation", {}, { force: true })).toBe("done");
      expect(orch.computeNextPhase("discovery", {}, { force: true })).toBe("done");
    });

    it("media advances to confirmation without explicit requirements (orchestrator-driven)", () => {
      expect(orch.computeNextPhase("media", {})).toBe("confirmation");
    });
  });
});
