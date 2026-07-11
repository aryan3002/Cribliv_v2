"use client";

import { useRef, useState } from "react";
import type { StepFormProps } from "./types";
import { useApiClient } from "@/lib/rent-agreement/hooks/use-api-client";
import { RentAgreementApi } from "@/lib/rent-agreement/api/endpoints";

type Status = "idle" | "saving" | "saved" | "error";
type Mode = "draw" | "upload";

/**
 * Downscale + re-encode an uploaded image so the base64 request body stays
 * well under the API body-size limit (fixes HTTP 413 on signature upload).
 * A signature does not need detail — 600px JPEG q0.72 is a few tens of KB.
 */
async function compressUpload(
  file: File
): Promise<{ dataUrl: string; base64: string; contentType: "image/jpeg" }> {
  const sourceUrl: string = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error ?? new Error("read failed"));
    r.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error("invalid image"));
    i.src = sourceUrl;
  });
  const maxW = 600;
  const scale = Math.min(1, maxW / (img.width || maxW));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((img.width || maxW) * scale));
  canvas.height = Math.max(1, Math.round((img.height || maxW) * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
  return { dataUrl, base64: dataUrl.split(",")[1], contentType: "image/jpeg" };
}

const previewStyle: React.CSSProperties = {
  maxWidth: "100%",
  maxHeight: 150,
  border: "1px solid #cfcfc8",
  borderRadius: 8,
  background: "#fff",
  objectFit: "contain"
};

/** One party's signature — draw on a canvas OR upload a photo. */
function SignatureCapture(props: {
  label: string;
  party: "owner" | "tenant";
  agreementId: string;
  onSaved: () => void;
}) {
  const client = useApiClient();
  const [mode, setMode] = useState<Mode>("draw");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  function pointerPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height
    };
  }
  function startStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    const g = canvasRef.current?.getContext("2d");
    if (!g) return;
    drawing.current = true;
    g.lineWidth = 2.5;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#1b1b18";
    const p = pointerPos(e);
    g.beginPath();
    g.moveTo(p.x, p.y);
    canvasRef.current?.setPointerCapture(e.pointerId);
  }
  function moveStroke(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const g = canvasRef.current?.getContext("2d");
    if (!g) return;
    const p = pointerPos(e);
    g.lineTo(p.x, p.y);
    g.stroke();
    if (!hasInk) setHasInk(true);
  }
  function endStroke() {
    drawing.current = false;
  }
  function clearCanvas() {
    const c = canvasRef.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  }

  const ready = mode === "draw" ? hasInk : file !== null;

  async function save() {
    setStatus("saving");
    setError(null);
    try {
      let body;
      let captured: string;
      if (mode === "draw") {
        const c = canvasRef.current;
        if (!c || !hasInk) throw new Error("Draw a signature first");
        captured = c.toDataURL("image/png");
        body = {
          party: props.party,
          method: "canvas" as const,
          image_b64: captured.split(",")[1],
          content_type: "image/png" as const
        };
      } else {
        if (!file) throw new Error("Choose an image first");
        const { dataUrl, base64, contentType } = await compressUpload(file);
        captured = dataUrl;
        body = {
          party: props.party,
          method: "upload" as const,
          image_b64: base64,
          content_type: contentType
        };
      }
      await client.request(RentAgreementApi.signature(props.agreementId, body));
      setPreview(captured);
      setStatus("saved");
      props.onSaved();
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  const locked = status === "saved";

  return (
    <div className="ra-upload-box">
      <span className="ra-label">{props.label}</span>

      {/* Saved — show the stored signature, keep it visible. */}
      {locked && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {preview && <img src={preview} alt={`${props.label} preview`} style={previewStyle} />}
          <span className="ra-status ra-status--generated">✓ Saved</span>
          <button
            type="button"
            onClick={() => {
              setStatus("idle");
              setPreview(null);
              setFile(null);
              setHasInk(false);
              clearCanvas();
            }}
            className="ra-button-ghost"
          >
            Replace signature
          </button>
        </div>
      )}

      {!locked && (
        <div
          role="tablist"
          aria-label={`${props.label} method`}
          style={{ display: "flex", gap: 6 }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "draw"}
            onClick={() => setMode("draw")}
            className={mode === "draw" ? "ra-button" : "ra-button-ghost"}
          >
            Draw
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "upload"}
            onClick={() => setMode("upload")}
            className={mode === "upload" ? "ra-button" : "ra-button-ghost"}
          >
            Upload
          </button>
        </div>
      )}

      {!locked && mode === "draw" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <canvas
            ref={canvasRef}
            width={600}
            height={180}
            aria-label={`${props.label} drawing pad`}
            onPointerDown={startStroke}
            onPointerMove={moveStroke}
            onPointerUp={endStroke}
            onPointerLeave={endStroke}
            style={{
              width: "100%",
              height: 150,
              border: "1px solid #cfcfc8",
              borderRadius: 8,
              background: "#fff",
              touchAction: "none",
              cursor: "crosshair"
            }}
          />
          <button type="button" onClick={clearCanvas} className="ra-button-ghost">
            Clear
          </button>
        </div>
      )}

      {!locked && mode === "upload" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <input
            type="file"
            accept="image/png,image/jpeg"
            aria-label={`${props.label} file`}
            className="ra-input"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setStatus("idle");
              setPreview(f ? URL.createObjectURL(f) : null);
            }}
          />
          {preview && <img src={preview} alt={`${props.label} preview`} style={previewStyle} />}
        </div>
      )}

      {!locked && (
        <button
          type="button"
          onClick={save}
          disabled={!ready || status === "saving"}
          className="ra-button"
        >
          {status === "saving" ? "Saving…" : "Save signature"}
        </button>
      )}

      {status === "error" && error && <span className="ra-inline-error">{error}</span>}
    </div>
  );
}

export function Step6Form(props: StepFormProps) {
  const [ownerSaved, setOwnerSaved] = useState(false);
  const [tenantSaved, setTenantSaved] = useState(false);
  const bothSaved = ownerSaved && tenantSaved;

  return (
    <div className="ra-form">
      <section className="ra-form-section">
        <h2 className="ra-form-section-title">Signatures</h2>
        <p className="ra-hint">
          Both parties must sign. Draw with a mouse/touch, or upload a photo of a signature.
        </p>
        <div className="ra-upload-grid">
          <SignatureCapture
            label="Landlord signature"
            party="owner"
            agreementId={props.agreementId}
            onSaved={() => setOwnerSaved(true)}
          />
          <SignatureCapture
            label="Tenant signature"
            party="tenant"
            agreementId={props.agreementId}
            onSaved={() => setTenantSaved(true)}
          />
        </div>
      </section>

      <button
        type="button"
        onClick={() => props.onSubmit({ confirm: true })}
        disabled={!bothSaved || props.busy}
        className="ra-button"
      >
        {props.busy ? "Submitting…" : "Save and continue"}
      </button>
    </div>
  );
}
