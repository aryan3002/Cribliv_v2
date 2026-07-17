"use client";

import { useState } from "react";
import type { AdminListingPhotoVm } from "../../../lib/admin-api";
import { EmptyState } from "../primitives/EmptyState";

export function PhotoGallery({ photos }: { photos: AdminListingPhotoVm[] }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const usable = photos.filter((p) => p.url);

  if (usable.length === 0) {
    return <EmptyState title="No photos" hint="This submission has no images to review." />;
  }

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
          gap: 8
        }}
      >
        {usable.map((p, i) => (
          <div key={i} style={{ position: "relative", aspectRatio: "4 / 3" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.url!}
              alt={p.is_cover ? "Cover photo" : `Listing photo ${i + 1}`}
              loading="lazy"
              onClick={() => setLightbox(p.url)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                borderRadius: "var(--ad-radius-sm)",
                border: p.is_cover ? "2px solid var(--ad-brand)" : "1px solid var(--ad-border)",
                cursor: "zoom-in"
              }}
            />
            {p.is_cover && (
              <span
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  fontSize: 10,
                  fontWeight: 700,
                  color: "#fff",
                  background: "var(--ad-brand)",
                  borderRadius: 6,
                  padding: "2px 7px"
                }}
              >
                COVER
              </span>
            )}
            {p.moderation_status !== "approved" && (
              <span
                style={{
                  position: "absolute",
                  bottom: 6,
                  left: 6,
                  fontSize: 10,
                  fontWeight: 600,
                  color: "var(--ad-warning)",
                  background: "var(--ad-warning-soft)",
                  border: "1px solid #FDE68A",
                  borderRadius: 6,
                  padding: "1px 6px"
                }}
              >
                {p.moderation_status}
              </span>
            )}
          </div>
        ))}
      </div>

      {lightbox && (
        <div
          data-testid="photo-lightbox"
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.82)",
            zIndex: 1000,
            display: "grid",
            placeItems: "center",
            cursor: "zoom-out"
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightbox}
            alt="Listing photo enlarged"
            style={{ maxWidth: "92vw", maxHeight: "88vh", objectFit: "contain" }}
          />
        </div>
      )}
    </div>
  );
}
