"use client";

import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";

// pdf.js renders in a Web Worker. Load the worker from a CDN to avoid
// Terser build errors ("import.meta cannot be used outside of module code").
// Pin version to match the installed pdfjs-dist dependency.
pdfjs.GlobalWorkerOptions.workerSrc =
  "https://unpkg.com/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs";

type RenderStatus = "loading" | "ready" | "error";

/**
 * Overleaf-style in-page PDF viewer. Renders each page to a <canvas> — there is
 * no browser PDF toolbar, so no native download/print/save. The only way to
 * save the file is the wizard's own Download button.
 *
 * Pure: bytes in → canvas pages out. Knows nothing of the download counter.
 */
export function PdfPreview({ bytes }: { bytes: ArrayBuffer }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1.2);
  const [status, setStatus] = useState<RenderStatus>("loading");
  const [pageCount, setPageCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    setStatus("loading");

    // pdf.js detaches the ArrayBuffer it is given; hand it a copy so the
    // React Query-cached buffer stays usable for re-renders (e.g. on zoom).
    const data = bytes.slice(0);

    pdfjs
      .getDocument({ data })
      .promise.then(async (pdf) => {
        if (cancelled) return;
        container.innerHTML = "";
        setPageCount(pdf.numPages);
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          if (cancelled) return;
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.cssText =
            "display:block;margin:0 auto 12px;max-width:100%;box-shadow:0 1px 4px rgba(0,0,0,.18);background:#fff";
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          container.appendChild(canvas);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        }
        if (!cancelled) setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [bytes, scale]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <button
          type="button"
          className="ra-button-ghost"
          onClick={() => setScale((s) => Math.max(0.5, Math.round((s - 0.2) * 10) / 10))}
        >
          Zoom out
        </button>
        <span className="ra-muted">{Math.round(scale * 100)}%</span>
        <button
          type="button"
          className="ra-button-ghost"
          onClick={() => setScale((s) => Math.min(3, Math.round((s + 0.2) * 10) / 10))}
        >
          Zoom in
        </button>
        {status === "ready" && (
          <span className="ra-muted">
            {pageCount} page{pageCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {status === "loading" && <p className="ra-loading">Rendering preview…</p>}
      {status === "error" && <p className="ra-error">Could not render the preview.</p>}
      <div
        ref={containerRef}
        aria-label="Agreement preview"
        style={{
          maxHeight: 560,
          overflowY: "auto",
          background: "#e9e9e4",
          borderRadius: 8,
          padding: 12
        }}
      />
    </div>
  );
}
