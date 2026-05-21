"use client";

import { useState } from "react";
import type { StepFormProps } from "./types";
import { step5Schema } from "@/lib/rent-agreement/schemas/step-5.zod";

interface WitnessState {
  name: string;
  father_name: string;
  address: string;
  phone: string;
}

const defaultWitness1: WitnessState = {
  name: "Mohan Rao",
  father_name: "Krishna Rao",
  address: "23 Lake View Road, Bengaluru 560001",
  phone: ""
};

const defaultWitness2: WitnessState = {
  name: "Priya Nair",
  father_name: "Anil Nair",
  address: "8 Garden Street, Bengaluru 560002",
  phone: ""
};

export function Step5Form(props: StepFormProps) {
  const [petsAllowed, setPetsAllowed] = useState(true);
  const [sublettingAllowed, setSublettingAllowed] = useState(false);
  const [renovationAllowed, setRenovationAllowed] = useState(false);
  const [commercialUseAllowed, setCommercialUseAllowed] = useState(false);
  const [maxOccupants, setMaxOccupants] = useState(4);
  const [additionalTerms, setAdditionalTerms] = useState<string[]>([]);
  const [witness1, setWitness1] = useState<WitnessState>(defaultWitness1);
  const [witness2, setWitness2] = useState<WitnessState>(defaultWitness2);
  const [errors, setErrors] = useState<string[]>([]);

  function updateWitness1(field: keyof WitnessState, value: string) {
    setWitness1((prev) => ({ ...prev, [field]: value }));
  }

  function updateWitness2(field: keyof WitnessState, value: string) {
    setWitness2((prev) => ({ ...prev, [field]: value }));
  }

  function addTerm() {
    setAdditionalTerms((prev) => [...prev, ""]);
  }

  function updateTerm(index: number, value: string) {
    setAdditionalTerms((prev) => prev.map((t, i) => (i === index ? value : t)));
  }

  function removeTerm(index: number) {
    setAdditionalTerms((prev) => prev.filter((_, i) => i !== index));
  }

  function buildWitness(w: WitnessState) {
    const obj: { name: string; father_name: string; address: string; phone?: string } = {
      name: w.name,
      father_name: w.father_name,
      address: w.address
    };
    if (w.phone.trim() !== "") {
      obj.phone = w.phone.trim();
    }
    return obj;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const payload = {
      pets_allowed: petsAllowed,
      subletting_allowed: sublettingAllowed,
      renovation_allowed: renovationAllowed,
      commercial_use_allowed: commercialUseAllowed,
      max_occupants: maxOccupants,
      additional_terms: additionalTerms,
      witness_1: buildWitness(witness1),
      witness_2: buildWitness(witness2)
    };

    const r = step5Schema.safeParse(payload);
    if (!r.success) {
      setErrors(r.error.issues.map((i) => i.message));
      return;
    }

    setErrors([]);
    await props.onSubmit(r.data);
  }

  return (
    <form onSubmit={handleSubmit} className="ra-form">
      <fieldset className="ra-form-section">
        <legend className="ra-form-section-title">Clauses</legend>
        <div className="ra-checkbox-grid">
          <div className="ra-checkbox-row">
            <input
              id="pets_allowed"
              type="checkbox"
              checked={petsAllowed}
              onChange={(e) => setPetsAllowed(e.target.checked)}
            />
            <label htmlFor="pets_allowed" className="ra-label">
              Pets Allowed
            </label>
          </div>

          <div className="ra-checkbox-row">
            <input
              id="subletting_allowed"
              type="checkbox"
              checked={sublettingAllowed}
              onChange={(e) => setSublettingAllowed(e.target.checked)}
            />
            <label htmlFor="subletting_allowed" className="ra-label">
              Subletting Allowed
            </label>
          </div>

          <div className="ra-checkbox-row">
            <input
              id="renovation_allowed"
              type="checkbox"
              checked={renovationAllowed}
              onChange={(e) => setRenovationAllowed(e.target.checked)}
            />
            <label htmlFor="renovation_allowed" className="ra-label">
              Renovation Allowed
            </label>
          </div>

          <div className="ra-checkbox-row">
            <input
              id="commercial_use_allowed"
              type="checkbox"
              checked={commercialUseAllowed}
              onChange={(e) => setCommercialUseAllowed(e.target.checked)}
            />
            <label htmlFor="commercial_use_allowed" className="ra-label">
              Commercial Use Allowed
            </label>
          </div>
        </div>
      </fieldset>

      <section className="ra-form-section">
        <h2 className="ra-form-section-title">Occupancy and terms</h2>
        <div className="ra-form-grid">
          <div className="ra-field">
            <label htmlFor="max_occupants" className="ra-label">
              Max Occupants
            </label>
            <input
              id="max_occupants"
              type="number"
              min={1}
              max={50}
              value={maxOccupants}
              onChange={(e) => setMaxOccupants(Number(e.target.value))}
              className="ra-input"
            />
          </div>

          <div className="ra-field-full">
            <p className="ra-label">Additional Terms</p>
            <div className="ra-row-list">
              {additionalTerms.map((term, i) => (
                <div key={i} className="ra-term-row">
                  <input
                    type="text"
                    placeholder="Additional term"
                    value={term}
                    onChange={(e) => updateTerm(i, e.target.value)}
                    className="ra-input"
                  />
                  <button type="button" onClick={() => removeTerm(i)} className="ra-button-ghost">
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button type="button" onClick={addTerm} className="ra-button-secondary">
              Add term
            </button>
          </div>
        </div>
      </section>

      <fieldset className="ra-form-section">
        <legend className="ra-form-section-title">Witness 1</legend>
        <div className="ra-form-grid">
          <div className="ra-field">
            <label htmlFor="w1_name" className="ra-label">
              Name
            </label>
            <input
              id="w1_name"
              type="text"
              value={witness1.name}
              onChange={(e) => updateWitness1("name", e.target.value)}
              className="ra-input"
            />
          </div>

          <div className="ra-field">
            <label htmlFor="w1_father_name" className="ra-label">
              Father&apos;s Name
            </label>
            <input
              id="w1_father_name"
              type="text"
              value={witness1.father_name}
              onChange={(e) => updateWitness1("father_name", e.target.value)}
              className="ra-input"
            />
          </div>

          <div className="ra-field-full">
            <label htmlFor="w1_address" className="ra-label">
              Address
            </label>
            <input
              id="w1_address"
              type="text"
              value={witness1.address}
              onChange={(e) => updateWitness1("address", e.target.value)}
              className="ra-input"
            />
          </div>

          <div className="ra-field">
            <label htmlFor="w1_phone" className="ra-label">
              Phone (optional)
            </label>
            <input
              id="w1_phone"
              type="text"
              value={witness1.phone}
              onChange={(e) => updateWitness1("phone", e.target.value)}
              className="ra-input"
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="ra-form-section">
        <legend className="ra-form-section-title">Witness 2</legend>
        <div className="ra-form-grid">
          <div className="ra-field">
            <label htmlFor="w2_name" className="ra-label">
              Name
            </label>
            <input
              id="w2_name"
              type="text"
              value={witness2.name}
              onChange={(e) => updateWitness2("name", e.target.value)}
              className="ra-input"
            />
          </div>

          <div className="ra-field">
            <label htmlFor="w2_father_name" className="ra-label">
              Father&apos;s Name
            </label>
            <input
              id="w2_father_name"
              type="text"
              value={witness2.father_name}
              onChange={(e) => updateWitness2("father_name", e.target.value)}
              className="ra-input"
            />
          </div>

          <div className="ra-field-full">
            <label htmlFor="w2_address" className="ra-label">
              Address
            </label>
            <input
              id="w2_address"
              type="text"
              value={witness2.address}
              onChange={(e) => updateWitness2("address", e.target.value)}
              className="ra-input"
            />
          </div>

          <div className="ra-field">
            <label htmlFor="w2_phone" className="ra-label">
              Phone (optional)
            </label>
            <input
              id="w2_phone"
              type="text"
              value={witness2.phone}
              onChange={(e) => updateWitness2("phone", e.target.value)}
              className="ra-input"
            />
          </div>
        </div>
      </fieldset>

      {errors.length > 0 && (
        <div className="ra-error-box" role="alert">
          <b>Please fix the following errors:</b>
          <ul>
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <button type="submit" disabled={props.busy} className="ra-button">
        {props.busy ? "Submitting…" : "Save and continue"}
        <span className="sr-only">Advance</span>
      </button>
    </form>
  );
}
