"use client";
import { Dispatch } from "react";
import { UtensilsCrossed, Sparkles } from "lucide-react";
import {
  PG_AMENITY_CORE,
  PG_AMENITY_DEFAULTS,
  PG_AMENITY_EXTRAS,
  PG_AMENITY_LABELS,
  PG_AMENITY_ROOM,
  PG_AMENITY_SERVICES
} from "@cribliv/shared-types";
import { PgWizardState, PgWizardAction } from "@/lib/pg-wizard-state";
import SectionCard from "../shared/SectionCard";
import MealsToggle from "../shared/MealsToggle";
import ChipMultiSelect, { type ChipOption } from "../shared/ChipMultiSelect";
import RupeeInput from "../shared/RupeeInput";
import Disclosure from "../shared/Disclosure";

const opts = (keys: readonly string[]): ChipOption[] =>
  keys.map((key) => ({ value: key, label: PG_AMENITY_LABELS[key] ?? key }));

export default function PgAmenitiesFoodStep({
  state,
  dispatch
}: {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  locale: string;
}) {
  const d = (state.draft.pg_details ?? {}) as any;
  const a = d.amenities ?? {};
  const setF = (path: string, value: unknown) => dispatch({ type: "SET_FIELD", path, value });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <SectionCard
        title="Food services"
        subtitle="Meal offerings and dietary options."
        icon={<UtensilsCrossed size={20} />}
      >
        <MealsToggle value={d.meals} onChange={(v) => setF("pg_details.meals", v)} />
        {d.meals?.provided && (
          <Disclosure summary="Add meal charges">
            <RupeeInput
              label="Monthly meal charge (leave blank if included in rent)"
              valuePaise={d.meal_charges_paise ?? null}
              onChangePaise={(p) => setF("pg_details.meal_charges_paise", p)}
            />
          </Disclosure>
        )}
      </SectionCard>

      <SectionCard
        title="Property amenities"
        subtitle="Select everything available to tenants."
        icon={<Sparkles size={20} />}
        action={
          <button
            type="button"
            className="pgo-btn pgo-btn--secondary"
            onClick={() => {
              setF("pg_details.amenities.core", PG_AMENITY_DEFAULTS.core);
              setF("pg_details.amenities.room", PG_AMENITY_DEFAULTS.room);
              setF("pg_details.amenities.services", PG_AMENITY_DEFAULTS.services);
              setF("pg_details.amenities.extras", PG_AMENITY_DEFAULTS.extras);
            }}
          >
            Typical PG defaults
          </button>
        }
      >
        <ChipMultiSelect
          label="Core"
          value={a.core ?? []}
          options={opts(PG_AMENITY_CORE)}
          onChange={(v) => setF("pg_details.amenities.core", v)}
        />
        <ChipMultiSelect
          label="In-room"
          value={a.room ?? []}
          options={opts(PG_AMENITY_ROOM)}
          onChange={(v) => setF("pg_details.amenities.room", v)}
        />
        <ChipMultiSelect
          label="Services"
          value={a.services ?? []}
          options={opts(PG_AMENITY_SERVICES)}
          onChange={(v) => setF("pg_details.amenities.services", v)}
        />
        <ChipMultiSelect
          label="Extras"
          value={a.extras ?? []}
          options={opts(PG_AMENITY_EXTRAS)}
          onChange={(v) => setF("pg_details.amenities.extras", v)}
        />
      </SectionCard>
    </div>
  );
}
