"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { segment } from "@/lib/pg-operator-api";

export default function PgSegmentForm({
  locale,
  router: routerOverride
}: {
  locale: string;
  router?: ReturnType<typeof useRouter>;
}) {
  const defaultRouter = useRouter();
  const router = routerOverride ?? defaultRouter;
  const [beds, setBeds] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSubmit = async () => {
    const n = parseInt(beds, 10);
    if (!Number.isInteger(n) || n < 1 || n > 500) {
      setErr("Enter 1 to 500");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await segment({ total_beds: n });
      router.push(`/${locale}${r.next_step}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="pg-segment-form">
      <h1>How big is your PG?</h1>
      <label>
        Total beds
        <input
          type="number"
          min={1}
          max={500}
          value={beds}
          onChange={(e) => setBeds(e.target.value)}
          aria-label="total beds"
        />
      </label>
      <button onClick={handleSubmit} disabled={busy}>
        Continue
      </button>
      {err && <p role="alert">{err}</p>}
    </section>
  );
}
