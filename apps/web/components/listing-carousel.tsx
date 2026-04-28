"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ArrowRight } from "lucide-react";
import { ListingCardItem, type ListingCardData } from "./listing-card";

interface ListingCarouselProps {
  title: string;
  subtitle?: string;
  viewAllHref?: string;
  viewAllLabel?: string;
  items: ListingCardData[];
  locale: string;
}

export function ListingCarousel({
  title,
  subtitle,
  viewAllHref,
  viewAllLabel,
  items,
  locale
}: ListingCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(true);

  const updateState = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanPrev(scrollLeft > 8);
    setCanNext(scrollLeft + clientWidth < scrollWidth - 8);
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    updateState();
    const onScroll = () => updateState();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", updateState);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", updateState);
    };
  }, [updateState, items.length]);

  const scrollByDirection = (dir: 1 | -1) => {
    const el = trackRef.current;
    if (!el) return;
    // Scroll by ~80% of visible width
    const delta = el.clientWidth * 0.85 * dir;
    el.scrollBy({ left: delta, behavior: "smooth" });
  };

  if (!items || items.length === 0) return null;

  return (
    <section className="listing-row-section">
      <div className="listing-row-header">
        <div className="listing-row-header__text">
          <h2 className="listing-row-header__title">{title}</h2>
          {subtitle && <p className="listing-row-header__subtitle">{subtitle}</p>}
        </div>
        {viewAllHref && (
          <Link
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            href={viewAllHref as any}
            className="listing-row-header__action"
          >
            {viewAllLabel ?? (locale === "hi" ? "सभी देखें" : "View all")}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
      </div>

      <div className="listing-row-wrap">
        <button
          type="button"
          className={`listing-row__btn listing-row__btn--prev${canPrev ? "" : " is-hidden"}`}
          onClick={() => scrollByDirection(-1)}
          aria-label="Scroll left"
          tabIndex={canPrev ? 0 : -1}
        >
          <ChevronLeft size={18} />
        </button>

        <div ref={trackRef} className="listing-row" role="list">
          {items.map((item) => (
            <div key={item.id} className="listing-row__item" role="listitem">
              <ListingCardItem listing={item} locale={locale} compact />
            </div>
          ))}
        </div>

        <button
          type="button"
          className={`listing-row__btn listing-row__btn--next${canNext ? "" : " is-hidden"}`}
          onClick={() => scrollByDirection(1)}
          aria-label="Scroll right"
          tabIndex={canNext ? 0 : -1}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </section>
  );
}
