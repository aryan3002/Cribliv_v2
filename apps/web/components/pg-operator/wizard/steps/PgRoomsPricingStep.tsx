"use client";
import { Dispatch, useState } from "react";
import { PgWizardState, PgWizardAction, RENT_BOUNDS } from "@/lib/pg-wizard-state";
import RupeeInput from "../shared/RupeeInput";

type Cell = {
  sharing: string;
  ac: boolean;
  monthly_rent_paise?: number;
  vacancy_count?: number;
  security_deposit_paise?: number;
  available_from?: string;
};

export default function PgRoomsPricingStep({
  state,
  dispatch
}: {
  state: PgWizardState;
  dispatch: Dispatch<PgWizardAction>;
  locale: string;
}) {
  const sharingOpts: string[] = state.ui.sharing_options ?? [];
  const [rowErrors, setRowErrors] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  // Local partial-row tracking: lets the operator fill rent first, then vacancy
  // (or vice versa) and have both eventually reach the reducer once both are set.
  // Without this, partial entries never reach state.draft.room_types, so a second
  // edit can't see the first one (state is the only source of truth in the parent).
  const [drafts, setDrafts] = useState<Record<string, Cell>>(() => {
    const seed: Record<string, Cell> = {};
    for (const r of state.draft.room_types ?? []) {
      const key = `${r.sharing}-${r.ac ? "ac" : "non-ac"}`;
      seed[key] = r as Cell;
    }
    return seed;
  });

  const cellKey = (sharing: string, ac: boolean) => `${sharing}-${ac ? "ac" : "non-ac"}`;
  const getCell = (sharing: string, ac: boolean): Cell | undefined => drafts[cellKey(sharing, ac)];

  const validRent = (paise: number | undefined): boolean =>
    paise != null && paise >= RENT_BOUNDS.min && paise <= RENT_BOUNDS.max;

  const upsert = (sharing: string, ac: boolean, patch: Partial<Cell>) => {
    const k = cellKey(sharing, ac);
    const current = drafts[k] ?? { sharing, ac };
    const merged = { ...current, ...patch } as Cell;

    // Validate rent if present
    if (merged.monthly_rent_paise != null && !validRent(merged.monthly_rent_paise)) {
      setRowErrors((p) => ({ ...p, [k]: "Rent must be ₹2,000 – ₹50,000" }));
      // Keep the prior valid drafts entry; don't write out-of-range to local state
      return;
    }
    // Only clear the error when the user is actively editing rent and it's now valid.
    // Editing vacancy/deposit/date should not clear a prior rent error.
    if ("monthly_rent_paise" in patch && merged.monthly_rent_paise != null) {
      setRowErrors((p) => ({ ...p, [k]: null }));
    }
    // Always persist locally so a later edit can complete the row
    setDrafts((p) => ({ ...p, [k]: merged }));

    // Only commit to the reducer when the row is complete + valid
    if (merged.monthly_rent_paise && merged.vacancy_count && validRent(merged.monthly_rent_paise)) {
      dispatch({ type: "UPSERT_ROOM_TYPE", row: merged as any });
    }
  };

  const onNext = () => {
    const valid = (state.draft.room_types ?? []).filter(
      (r: any) => validRent(r.monthly_rent_paise) && r.vacancy_count > 0
    );
    if (valid.length === 0) {
      setError("Add at least one room with valid rent and vacancy");
      return;
    }
    setError(null);
    dispatch({ type: "GOTO_STEP", step: 3 });
  };

  const rows: Cell[] = sharingOpts.flatMap((s) => [
    { sharing: s, ac: false },
    { sharing: s, ac: true }
  ]);

  return (
    <section className="pg-step pg-step--rooms">
      <h2>Rooms &amp; Pricing</h2>
      <p style={{ fontSize: "0.85rem", color: "#666" }}>Rent must be between ₹2,000 and ₹50,000.</p>
      <table>
        <thead>
          <tr role="row">
            <th>Sharing</th>
            <th>AC</th>
            <th>Rent</th>
            <th>Vacancy</th>
            <th>Deposit</th>
            <th>Available from</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cell = getCell(r.sharing, r.ac);
            const k = `${r.sharing}-${r.ac ? "ac" : "non-ac"}`;
            const err = rowErrors[k];
            return (
              <tr role="row" key={k}>
                <td>{r.sharing}</td>
                <td>{r.ac ? "AC" : "Non-AC"}</td>
                <td>
                  <RupeeInput
                    aria-label={`rent ${k}`}
                    valuePaise={cell?.monthly_rent_paise ?? null}
                    onChangePaise={(v) =>
                      upsert(r.sharing, r.ac, { monthly_rent_paise: v ?? undefined })
                    }
                  />
                  {err && (
                    <span
                      role="alert"
                      style={{ display: "block", fontSize: "0.75rem", color: "#a02828" }}
                    >
                      {err}
                    </span>
                  )}
                </td>
                <td>
                  <input
                    aria-label={`vacancy ${k}`}
                    type="number"
                    min={0}
                    max={500}
                    value={cell?.vacancy_count ?? ""}
                    onChange={(e) =>
                      upsert(r.sharing, r.ac, { vacancy_count: parseInt(e.target.value, 10) || 0 })
                    }
                  />
                </td>
                <td>
                  <RupeeInput
                    aria-label={`deposit ${k}`}
                    valuePaise={cell?.security_deposit_paise ?? null}
                    onChangePaise={(v) =>
                      upsert(r.sharing, r.ac, { security_deposit_paise: v ?? undefined })
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={`available from ${k}`}
                    type="date"
                    value={cell?.available_from ?? ""}
                    onChange={(e) => upsert(r.sharing, r.ac, { available_from: e.target.value })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={() => dispatch({ type: "GOTO_STEP", step: 1 })}>
        Back
      </button>
      <button type="button" onClick={onNext}>
        Next
      </button>
    </section>
  );
}
