"use client";

import { useState } from "react";
import type { StepFormProps } from "./types";
import { step1Schema } from "@/lib/rent-agreement/schemas/step-1.zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PartyFields {
  full_name: string;
  father_name: string;
  age: string;
  phone: string;
  email: string;
  permanent_address: string;
  pan: string;
  aadhaar_last4: string;
}

interface TenantFields extends PartyFields {
  tenant_company_name: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const ownerDefaults: PartyFields = {
  full_name: "Ramesh Kumar",
  father_name: "Suresh Kumar",
  age: "42",
  phone: "+919876543210",
  email: "",
  permanent_address: "12 MG Road, Bengaluru 560001",
  // Backend rule: monthly rent over ₹500 requires the landlord's PAN, so the
  // dev-flow default supplies a format-valid placeholder PAN.
  pan: "ABCDE1234F",
  aadhaar_last4: ""
};

const tenantDefaults: TenantFields = {
  full_name: "Anita Sharma",
  father_name: "Vijay Sharma",
  age: "29",
  phone: "+919812345678",
  email: "",
  permanent_address: "45 Park Street, Mumbai 400001",
  pan: "",
  aadhaar_last4: "",
  tenant_company_name: ""
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function buildPartyPayload(f: PartyFields) {
  const obj: Record<string, unknown> = {
    full_name: f.full_name,
    father_name: f.father_name,
    age: parseInt(f.age, 10),
    phone: f.phone,
    permanent_address: f.permanent_address
  };
  if (f.email.trim()) obj.email = f.email.trim();
  if (f.pan.trim()) obj.pan = f.pan.trim();
  if (f.aadhaar_last4.trim()) obj.aadhaar_last4 = f.aadhaar_last4.trim();
  return obj;
}

// ---------------------------------------------------------------------------
// Sub-component: PartySection
// ---------------------------------------------------------------------------
interface PartySectionProps {
  prefix: "owner" | "tenant";
  heading: string;
  fields: TenantFields;
  onChange: (key: keyof TenantFields, value: string) => void;
  isTenant?: boolean;
}

function PartySection({ prefix, heading, fields, onChange, isTenant }: PartySectionProps) {
  const id = (key: string) => `${prefix}-${key}`;
  // Label text uses the prefix (owner/tenant) so tests can query by /owner.*full name/i or /tenant.*full name/i
  const lbl = prefix.charAt(0).toUpperCase() + prefix.slice(1); // "Owner" | "Tenant"
  const inputCls = "border rounded px-2 py-1 w-full";

  return (
    <fieldset className="mb-6">
      <legend className="text-lg font-semibold mb-3">{heading}</legend>

      <div className="mb-3">
        <label htmlFor={id("full_name")}>{lbl} Full Name</label>
        <input
          id={id("full_name")}
          type="text"
          className={inputCls}
          value={fields.full_name}
          onChange={(e) => onChange("full_name", e.target.value)}
        />
      </div>

      <div className="mb-3">
        <label htmlFor={id("father_name")}>{lbl} Father Name</label>
        <input
          id={id("father_name")}
          type="text"
          className={inputCls}
          value={fields.father_name}
          onChange={(e) => onChange("father_name", e.target.value)}
        />
      </div>

      <div className="mb-3">
        <label htmlFor={id("age")}>{lbl} Age</label>
        <input
          id={id("age")}
          type="number"
          className={inputCls}
          value={fields.age}
          onChange={(e) => onChange("age", e.target.value)}
        />
      </div>

      <div className="mb-3">
        <label htmlFor={id("phone")}>{lbl} Phone</label>
        <input
          id={id("phone")}
          type="text"
          className={inputCls}
          value={fields.phone}
          onChange={(e) => onChange("phone", e.target.value)}
        />
      </div>

      <div className="mb-3">
        <label htmlFor={id("email")}>{lbl} Email (optional)</label>
        <input
          id={id("email")}
          type="email"
          className={inputCls}
          value={fields.email}
          onChange={(e) => onChange("email", e.target.value)}
        />
      </div>

      <div className="mb-3">
        <label htmlFor={id("permanent_address")}>{lbl} Permanent Address</label>
        <textarea
          id={id("permanent_address")}
          className={inputCls}
          value={fields.permanent_address}
          onChange={(e) => onChange("permanent_address", e.target.value)}
        />
      </div>

      <div className="mb-3">
        <label htmlFor={id("pan")}>{lbl} PAN (optional)</label>
        <input
          id={id("pan")}
          type="text"
          className={inputCls}
          value={fields.pan}
          onChange={(e) => onChange("pan", e.target.value.toUpperCase())}
        />
      </div>

      <div className="mb-3">
        <label htmlFor={id("aadhaar_last4")}>{lbl} Aadhaar Last 4 Digits (optional)</label>
        <input
          id={id("aadhaar_last4")}
          type="text"
          className={inputCls}
          maxLength={4}
          value={fields.aadhaar_last4}
          onChange={(e) => onChange("aadhaar_last4", e.target.value)}
        />
      </div>

      {isTenant && (
        <div className="mb-3">
          <label htmlFor={id("tenant_company_name")}>{lbl} Company Name (optional)</label>
          <input
            id={id("tenant_company_name")}
            type="text"
            className={inputCls}
            value={(fields as TenantFields).tenant_company_name}
            onChange={(e) => onChange("tenant_company_name", e.target.value)}
          />
        </div>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function Step1Form(props: StepFormProps) {
  const [owner, setOwner] = useState<TenantFields>({ ...ownerDefaults, tenant_company_name: "" });
  const [tenant, setTenant] = useState<TenantFields>({ ...tenantDefaults });
  const [errors, setErrors] = useState<string[]>([]);

  function updateOwner(key: keyof TenantFields, value: string) {
    setOwner((prev) => ({ ...prev, [key]: value }));
  }

  function updateTenant(key: keyof TenantFields, value: string) {
    setTenant((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const ownerPayload = buildPartyPayload(owner);
    const tenantPayload: Record<string, unknown> = {
      ...buildPartyPayload(tenant)
    };
    if (tenant.tenant_company_name.trim()) {
      tenantPayload.tenant_company_name = tenant.tenant_company_name.trim();
    }

    const payload = { owner: ownerPayload, tenant: tenantPayload };
    const result = step1Schema.safeParse(payload);

    if (!result.success) {
      const issues = result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`
      );
      setErrors(issues);
      return;
    }

    setErrors([]);
    await props.onSubmit(result.data);
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {errors.length > 0 && (
        <div className="mb-4 p-3 border border-red-400 rounded text-red-700">
          <p className="font-semibold">Please fix the following errors:</p>
          <ul className="list-disc list-inside">
            {errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      <PartySection prefix="owner" heading="Landlord" fields={owner} onChange={updateOwner} />

      <PartySection
        prefix="tenant"
        heading="Tenant"
        fields={tenant}
        onChange={updateTenant}
        isTenant
      />

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
