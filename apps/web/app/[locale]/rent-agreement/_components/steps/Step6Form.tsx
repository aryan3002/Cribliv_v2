"use client";

import { useState } from "react";
import type { StepFormProps } from "./types";
import { useApiClient } from "@/lib/rent-agreement/hooks/use-api-client";
import { RentAgreementApi } from "@/lib/rent-agreement/api/endpoints";

type UploadStatus = "idle" | "uploading" | "saved" | "error";

interface PartyState {
  status: UploadStatus;
  error?: string;
}

function readFileAsBase64(
  file: File
): Promise<{ base64: string; contentType: "image/png" | "image/jpeg" }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix: "data:image/png;base64," -> raw base64
      const base64 = result.split(",")[1];
      const contentType = file.type as "image/png" | "image/jpeg";
      resolve({ base64, contentType });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function Step6Form(props: StepFormProps) {
  const client = useApiClient();
  const [landlord, setLandlord] = useState<PartyState>({ status: "idle" });
  const [tenant, setTenant] = useState<PartyState>({ status: "idle" });

  const landlordInputId = "sig-landlord";
  const tenantInputId = "sig-tenant";

  async function handleFileChange(
    file: File,
    party: "owner" | "tenant",
    setState: (s: PartyState) => void
  ) {
    setState({ status: "uploading" });
    try {
      const { base64, contentType } = await readFileAsBase64(file);
      await client.request(
        RentAgreementApi.signature(props.agreementId, {
          party,
          method: "upload",
          image_b64: base64,
          content_type: contentType
        })
      );
      setState({ status: "saved" });
    } catch (err) {
      setState({ status: "error", error: err instanceof Error ? err.message : "Upload failed" });
    }
  }

  const bothSaved = landlord.status === "saved" && tenant.status === "saved";

  function statusLabel(state: PartyState) {
    if (state.status === "uploading") return <span className="ra-muted">Uploading…</span>;
    if (state.status === "saved")
      return <span className="ra-status ra-status--generated">✓ Saved</span>;
    if (state.status === "error") return <span className="ra-inline-error">{state.error}</span>;
    return null;
  }

  async function handleAdvance() {
    await props.onSubmit({ confirm: true });
  }

  return (
    <div className="ra-form">
      <section className="ra-form-section">
        <h2 className="ra-form-section-title">Signatures</h2>
        <div className="ra-upload-grid">
          <div className="ra-upload-box">
            <label htmlFor={landlordInputId} className="ra-label">
              Landlord signature
            </label>
            <input
              id={landlordInputId}
              type="file"
              accept="image/png,image/jpeg"
              className="ra-input"
              disabled={landlord.status === "uploading"}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileChange(file, "owner", setLandlord);
              }}
            />
            {statusLabel(landlord)}
          </div>

          <div className="ra-upload-box">
            <label htmlFor={tenantInputId} className="ra-label">
              Tenant signature
            </label>
            <input
              id={tenantInputId}
              type="file"
              accept="image/png,image/jpeg"
              className="ra-input"
              disabled={tenant.status === "uploading"}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileChange(file, "tenant", setTenant);
              }}
            />
            {statusLabel(tenant)}
          </div>
        </div>
      </section>

      <button
        type="button"
        onClick={handleAdvance}
        disabled={!bothSaved || props.busy}
        className="ra-button"
      >
        {props.busy ? "Submitting…" : "Save and continue"}
        <span className="sr-only">Advance</span>
      </button>
    </div>
  );
}
