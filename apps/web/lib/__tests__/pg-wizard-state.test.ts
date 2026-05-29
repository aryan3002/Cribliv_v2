import { describe, it, expect } from "vitest";
import { pgWizardReducer, initialPgWizardState, buildSubmitPayload } from "../pg-wizard-state";

describe("pgWizardReducer", () => {
  it("SET_FIELD updates a leaf via path", () => {
    const s = pgWizardReducer(initialPgWizardState(), {
      type: "SET_FIELD",
      path: "property.display_name",
      value: "Acme PG"
    });
    expect(s.draft.property?.display_name).toBe("Acme PG");
  });

  it("SET_UI_FIELD writes only to ui slice, never to draft", () => {
    const s = pgWizardReducer(initialPgWizardState(), {
      type: "SET_UI_FIELD",
      path: "sharing_options",
      value: ["single", "double"]
    });
    expect(s.ui.sharing_options).toEqual(["single", "double"]);
    expect((s.draft as any).room_config).toBeUndefined();
    expect((s.draft as any).sharing_options).toBeUndefined();
  });

  it("UPSERT_ROOM_TYPE replaces matching cell key", () => {
    const s1 = pgWizardReducer(initialPgWizardState(), {
      type: "UPSERT_ROOM_TYPE",
      row: {
        sharing: "double",
        ac: true,
        monthly_rent_paise: 800000,
        vacancy_count: 4
      }
    });
    const s2 = pgWizardReducer(s1, {
      type: "UPSERT_ROOM_TYPE",
      row: {
        sharing: "double",
        ac: true,
        monthly_rent_paise: 900000,
        vacancy_count: 5
      }
    });
    expect(s2.draft.room_types).toHaveLength(1);
    expect(s2.draft.room_types![0].monthly_rent_paise).toBe(900000);
  });

  it("UPSERT_ROOM_TYPE with different bathroom_kind doesn't overwrite", () => {
    const s1 = pgWizardReducer(initialPgWizardState(), {
      type: "UPSERT_ROOM_TYPE",
      row: {
        sharing: "double",
        ac: true,
        bathroom_kind: "attached_western",
        monthly_rent_paise: 800000,
        vacancy_count: 4
      }
    });
    const s2 = pgWizardReducer(s1, {
      type: "UPSERT_ROOM_TYPE",
      row: {
        sharing: "double",
        ac: true,
        bathroom_kind: "shared_western",
        monthly_rent_paise: 700000,
        vacancy_count: 6
      }
    });
    expect(s2.draft.room_types).toHaveLength(2);
  });

  it("REMOVE_ROOM_TYPE by cell key removes the matching row", () => {
    const s1 = pgWizardReducer(initialPgWizardState(), {
      type: "UPSERT_ROOM_TYPE",
      row: {
        sharing: "double",
        ac: true,
        monthly_rent_paise: 800000,
        vacancy_count: 4
      }
    });
    const s2 = pgWizardReducer(s1, {
      type: "UPSERT_ROOM_TYPE",
      row: {
        sharing: "single",
        ac: false,
        monthly_rent_paise: 600000,
        vacancy_count: 2
      }
    });
    // cellKey: sharing|ac|bathroom_kind|furnishing — defaults attached_western|semi_furnished
    const key = "double|true|attached_western|semi_furnished";
    const s3 = pgWizardReducer(s2, { type: "REMOVE_ROOM_TYPE", key });
    expect(s3.draft.room_types).toHaveLength(1);
    expect(s3.draft.room_types![0].sharing).toBe("single");
  });

  it("VOICE_EXTRACTED applies and pushes undo entry", () => {
    const s = pgWizardReducer(initialPgWizardState(), {
      type: "VOICE_EXTRACTED",
      field: "pg_details.gender_policy",
      value: "coed",
      confidence: 0.92
    });
    expect(s.draft.pg_details?.gender_policy).toBe("coed");
    expect(s.undoStack).toHaveLength(1);
  });

  it("UNDO_LAST restores previous value", () => {
    const s1 = pgWizardReducer(initialPgWizardState(), {
      type: "SET_FIELD",
      path: "pg_details.gender_policy",
      value: "boys"
    });
    const s2 = pgWizardReducer(s1, {
      type: "VOICE_EXTRACTED",
      field: "pg_details.gender_policy",
      value: "coed",
      confidence: 0.9
    });
    const s3 = pgWizardReducer(s2, { type: "UNDO_LAST" });
    expect(s3.draft.pg_details?.gender_policy).toBe("boys");
  });

  it("UNDO_LAST on empty undoStack is a no-op", () => {
    const init = initialPgWizardState();
    const s = pgWizardReducer(init, { type: "UNDO_LAST" });
    // Returns either the same state or an equivalent one; must not throw and must keep stack empty.
    expect(s.undoStack).toHaveLength(0);
    expect(s.draft).toEqual(init.draft);
  });

  it("GOTO_STEP clamps to [1,6]", () => {
    expect(
      pgWizardReducer(initialPgWizardState(), { type: "GOTO_STEP", step: 9 }).currentStep
    ).toBe(6);
    expect(
      pgWizardReducer(initialPgWizardState(), { type: "GOTO_STEP", step: 0 }).currentStep
    ).toBe(1);
  });

  it("MERGE_DRAFT deep-merges (voice draft hydration)", () => {
    const s = pgWizardReducer(initialPgWizardState(), {
      type: "MERGE_DRAFT",
      partial: { pg_details: { total_beds: 12 } } as any
    });
    expect(s.draft.pg_details?.total_beds).toBe(12);
  });

  it("MERGE_DRAFT doesn't clobber existing fields", () => {
    const s1 = pgWizardReducer(initialPgWizardState(), {
      type: "SET_FIELD",
      path: "pg_details.total_beds",
      value: 10
    });
    const s2 = pgWizardReducer(s1, {
      type: "MERGE_DRAFT",
      partial: { pg_details: { gender_policy: "boys" } } as any
    });
    expect(s2.draft.pg_details?.total_beds).toBe(10);
    expect(s2.draft.pg_details?.gender_policy).toBe("boys");
  });

  it("SUBMIT_BEGIN assigns idempotencyKey if absent, preserves if present", () => {
    const s1 = pgWizardReducer(initialPgWizardState(), { type: "SUBMIT_BEGIN" });
    expect(s1.idempotencyKey).toBeTruthy();
    expect(s1.submitting).toBe(true);
    const s2 = pgWizardReducer(s1, { type: "SUBMIT_BEGIN" });
    expect(s2.idempotencyKey).toBe(s1.idempotencyKey);
  });
});

describe("buildSubmitPayload", () => {
  it("strips ui-only fields (no room_config / sharing_options on the payload)", () => {
    const s = {
      ...initialPgWizardState(),
      ui: { sharing_options: ["single", "double"] },
      draft: {
        property: { display_name: "Acme", city_slug: "blr" } as any,
        pg_details: { total_beds: 10 } as any,
        room_types: [
          {
            sharing: "double",
            ac: true,
            monthly_rent_paise: 800000,
            vacancy_count: 4
          }
        ] as any
      }
    };
    const out = buildSubmitPayload(s as any);
    expect((out as any).room_config).toBeUndefined();
    expect((out as any).sharing_options).toBeUndefined();
    expect(out.property.display_name).toBe("Acme");
  });

  it("hoists meal_charges_paise from meals to pg_details level", () => {
    const s = {
      ...initialPgWizardState(),
      draft: {
        property: { display_name: "X", city_slug: "blr" } as any,
        pg_details: {
          total_beds: 5,
          meals: { provided: true, meal_charges_paise: 250000 }
        } as any,
        room_types: [
          {
            sharing: "single",
            ac: false,
            monthly_rent_paise: 800000,
            vacancy_count: 2
          }
        ] as any
      }
    };
    const out = buildSubmitPayload(s as any);
    expect(out.pg_details.meal_charges_paise).toBe(250000);
    expect((out.pg_details.meals as any).meal_charges_paise).toBeUndefined();
  });

  it("drops room_types entries with rent out of [200000, 5000000]", () => {
    const s = {
      ...initialPgWizardState(),
      draft: {
        property: { display_name: "X", city_slug: "blr" } as any,
        pg_details: { total_beds: 5 } as any,
        room_types: [
          {
            sharing: "single",
            ac: false,
            monthly_rent_paise: 100000,
            vacancy_count: 1
          }, // too low
          {
            sharing: "double",
            ac: true,
            monthly_rent_paise: 850000,
            vacancy_count: 4
          }, // ok
          {
            sharing: "triple",
            ac: false,
            monthly_rent_paise: 6_000_000,
            vacancy_count: 3
          } // too high
        ] as any
      }
    };
    const out = buildSubmitPayload(s as any);
    expect(out.room_types).toHaveLength(1);
    expect(out.room_types![0].sharing).toBe("double");
  });

  it("empty draft produces empty property strings without throwing", () => {
    const out = buildSubmitPayload(initialPgWizardState());
    expect(out.property.display_name).toBe("");
    expect(out.property.city_slug).toBe("");
    expect(out.room_types).toEqual([]);
    // pg_details.total_beds may be undefined; the shape must exist
    expect(out.pg_details).toBeDefined();
  });

  it("unknown pg_details keys (stray foo) are dropped", () => {
    const s = {
      ...initialPgWizardState(),
      draft: {
        property: { display_name: "X", city_slug: "blr" } as any,
        pg_details: { total_beds: 5, foo: 1, bar: "baz" } as any,
        room_types: [] as any
      }
    };
    const out = buildSubmitPayload(s as any);
    expect((out.pg_details as any).foo).toBeUndefined();
    expect((out.pg_details as any).bar).toBeUndefined();
    expect(out.pg_details.total_beds).toBe(5);
  });

  it("meal_charges_paise already on pg_details takes precedence over meals duplicate", () => {
    const s = {
      ...initialPgWizardState(),
      draft: {
        property: { display_name: "X", city_slug: "blr" } as any,
        pg_details: {
          total_beds: 5,
          meal_charges_paise: 300000,
          meals: { provided: true, meal_charges_paise: 100000 }
        } as any,
        room_types: [] as any
      }
    };
    const out = buildSubmitPayload(s as any);
    expect(out.pg_details.meal_charges_paise).toBe(300000);
    expect((out.pg_details.meals as any)?.meal_charges_paise).toBeUndefined();
  });

  it("empty meals object after hoist is removed entirely", () => {
    const s = {
      ...initialPgWizardState(),
      draft: {
        property: { display_name: "X", city_slug: "blr" } as any,
        pg_details: {
          total_beds: 5,
          meals: { meal_charges_paise: 1000 }
        } as any,
        room_types: [] as any
      }
    };
    const out = buildSubmitPayload(s as any);
    expect(out.pg_details.meal_charges_paise).toBe(1000);
    expect((out.pg_details as any).meals).toBeUndefined();
  });

  it("nested house_rules.smoking=true survives the strict-key filter", () => {
    const s = {
      ...initialPgWizardState(),
      draft: {
        property: { display_name: "X", city_slug: "blr" } as any,
        pg_details: {
          total_beds: 5,
          house_rules: { smoking: true, alcohol: false } as any
        } as any,
        room_types: [] as any
      }
    };
    const out = buildSubmitPayload(s as any);
    expect((out.pg_details as any).house_rules?.smoking).toBe(true);
    expect((out.pg_details as any).house_rules?.alcohol).toBe(false);
  });
});
