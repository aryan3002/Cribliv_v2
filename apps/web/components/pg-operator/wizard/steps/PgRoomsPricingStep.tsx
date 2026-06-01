"use client";
import { Dispatch, useState } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Snowflake, Sun } from "lucide-react";
import {
  PgWizardState,
  PgWizardAction,
  RENT_BOUNDS,
  cellKey as roomTypeKey
} from "@/lib/pg-wizard-state";
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

  // Always commit local draft state; only gate the wizard dispatch + error display
  // by validity. Previously this returned early on out-of-bounds rent, which made
  // intermediate keystrokes (typing "2" → 200 paise → invalid) silently dropped —
  // pasting "2000" worked because that single edit hit a valid value in one step.
  const upsert = (sharing: string, ac: boolean, patch: Partial<Cell>) => {
    const k = cellKey(sharing, ac);
    const current = drafts[k] ?? { sharing, ac };
    const merged = { ...current, ...patch } as Cell;

    // Always reflect what the user typed locally.
    setDrafts((p) => ({ ...p, [k]: merged }));

    const rentValid = validRent(merged.monthly_rent_paise ?? undefined);

    // Clear the inline error as soon as it becomes valid; do NOT show it while typing
    // (only on blur or when the wizard advances). See onRentBlur below.
    if (rentValid) {
      setRowErrors((p) => ({ ...p, [k]: null }));
    }

    if (rentValid && merged.vacancy_count && merged.vacancy_count > 0) {
      dispatch({ type: "UPSERT_ROOM_TYPE", row: merged as any });
    } else {
      // Cell is no longer valid (e.g. rent edited below the floor, or vacancy
      // cleared) — drop any previously-committed row so wizard state never
      // diverges from what's actually on screen.
      dispatch({ type: "REMOVE_ROOM_TYPE", key: roomTypeKey({ sharing, ac }) });
    }
  };

  const onRentBlur = (sharing: string, ac: boolean) => {
    const k = cellKey(sharing, ac);
    const cell = drafts[k];
    if (cell?.monthly_rent_paise != null && !validRent(cell.monthly_rent_paise)) {
      setRowErrors((p) => ({ ...p, [k]: "Rent must be ₹2,000 – ₹50,000" }));
    }
  };

  const onNext = () => {
    // Surface per-row errors at the moment of advancing (never per-keystroke, to
    // avoid the intermediate-value flash) so the operator sees exactly which cell
    // is blocking them.
    const nextErrors: Record<string, string | null> = {};
    for (const [k, cell] of Object.entries(drafts)) {
      if (cell.monthly_rent_paise != null && !validRent(cell.monthly_rent_paise)) {
        nextErrors[k] = "Rent must be ₹2,000 – ₹50,000";
      } else if (
        validRent(cell.monthly_rent_paise) &&
        !(cell.vacancy_count && cell.vacancy_count > 0)
      ) {
        nextErrors[k] = "Add a vacancy count";
      }
    }
    setRowErrors(nextErrors);

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
    <section>
      <p className="pgo-desc" style={{ marginBottom: 24 }}>
        Rent must be between ₹2,000 and ₹50,000 per month.
      </p>

      <div
        style={{
          borderRadius: "var(--pgo-radius-lg)",
          overflow: "hidden",
          border: "1px solid var(--pgo-border)"
        }}
      >
        <table className="pgo-matrix">
          <thead>
            <tr role="row">
              <th>Sharing</th>
              <th>Type</th>
              <th>Rent / mo</th>
              <th>Vacancy</th>
              <th>Deposit</th>
              <th>Available</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const cell = getCell(r.sharing, r.ac);
              const k = cellKey(r.sharing, r.ac);
              const err = rowErrors[k];
              return (
                <tr role="row" key={k}>
                  <td>
                    <span className="pgo-matrix__cell-label">{r.sharing}</span>
                  </td>
                  <td>
                    <span
                      className={`pgo-matrix__cell-badge ${r.ac ? "pgo-matrix__cell-badge--ac" : ""}`}
                    >
                      {r.ac ? (
                        <>
                          <Snowflake size={12} /> AC
                        </>
                      ) : (
                        <>
                          <Sun size={12} /> Non-AC
                        </>
                      )}
                    </span>
                  </td>
                  <td>
                    <RupeeInput
                      aria-label={`rent ${k}`}
                      valuePaise={cell?.monthly_rent_paise ?? null}
                      onChangePaise={(v) =>
                        upsert(r.sharing, r.ac, { monthly_rent_paise: v ?? undefined })
                      }
                      onBlur={() => onRentBlur(r.sharing, r.ac)}
                      placeholder=" "
                    />
                    {err && (
                      <span role="alert" className="pgo-field__error">
                        {err}
                      </span>
                    )}
                  </td>
                  <td>
                    <div className="pgo-field" style={{ marginBottom: 0 }}>
                      <input
                        className="pgo-field__input"
                        aria-label={`vacancy ${k}`}
                        type="number"
                        min={0}
                        max={500}
                        value={cell?.vacancy_count ?? ""}
                        onChange={(e) =>
                          upsert(r.sharing, r.ac, {
                            vacancy_count: parseInt(e.target.value, 10) || 0
                          })
                        }
                        placeholder=" "
                      />
                    </div>
                  </td>
                  <td>
                    <RupeeInput
                      aria-label={`deposit ${k}`}
                      valuePaise={cell?.security_deposit_paise ?? null}
                      onChangePaise={(v) =>
                        upsert(r.sharing, r.ac, { security_deposit_paise: v ?? undefined })
                      }
                      placeholder=" "
                    />
                  </td>
                  <td>
                    <div className="pgo-field" style={{ marginBottom: 0 }}>
                      <input
                        className="pgo-field__input"
                        aria-label={`available from ${k}`}
                        type="date"
                        value={cell?.available_from ?? ""}
                        onChange={(e) =>
                          upsert(r.sharing, r.ac, { available_from: e.target.value })
                        }
                        placeholder=" "
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {error && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="pgo-error-msg"
          role="alert"
        >
          {error}
        </motion.p>
      )}

      <div className="pgo-step-nav">
        <button
          className="pgo-btn pgo-btn--secondary"
          type="button"
          onClick={() => dispatch({ type: "GOTO_STEP", step: 1 })}
        >
          Back
        </button>
        <button className="pgo-btn pgo-btn--primary" type="button" onClick={onNext}>
          Next
        </button>
      </div>
    </section>
  );
}
