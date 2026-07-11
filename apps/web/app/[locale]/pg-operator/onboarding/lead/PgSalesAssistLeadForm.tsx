"use client";
import { useState } from "react";
import { submitSalesAssistLead } from "@/lib/pg-operator-api";

export default function PgSalesAssistLeadForm() {
  const [v, setV] = useState({ total_beds: "", city: "", phone: "", notes: "" });
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    try {
      await submitSalesAssistLead({
        total_beds: parseInt(v.total_beds, 10),
        city: v.city,
        phone: v.phone,
        notes: v.notes
      });
      setDone(true);
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (done) return <p>Thanks. We&apos;ll reach out within a business day.</p>;
  return (
    <section>
      <h1>Let&apos;s help you onboard</h1>
      <label>
        Total beds
        <input
          value={v.total_beds}
          onChange={(e) => setV({ ...v, total_beds: e.target.value })}
          aria-label="total beds"
        />
      </label>
      <label>
        City
        <input
          value={v.city}
          onChange={(e) => setV({ ...v, city: e.target.value })}
          aria-label="city"
        />
      </label>
      <label>
        Phone
        <input
          value={v.phone}
          onChange={(e) => setV({ ...v, phone: e.target.value })}
          aria-label="phone"
        />
      </label>
      <label>
        Notes
        <textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      </label>
      <button onClick={submit}>Submit</button>
      {err && <p role="alert">{err}</p>}
    </section>
  );
}
