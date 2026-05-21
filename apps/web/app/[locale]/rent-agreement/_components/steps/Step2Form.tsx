"use client";

import { useState } from "react";
import type { StepFormProps } from "./types";
import { step2Schema } from "@/lib/rent-agreement/schemas/step-2.zod";

const INPUT_CLS = "ra-input";
const SELECT_CLS = "ra-select";

type PropertyType = "flat" | "house" | "villa" | "pg_room" | "shop" | "office";
type Furnishing = "unfurnished" | "semi_furnished" | "fully_furnished";
type Purpose = "residential" | "commercial" | "mixed";

const TYPE_OPTIONS: { value: PropertyType; label: string }[] = [
  { value: "flat", label: "Flat" },
  { value: "house", label: "House" },
  { value: "villa", label: "Villa" },
  { value: "pg_room", label: "PG room" },
  { value: "shop", label: "Shop" },
  { value: "office", label: "Office" }
];

const FURNISHING_OPTIONS: { value: Furnishing; label: string }[] = [
  { value: "unfurnished", label: "Unfurnished" },
  { value: "semi_furnished", label: "Semi-furnished" },
  { value: "fully_furnished", label: "Fully furnished" }
];

const PURPOSE_OPTIONS: { value: Purpose; label: string }[] = [
  { value: "residential", label: "Residential" },
  { value: "commercial", label: "Commercial" },
  { value: "mixed", label: "Mixed" }
];

const PARKING_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "— Not specified —" },
  { value: "none", label: "None" },
  { value: "two_wheeler", label: "Two-wheeler" },
  { value: "four_wheeler", label: "Four-wheeler" },
  { value: "both", label: "Both" }
];

export function Step2Form(props: StepFormProps) {
  const { onSubmit, busy } = props;

  // Required fields
  const [fullAddress, setFullAddress] = useState(
    "Flat 4B, Sunrise Apartments, MG Road, Bengaluru 560001"
  );
  const [type, setType] = useState<PropertyType>("flat");
  const [areaSqft, setAreaSqft] = useState("850");
  // Default "unfurnished": the backend cross-field validator (not step-scoped)
  // rejects a furnished property at step 2 because inventory_items (step 4)
  // cannot exist yet. See known-issue note in the route guide.
  const [furnishing, setFurnishing] = useState<Furnishing>("unfurnished");
  const [purpose, setPurpose] = useState<Purpose>("residential");

  // Optional fields
  const [parking, setParking] = useState("");
  const [floorNumber, setFloorNumber] = useState("");
  const [totalFloors, setTotalFloors] = useState("");
  const [flatNumber, setFlatNumber] = useState("");
  const [municipalNumber, setMunicipalNumber] = useState("");
  const [surveyNumber, setSurveyNumber] = useState("");

  const [errors, setErrors] = useState<string[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const payload: Record<string, unknown> = {
      full_address: fullAddress,
      type,
      area_sqft: areaSqft === "" ? NaN : Number(areaSqft),
      furnishing,
      purpose
    };

    // Omit optional fields when blank
    if (parking !== "") payload.parking = parking;
    if (floorNumber !== "") {
      const v = parseInt(floorNumber, 10);
      if (!isNaN(v)) payload.floor_number = v;
    }
    if (totalFloors !== "") {
      const v = parseInt(totalFloors, 10);
      if (!isNaN(v)) payload.total_floors = v;
    }
    if (flatNumber.trim() !== "") payload.flat_number = flatNumber.trim();
    if (municipalNumber.trim() !== "") payload.municipal_number = municipalNumber.trim();
    if (surveyNumber.trim() !== "") payload.survey_number = surveyNumber.trim();

    const result = step2Schema.safeParse(payload);

    if (!result.success) {
      setErrors(result.error.issues.map((issue) => issue.message));
      return;
    }

    setErrors([]);
    await onSubmit(result.data);
  }

  return (
    <form onSubmit={handleSubmit} className="ra-form">
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

      <section className="ra-form-section">
        <h2 className="ra-form-section-title">Property details</h2>
        <div className="ra-form-grid">
          <div className="ra-field-full">
            <label htmlFor="full_address" className="ra-label">
              Full Address
            </label>
            <textarea
              id="full_address"
              className="ra-textarea"
              value={fullAddress}
              onChange={(e) => setFullAddress(e.target.value)}
              rows={3}
            />
          </div>

          <div className="ra-field">
            <label htmlFor="type" className="ra-label">
              Property Type
            </label>
            <select
              id="type"
              className={SELECT_CLS}
              value={type}
              onChange={(e) => setType(e.target.value as PropertyType)}
            >
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="ra-field">
            <label htmlFor="area_sqft" className="ra-label">
              Area (sq ft)
            </label>
            <input
              id="area_sqft"
              type="number"
              className={INPUT_CLS}
              value={areaSqft}
              onChange={(e) => setAreaSqft(e.target.value)}
              min={1}
            />
          </div>

          <div className="ra-field">
            <label htmlFor="furnishing" className="ra-label">
              Furnishing
            </label>
            <select
              id="furnishing"
              className={SELECT_CLS}
              value={furnishing}
              onChange={(e) => setFurnishing(e.target.value as Furnishing)}
            >
              {FURNISHING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="ra-field">
            <label htmlFor="purpose" className="ra-label">
              Purpose
            </label>
            <select
              id="purpose"
              className={SELECT_CLS}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value as Purpose)}
            >
              {PURPOSE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section className="ra-form-section">
        <h2 className="ra-form-section-title">Identifiers and access</h2>
        <div className="ra-form-grid">
          <div className="ra-field">
            <label htmlFor="parking" className="ra-label">
              Parking (optional)
            </label>
            <select
              id="parking"
              className={SELECT_CLS}
              value={parking}
              onChange={(e) => setParking(e.target.value)}
            >
              {PARKING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="ra-field">
            <label htmlFor="floor_number" className="ra-label">
              Floor Number (optional)
            </label>
            <input
              id="floor_number"
              type="number"
              className={INPUT_CLS}
              value={floorNumber}
              onChange={(e) => setFloorNumber(e.target.value)}
            />
          </div>

          <div className="ra-field">
            <label htmlFor="total_floors" className="ra-label">
              Total Floors (optional)
            </label>
            <input
              id="total_floors"
              type="number"
              className={INPUT_CLS}
              value={totalFloors}
              onChange={(e) => setTotalFloors(e.target.value)}
              min={1}
            />
          </div>

          <div className="ra-field">
            <label htmlFor="flat_number" className="ra-label">
              Flat Number (optional)
            </label>
            <input
              id="flat_number"
              type="text"
              className={INPUT_CLS}
              value={flatNumber}
              onChange={(e) => setFlatNumber(e.target.value)}
            />
          </div>

          <div className="ra-field">
            <label htmlFor="municipal_number" className="ra-label">
              Municipal Number (optional)
            </label>
            <input
              id="municipal_number"
              type="text"
              className={INPUT_CLS}
              value={municipalNumber}
              onChange={(e) => setMunicipalNumber(e.target.value)}
            />
          </div>

          <div className="ra-field">
            <label htmlFor="survey_number" className="ra-label">
              Survey Number (optional)
            </label>
            <input
              id="survey_number"
              type="text"
              className={INPUT_CLS}
              value={surveyNumber}
              onChange={(e) => setSurveyNumber(e.target.value)}
            />
          </div>
        </div>
      </section>

      <button type="submit" disabled={busy} className="ra-button">
        {busy ? "Submitting…" : "Save and continue"}
        <span className="sr-only">Advance</span>
      </button>
    </form>
  );
}
