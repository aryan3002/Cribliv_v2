"use client";
import { useState } from "react";
import type { CreateDemandSignalDto } from "@cribliv/shared-types";
import { postDemandSignal } from "../../../lib/demand-api";
import "./voice-map.css";

export function DemandCaptureSheet({
  prefill,
  onDone
}: {
  prefill: Omit<CreateDemandSignalDto, "phone" | "source">;
  onDone: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await postDemandSignal({ ...prefill, phone: phone.trim() || undefined, source: "voice_map" });
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mv-capture">
        <p>Got it — we'll text you when a match lists.</p>
        <button type="button" className="mv-card__cta" onClick={onDone}>
          Done
        </button>
      </div>
    );
  }
  return (
    <div className="mv-capture">
      <p className="mv-capture__lead">We don't have that yet. Want a text when one lists?</p>
      <input
        className="mv-capture__input"
        inputMode="tel"
        placeholder="Phone (optional)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <button type="button" className="mv-card__cta" disabled={busy} onClick={submit}>
        Notify me
      </button>
    </div>
  );
}
