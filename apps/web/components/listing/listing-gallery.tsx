"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Grid3x3, X } from "lucide-react";
import { t, type Locale } from "../../lib/i18n";

interface ListingGalleryProps {
  photos: string[];
  title: string;
  locale: Locale;
}

export function ListingGallery({ photos, title, locale }: ListingGalleryProps) {
  const [open, setOpen] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const openLightbox = useCallback(() => {
    previousFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    setOpen(true);
  }, []);

  const closeLightbox = useCallback(() => {
    setOpen(false);
    previousFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeLightbox();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, closeLightbox]);

  if (!photos || photos.length === 0) {
    return (
      <div className="gallery-placeholder">
        <Camera size={40} strokeWidth={1.5} style={{ color: "var(--text-tertiary)" }} />
        <span>Photos coming soon</span>
      </div>
    );
  }

  const showAllLabel = `${t(locale, "showAllPhotos")} · ${photos.length}`;

  return (
    <>
      <div className="gallery">
        <div
          className="gallery__main"
          onClick={openLightbox}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openLightbox();
            }
          }}
          aria-label={showAllLabel}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photos[0]} alt={title} loading="eager" />
        </div>
        {photos.slice(1, 5).map((url, i) => (
          <div
            key={url}
            className="gallery__thumb"
            onClick={openLightbox}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openLightbox();
              }
            }}
            aria-label={showAllLabel}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`${title} - photo ${i + 2}`} loading="lazy" />
          </div>
        ))}
        <button
          type="button"
          className="gallery__overlay-btn"
          onClick={openLightbox}
          aria-label={showAllLabel}
        >
          <Grid3x3 size={14} aria-hidden="true" />
          {showAllLabel}
        </button>
      </div>

      {open && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={t(locale, "showAllPhotos")}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeLightbox();
          }}
        >
          <div className="lightbox__topbar">
            <span className="lightbox__count">
              {photos.length} {photos.length === 1 ? "photo" : "photos"}
            </span>
            <button
              ref={closeBtnRef}
              type="button"
              className="lightbox__close"
              onClick={closeLightbox}
              aria-label={t(locale, "closeLabel")}
            >
              <X size={18} aria-hidden="true" />
              {t(locale, "closeLabel")}
            </button>
          </div>
          <div className="lightbox__scroll">
            {photos.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={url}
                src={url}
                alt={`${title} — photo ${i + 1}`}
                className="lightbox__img"
                loading={i < 2 ? "eager" : "lazy"}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}
