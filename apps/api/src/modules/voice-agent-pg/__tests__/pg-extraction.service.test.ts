import { describe, it, expect, vi } from "vitest";
import { PgExtractionService } from "../services/pg-extraction.service";
import { AppStateService } from "../../../common/app-state.service";

function makeDeps() {
  const db = { isEnabled: () => false, query: vi.fn() } as any;
  const state = new AppStateService();
  return { db, state };
}

describe("PgExtractionService", () => {
  it("creates a draft on first commit and returns its id", async () => {
    const { db, state } = makeDeps();
    const svc = new PgExtractionService(db, state);
    const draftId = await svc.commitExtraction({
      operatorUserId: "op-1",
      pgPropertyId: "prop-1",
      toolName: "extract_property_basics",
      extracted: [{ field: "property.display_name", value: "Hostel A", confidence: 0.9 }]
    });
    expect(draftId).toBeTruthy();
    const draft = state.getPgListingDraft(draftId) as any;
    expect(draft.payload.property.display_name).toBe("Hostel A");
    expect(draft.source).toBe("voice");
    expect(draft.field_confidence["property.display_name"]).toBe(0.9);
  });

  it("upserts onto the same draft when draftId is passed", async () => {
    const { db, state } = makeDeps();
    const svc = new PgExtractionService(db, state);
    const id = await svc.commitExtraction({
      operatorUserId: "op-1",
      pgPropertyId: "prop-1",
      toolName: "extract_property_basics",
      extracted: [{ field: "property.display_name", value: "A", confidence: 0.9 }]
    });
    const id2 = await svc.commitExtraction({
      operatorUserId: "op-1",
      pgPropertyId: "prop-1",
      draftId: id,
      toolName: "extract_room_config",
      extracted: [{ field: "pg_details.total_beds", value: 24, confidence: 0.9 }]
    });
    expect(id2).toBe(id);
    const draft = state.getPgListingDraft(id) as any;
    expect(draft.payload.property.display_name).toBe("A");
    expect(draft.payload.pg_details.total_beds).toBe(24);
  });

  it("appends to room_types array on the special 'room_types.cell' field", async () => {
    const { db, state } = makeDeps();
    const svc = new PgExtractionService(db, state);
    const id = await svc.commitExtraction({
      operatorUserId: "op-1",
      pgPropertyId: "prop-1",
      toolName: "extract_pricing_matrix",
      extracted: [
        {
          field: "room_types.cell",
          value: { sharing: "double", ac: true, monthly_rent_paise: 1_200_000, vacancy_count: 4 },
          confidence: 0.9
        }
      ]
    });
    await svc.commitExtraction({
      operatorUserId: "op-1",
      pgPropertyId: "prop-1",
      draftId: id,
      toolName: "extract_pricing_matrix",
      extracted: [
        {
          field: "room_types.cell",
          value: { sharing: "single", ac: false, monthly_rent_paise: 900_000, vacancy_count: 2 },
          confidence: 0.9
        }
      ]
    });
    const draft = state.getPgListingDraft(id) as any;
    expect(draft.payload.room_types.length).toBe(2);
    expect(draft.payload.room_types[0].sharing).toBe("double");
    expect(draft.payload.room_types[1].sharing).toBe("single");
  });
});
