"use client";
import { Dispatch, useState } from "react";
import { PgWizardState, PgWizardAction } from "@/lib/pg-wizard-state";
import { createPgProperty } from "@/lib/pg-operator-api";
import EnumChips from "../shared/EnumChips";

const SHARING = [
  { value: "single", label: "Single" },
  { value: "double", label: "Double" },
  { value: "triple", label: "Triple" },
  { value: "quad", label: "Quad" },
  { value: "dorm", label: "Dorm" }
] as const;

interface Props {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  locale: string;
  /** From RSC session; required to call createPgProperty. */
  accessToken: string | null;
}

export default function PgPropertyBasicsStep({ state, dispatch, accessToken }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const d = state.draft;
  const ui = state.ui;
  const setF = (path: string, value: unknown) => dispatch({ type: "SET_FIELD", path, value });
  const toggleSharing = (v: "single" | "double" | "triple" | "quad" | "dorm") => {
    const cur = new Set<string>(ui.sharing_options ?? []);
    cur.has(v) ? cur.delete(v) : cur.add(v);
    dispatch({ type: "SET_UI_FIELD", path: "sharing_options", value: Array.from(cur) });
  };

  const validate = (): string | null => {
    if (!d.property?.display_name || d.property.display_name.length < 2)
      return "Property name required (≥2 chars)";
    if (!d.property?.city_slug) return "City required";
    if (!d.pg_details?.total_beds || d.pg_details.total_beds < 1) return "Total beds required";
    if (!ui.sharing_options || ui.sharing_options.length < 1)
      return "Pick at least one sharing option";
    return null;
  };

  const onNext = async () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);

    // If property doesn't exist yet on the server, create it now.
    if (!state.pgPropertyId) {
      if (!accessToken) {
        setError("Sign in required to create your property.");
        return;
      }
      setBusy(true);
      try {
        const prop = await createPgProperty({
          idempotencyKey: crypto.randomUUID(),
          token: accessToken,
          input: {
            display_name: d.property!.display_name!,
            city_slug: d.property!.city_slug!,
            ...(d.property!.locality_slug ? { locality_slug: d.property!.locality_slug } : {}),
            ...(d.property!.internal_code ? { internal_code: d.property!.internal_code } : {}),
            ...(d.property!.total_floors ? { total_floors: d.property!.total_floors } : {})
          }
        });
        dispatch({ type: "SET_PG_PROPERTY_ID", pgPropertyId: prop.id });
      } catch (e) {
        const err = e as Error & { code?: string };
        if (err.code === "multi_property_not_enabled") {
          // Operator already has a property — fetch it via /me; this is the rare retry path.
          setError("You already have a property registered. Refresh and try again.");
        } else {
          setError(err.message);
        }
        setBusy(false);
        return;
      }
      setBusy(false);
    }

    dispatch({ type: "GOTO_STEP", step: 2 });
  };

  return (
    <section className="pg-step pg-step--basics">
      <h2>Property &amp; Identity</h2>
      <label>
        Property name
        <input
          aria-label="property name"
          value={d.property?.display_name ?? ""}
          onChange={(e) => setF("property.display_name", e.target.value)}
        />
      </label>
      <label>
        City
        <input
          aria-label="city"
          value={d.property?.city_slug ?? ""}
          onChange={(e) => setF("property.city_slug", e.target.value.toLowerCase())}
          placeholder="bangalore"
        />
      </label>
      <label>
        Locality
        <input
          aria-label="locality"
          value={d.property?.locality_slug ?? ""}
          onChange={(e) => setF("property.locality_slug", e.target.value.toLowerCase())}
        />
      </label>
      <label>
        Total floors
        <input
          type="number"
          aria-label="total floors"
          value={d.property?.total_floors ?? ""}
          onChange={(e) => setF("property.total_floors", parseInt(e.target.value, 10) || null)}
        />
      </label>
      <label>
        Internal code (optional)
        <input
          aria-label="internal code"
          value={d.property?.internal_code ?? ""}
          onChange={(e) => setF("property.internal_code", e.target.value)}
        />
      </label>
      <label>
        Total beds
        <input
          type="number"
          aria-label="total beds"
          value={d.pg_details?.total_beds ?? ""}
          onChange={(e) => setF("pg_details.total_beds", parseInt(e.target.value, 10) || 0)}
        />
      </label>
      <EnumChips
        label="Gender policy"
        value={d.pg_details?.gender_policy as any}
        onChange={(v) => setF("pg_details.gender_policy", v)}
        options={[
          { value: "boys", label: "Boys" },
          { value: "girls", label: "Girls" },
          { value: "coed", label: "Co-ed" }
        ]}
      />
      <EnumChips
        label="Tenant type"
        value={d.pg_details?.tenant_type as any}
        onChange={(v) => setF("pg_details.tenant_type", v)}
        options={[
          { value: "students", label: "Students" },
          { value: "working", label: "Working" },
          { value: "any", label: "Any" }
        ]}
      />
      <fieldset>
        <legend>Sharing options offered</legend>
        {SHARING.map((s) => {
          const active = (ui.sharing_options ?? []).includes(s.value);
          return (
            <button
              key={s.value}
              type="button"
              aria-pressed={active}
              onClick={() => toggleSharing(s.value)}
            >
              {s.label}
            </button>
          );
        })}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={onNext} disabled={busy}>
        {busy ? "Creating property…" : "Next"}
      </button>
    </section>
  );
}
