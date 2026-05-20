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
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Clauses */}
      <fieldset className="space-y-2">
        <legend className="font-semibold">Clauses</legend>

        <div className="flex items-center gap-2">
          <input
            id="pets_allowed"
            type="checkbox"
            checked={petsAllowed}
            onChange={(e) => setPetsAllowed(e.target.checked)}
          />
          <label htmlFor="pets_allowed">Pets Allowed</label>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="subletting_allowed"
            type="checkbox"
            checked={sublettingAllowed}
            onChange={(e) => setSublettingAllowed(e.target.checked)}
          />
          <label htmlFor="subletting_allowed">Subletting Allowed</label>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="renovation_allowed"
            type="checkbox"
            checked={renovationAllowed}
            onChange={(e) => setRenovationAllowed(e.target.checked)}
          />
          <label htmlFor="renovation_allowed">Renovation Allowed</label>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="commercial_use_allowed"
            type="checkbox"
            checked={commercialUseAllowed}
            onChange={(e) => setCommercialUseAllowed(e.target.checked)}
          />
          <label htmlFor="commercial_use_allowed">Commercial Use Allowed</label>
        </div>
      </fieldset>

      {/* Max Occupants */}
      <div className="flex flex-col gap-1">
        <label htmlFor="max_occupants">Max Occupants</label>
        <input
          id="max_occupants"
          type="number"
          min={1}
          max={50}
          value={maxOccupants}
          onChange={(e) => setMaxOccupants(Number(e.target.value))}
          className="border rounded px-2 py-1 w-24"
        />
      </div>

      {/* Additional Terms */}
      <div className="space-y-2">
        <p className="font-semibold">Additional Terms</p>
        {additionalTerms.map((term, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Additional term"
              value={term}
              onChange={(e) => updateTerm(i, e.target.value)}
              className="border rounded px-2 py-1 flex-1"
            />
            <button type="button" onClick={() => removeTerm(i)} className="text-sm underline">
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={addTerm} className="text-sm underline">
          Add term
        </button>
      </div>

      {/* Witness 1 */}
      <fieldset className="space-y-2 border p-3 rounded">
        <legend className="font-semibold">Witness 1</legend>

        <div className="flex flex-col gap-1">
          <label htmlFor="w1_name">Name</label>
          <input
            id="w1_name"
            type="text"
            value={witness1.name}
            onChange={(e) => updateWitness1("name", e.target.value)}
            className="border rounded px-2 py-1"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="w1_father_name">Father&apos;s Name</label>
          <input
            id="w1_father_name"
            type="text"
            value={witness1.father_name}
            onChange={(e) => updateWitness1("father_name", e.target.value)}
            className="border rounded px-2 py-1"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="w1_address">Address</label>
          <input
            id="w1_address"
            type="text"
            value={witness1.address}
            onChange={(e) => updateWitness1("address", e.target.value)}
            className="border rounded px-2 py-1"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="w1_phone">Phone (optional)</label>
          <input
            id="w1_phone"
            type="text"
            value={witness1.phone}
            onChange={(e) => updateWitness1("phone", e.target.value)}
            className="border rounded px-2 py-1"
          />
        </div>
      </fieldset>

      {/* Witness 2 */}
      <fieldset className="space-y-2 border p-3 rounded">
        <legend className="font-semibold">Witness 2</legend>

        <div className="flex flex-col gap-1">
          <label htmlFor="w2_name">Name</label>
          <input
            id="w2_name"
            type="text"
            value={witness2.name}
            onChange={(e) => updateWitness2("name", e.target.value)}
            className="border rounded px-2 py-1"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="w2_father_name">Father&apos;s Name</label>
          <input
            id="w2_father_name"
            type="text"
            value={witness2.father_name}
            onChange={(e) => updateWitness2("father_name", e.target.value)}
            className="border rounded px-2 py-1"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="w2_address">Address</label>
          <input
            id="w2_address"
            type="text"
            value={witness2.address}
            onChange={(e) => updateWitness2("address", e.target.value)}
            className="border rounded px-2 py-1"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="w2_phone">Phone (optional)</label>
          <input
            id="w2_phone"
            type="text"
            value={witness2.phone}
            onChange={(e) => updateWitness2("phone", e.target.value)}
            className="border rounded px-2 py-1"
          />
        </div>
      </fieldset>

      {/* Validation errors */}
      {errors.length > 0 && (
        <ul className="text-red-600 text-sm space-y-1">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={props.busy}
        className="px-3 py-1 border rounded bg-blue-600 text-white disabled:opacity-50"
      >
        {props.busy ? "Submitting…" : "Advance"}
      </button>
    </form>
  );
}
