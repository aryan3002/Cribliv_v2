"use client";
import { Dispatch } from "react";
import { PgWizardState, PgWizardAction } from "@/lib/pg-wizard-state";
import AmenityGrid from "../shared/AmenityGrid";
import MealsToggle from "../shared/MealsToggle";

const CORE = ["wifi", "hot_water", "power_backup", "cctv", "security_guard"] as const;
const ROOM = ["ac", "tv", "study_table", "wardrobe", "safety_locker", "mattress"] as const;
const SERVICES = ["housekeeping", "laundry", "biometric_access"] as const;
const EXTRAS = ["parking_2w", "parking_4w", "fridge", "microwave", "gym", "indoor_games"] as const;

export default function PgAmenitiesFoodStep({
  state,
  dispatch
}: {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  locale: string;
}) {
  const d = state.draft.pg_details ?? ({} as any);
  const setF = (path: string, value: unknown) => dispatch({ type: "SET_FIELD", path, value });
  const a = d.amenities ?? {};
  return (
    <section className="pg-step pg-step--amenities-food">
      <h2>Amenities &amp; Food</h2>
      <AmenityGrid
        title="Core"
        options={CORE}
        value={a.core ?? []}
        onChange={(v) => setF("pg_details.amenities.core", v)}
      />
      <AmenityGrid
        title="Room"
        options={ROOM}
        value={a.room ?? []}
        onChange={(v) => setF("pg_details.amenities.room", v)}
      />
      <AmenityGrid
        title="Services"
        options={SERVICES}
        value={a.services ?? []}
        onChange={(v) => setF("pg_details.amenities.services", v)}
      />
      <AmenityGrid
        title="Extras"
        options={EXTRAS}
        value={a.extras ?? []}
        onChange={(v) => setF("pg_details.amenities.extras", v)}
      />
      <MealsToggle value={d.meals} onChange={(v) => setF("pg_details.meals", v)} />
      <button type="button" onClick={() => dispatch({ type: "GOTO_STEP", step: 4 })}>
        Back
      </button>
      <button type="button" onClick={() => dispatch({ type: "GOTO_STEP", step: 6 })}>
        Next
      </button>
    </section>
  );
}
