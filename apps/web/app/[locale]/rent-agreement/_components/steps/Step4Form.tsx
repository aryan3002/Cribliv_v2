"use client";

import { useState } from "react";
import type { StepFormProps } from "./types";
import { step4Schema } from "@/lib/rent-agreement/schemas/step-4.zod";

interface InventoryRow {
  item: string;
  quantity: number;
  condition: string;
}

const ALLOCATION_OPTIONS = [
  { value: "owner", label: "Owner" },
  { value: "tenant", label: "Tenant" },
  { value: "shared", label: "Shared" }
];

// Society charges additionally allow "na" (not applicable).
const SOCIETY_OPTIONS = [...ALLOCATION_OPTIONS, { value: "na", label: "N/A" }];

const CONDITION_OPTIONS = [
  { value: "new", label: "New" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
  { value: "poor", label: "Poor" }
];

const PAYMENT_METHOD_OPTIONS = [
  { value: "bank_transfer", label: "Bank transfer" },
  { value: "upi", label: "UPI" },
  { value: "cheque", label: "Cheque" },
  { value: "cash", label: "Cash" }
];

export function Step4Form(props: StepFormProps) {
  const [inventoryItems, setInventoryItems] = useState<InventoryRow[]>([
    { item: "Ceiling fan", quantity: 2, condition: "good" }
  ]);
  const [rentDueDay, setRentDueDay] = useState<string>("5");
  const [rentPaymentMethod, setRentPaymentMethod] = useState<string>("upi");
  const [maintenanceIncluded, setMaintenanceIncluded] = useState<boolean>(true);
  const [maintenanceRupees, setMaintenanceRupees] = useState<string>("");
  const [electricityPaidBy, setElectricityPaidBy] = useState<string>("tenant");
  const [waterPaidBy, setWaterPaidBy] = useState<string>("tenant");
  const [gasPaidBy, setGasPaidBy] = useState<string>("tenant");
  const [societyChargesPaidBy, setSocietyChargesPaidBy] = useState<string>("shared");
  const [latePaymentPenaltyPct, setLatePaymentPenaltyPct] = useState<string>("2");
  const [errors, setErrors] = useState<string[]>([]);

  function addRow() {
    setInventoryItems((prev) => [...prev, { item: "", quantity: 1, condition: "good" }]);
  }

  function removeRow(index: number) {
    setInventoryItems((prev) => prev.filter((_, i) => i !== index));
  }

  function updateRow(index: number, field: keyof InventoryRow, value: string | number) {
    setInventoryItems((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const payload: Record<string, unknown> = {
      inventory_items: inventoryItems.map((row) => ({
        item: row.item,
        quantity: Number(row.quantity),
        condition: row.condition
      })),
      rent_due_day: Number(rentDueDay),
      rent_payment_method: rentPaymentMethod,
      maintenance_included: maintenanceIncluded,
      electricity_paid_by: electricityPaidBy,
      water_paid_by: waterPaidBy,
      gas_paid_by: gasPaidBy,
      society_charges_paid_by: societyChargesPaidBy,
      late_payment_penalty_pct: Number(latePaymentPenaltyPct)
    };

    if (maintenanceRupees.trim() !== "") {
      const rupees = parseFloat(maintenanceRupees);
      if (!isNaN(rupees)) {
        payload.maintenance_paise = Math.round(rupees * 100);
      }
    }

    const result = step4Schema.safeParse(payload);

    if (!result.success) {
      setErrors(result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
      return;
    }

    setErrors([]);
    await props.onSubmit(result.data);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Inventory Items */}
      <fieldset>
        <legend className="font-semibold mb-2">Inventory Items</legend>
        {inventoryItems.map((row, index) => (
          <div key={index} className="flex gap-2 items-center mb-2">
            <div>
              <label htmlFor={`item-${index}`} className="sr-only">
                Item name
              </label>
              <input
                id={`item-${index}`}
                type="text"
                placeholder="Item name"
                value={row.item}
                onChange={(e) => updateRow(index, "item", e.target.value)}
                className="border rounded px-2 py-1"
              />
            </div>
            <div>
              <label htmlFor={`quantity-${index}`} className="sr-only">
                Quantity
              </label>
              <input
                id={`quantity-${index}`}
                type="number"
                min={1}
                value={row.quantity}
                onChange={(e) => updateRow(index, "quantity", parseInt(e.target.value, 10))}
                className="border rounded px-2 py-1 w-20"
              />
            </div>
            <div>
              <label htmlFor={`condition-${index}`} className="sr-only">
                Condition
              </label>
              <select
                id={`condition-${index}`}
                value={row.condition}
                onChange={(e) => updateRow(index, "condition", e.target.value)}
                className="border rounded px-2 py-1"
              >
                {CONDITION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" onClick={() => removeRow(index)} className="text-sm underline">
              Remove
            </button>
          </div>
        ))}
        <button type="button" onClick={addRow} className="text-sm underline">
          Add item
        </button>
      </fieldset>

      {/* Rent Due Day */}
      <div>
        <label htmlFor="rent_due_day" className="block text-sm font-medium">
          Rent Due Day
        </label>
        <input
          id="rent_due_day"
          type="number"
          min={1}
          max={28}
          value={rentDueDay}
          onChange={(e) => setRentDueDay(e.target.value)}
          className="border rounded px-2 py-1"
        />
      </div>

      {/* Rent Payment Method */}
      <div>
        <label htmlFor="rent_payment_method" className="block text-sm font-medium">
          Rent Payment Method
        </label>
        <select
          id="rent_payment_method"
          value={rentPaymentMethod}
          onChange={(e) => setRentPaymentMethod(e.target.value)}
          className="border rounded px-2 py-1"
        >
          {PAYMENT_METHOD_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* Maintenance Included */}
      <div className="flex items-center gap-2">
        <input
          id="maintenance_included"
          type="checkbox"
          checked={maintenanceIncluded}
          onChange={(e) => setMaintenanceIncluded(e.target.checked)}
        />
        <label htmlFor="maintenance_included" className="text-sm font-medium">
          Maintenance Included
        </label>
      </div>

      {/* Maintenance Amount */}
      <div>
        <label htmlFor="maintenance_rupees" className="block text-sm font-medium">
          Maintenance (₹)
        </label>
        <input
          id="maintenance_rupees"
          type="number"
          min={0}
          step="0.01"
          value={maintenanceRupees}
          placeholder="Leave blank to omit"
          onChange={(e) => setMaintenanceRupees(e.target.value)}
          className="border rounded px-2 py-1"
        />
      </div>

      {/* Electricity Paid By */}
      <div>
        <label htmlFor="electricity_paid_by" className="block text-sm font-medium">
          Electricity Paid By
        </label>
        <select
          id="electricity_paid_by"
          value={electricityPaidBy}
          onChange={(e) => setElectricityPaidBy(e.target.value)}
          className="border rounded px-2 py-1"
        >
          {ALLOCATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Water Paid By */}
      <div>
        <label htmlFor="water_paid_by" className="block text-sm font-medium">
          Water Paid By
        </label>
        <select
          id="water_paid_by"
          value={waterPaidBy}
          onChange={(e) => setWaterPaidBy(e.target.value)}
          className="border rounded px-2 py-1"
        >
          {ALLOCATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Gas Paid By */}
      <div>
        <label htmlFor="gas_paid_by" className="block text-sm font-medium">
          Gas Paid By
        </label>
        <select
          id="gas_paid_by"
          value={gasPaidBy}
          onChange={(e) => setGasPaidBy(e.target.value)}
          className="border rounded px-2 py-1"
        >
          {ALLOCATION_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Society Charges Paid By */}
      <div>
        <label htmlFor="society_charges_paid_by" className="block text-sm font-medium">
          Society Charges Paid By
        </label>
        <select
          id="society_charges_paid_by"
          value={societyChargesPaidBy}
          onChange={(e) => setSocietyChargesPaidBy(e.target.value)}
          className="border rounded px-2 py-1"
        >
          {SOCIETY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Late Payment Penalty */}
      <div>
        <label htmlFor="late_payment_penalty_pct" className="block text-sm font-medium">
          Late Payment Penalty (%)
        </label>
        <input
          id="late_payment_penalty_pct"
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={latePaymentPenaltyPct}
          onChange={(e) => setLatePaymentPenaltyPct(e.target.value)}
          className="border rounded px-2 py-1"
        />
      </div>

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
