"use client";
import { Dispatch } from "react";
import { UtensilsCrossed, Sparkles } from "lucide-react";
import { PgWizardState, PgWizardAction } from "@/lib/pg-wizard-state";
import SectionCard from "../shared/SectionCard";
import MealsToggle from "../shared/MealsToggle";
import ChipMultiSelect, { type ChipOption } from "../shared/ChipMultiSelect";
import RupeeInput from "../shared/RupeeInput";
import Disclosure from "../shared/Disclosure";

const LABELS: Record<string, string> = {
  wifi: "High-Speed WiFi",
  hot_water: "Hot Water",
  power_backup: "Power Backup",
  cctv: "CCTV",
  security_guard: "Security Guard",
  ac: "Air Conditioning",
  tv: "TV",
  study_table: "Study Table",
  wardrobe: "Wardrobe",
  safety_locker: "Safety Locker",
  mattress: "Mattress",
  housekeeping: "Daily Cleaning",
  laundry: "Laundry",
  biometric_access: "Biometric Access",
  parking_2w: "2-Wheeler Parking",
  parking_4w: "4-Wheeler Parking",
  fridge: "Fridge",
  microwave: "Microwave",
  gym: "Gym",
  indoor_games: "Indoor Games"
};

const opts = (keys: string[]): ChipOption[] =>
  keys.map((k) => ({ value: k, label: LABELS[k] ?? k }));

const CORE = ["wifi", "hot_water", "power_backup", "cctv", "security_guard"];
const ROOM = ["ac", "tv", "study_table", "wardrobe", "safety_locker", "mattress"];
const SERVICES = ["housekeeping", "laundry", "biometric_access"];
const EXTRAS = ["parking_2w", "parking_4w", "fridge", "microwave", "gym", "indoor_games"];

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
      >
        <ChipMultiSelect
          label="Core"
          value={a.core ?? []}
          options={opts(CORE)}
          onChange={(v) => setF("pg_details.amenities.core", v)}
        />
        <ChipMultiSelect
          label="In-room"
          value={a.room ?? []}
          options={opts(ROOM)}
          onChange={(v) => setF("pg_details.amenities.room", v)}
        />
        <ChipMultiSelect
          label="Services"
          value={a.services ?? []}
          options={opts(SERVICES)}
          onChange={(v) => setF("pg_details.amenities.services", v)}
        />
        <Disclosure summary="More facilities">
          <ChipMultiSelect
            label="Extras"
            value={a.extras ?? []}
            options={opts(EXTRAS)}
            onChange={(v) => setF("pg_details.amenities.extras", v)}
          />
        </Disclosure>
      </SectionCard>
    </div>
  );
}
