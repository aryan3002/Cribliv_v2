"use client";
import { Dispatch } from "react";
import { Sparkles, ChevronLeft, ChevronRight } from "lucide-react";
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
    <section>
      <div className="pgo-section-header" style={{ marginBottom: 24 }}>
        <div className="pgo-section-header__icon">
          <Sparkles size={20} />
        </div>
        <div className="pgo-section-header__text">
          <span className="pgo-overline">Facilities</span>
          <span className="pgo-heading pgo-heading--xs">What your PG offers</span>
        </div>
      </div>

      <AmenityGrid
        title="Core Amenities"
        options={CORE}
        value={a.core ?? []}
        onChange={(v) => setF("pg_details.amenities.core", v)}
      />
      <AmenityGrid
        title="In-Room Amenities"
        options={ROOM}
        value={a.room ?? []}
        onChange={(v) => setF("pg_details.amenities.room", v)}
      />
      <AmenityGrid
        title="Services Provided"
        options={SERVICES}
        value={a.services ?? []}
        onChange={(v) => setF("pg_details.amenities.services", v)}
      />
      <AmenityGrid
        title="Extra Facilities"
        options={EXTRAS}
        value={a.extras ?? []}
        onChange={(v) => setF("pg_details.amenities.extras", v)}
      />

      <MealsToggle value={d.meals} onChange={(v) => setF("pg_details.meals", v)} />

      <div className="pgo-step-nav">
        <button
          className="pgo-btn pgo-btn--secondary"
          type="button"
          onClick={() => dispatch({ type: "GOTO_STEP", step: 5 })}
        >
          Back
        </button>
        <button
          className="pgo-btn pgo-btn--primary"
          type="button"
          onClick={() => dispatch({ type: "GOTO_STEP", step: 7 })}
        >
          Next <ChevronRight size={16} />
        </button>
      </div>
    </section>
  );
}
