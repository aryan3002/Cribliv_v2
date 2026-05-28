"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Wifi,
  Wind,
  Snowflake,
  Droplet,
  Tv,
  ParkingSquare,
  Zap,
  ArrowDownUp,
  ShieldCheck,
  Cctv,
  Dumbbell,
  Waves,
  ChefHat,
  Trees,
  Flame,
  ShowerHead,
  WashingMachine,
  Refrigerator,
  Utensils,
  Sparkles,
  Brush,
  Check,
  X,
  type LucideIcon
} from "lucide-react";
import { AMENITIES_FLAT, AMENITIES_PG } from "../listing-wizard/types";
import { t, type Locale } from "../../lib/i18n";

type AmenityCategoryKey =
  | "connectivity"
  | "comfort"
  | "safety"
  | "lifestyle"
  | "kitchen"
  | "services"
  | "other";

interface AmenityMeta {
  icon: LucideIcon;
  category: AmenityCategoryKey;
  caption?: string;
}

const AMENITY_META: Record<string, AmenityMeta> = {
  WiFi: { icon: Wifi, category: "connectivity", caption: "High-speed broadband" },
  AC: { icon: Snowflake, category: "comfort", caption: "Air conditioning" },
  Geyser: { icon: ShowerHead, category: "comfort", caption: "Hot water" },
  "Washing Machine": { icon: WashingMachine, category: "kitchen" },
  Fridge: { icon: Refrigerator, category: "kitchen" },
  TV: { icon: Tv, category: "lifestyle" },
  Parking: { icon: ParkingSquare, category: "lifestyle", caption: "Dedicated parking spot" },
  "Power Backup": { icon: Zap, category: "comfort", caption: "Inverter / generator" },
  "Gas Pipeline": { icon: Flame, category: "kitchen" },
  Lift: { icon: ArrowDownUp, category: "comfort" },
  Security: { icon: ShieldCheck, category: "safety", caption: "24x7 guard" },
  CCTV: { icon: Cctv, category: "safety" },
  Gym: { icon: Dumbbell, category: "lifestyle" },
  "Swimming Pool": { icon: Waves, category: "lifestyle" },
  Balcony: { icon: Trees, category: "lifestyle" },
  Kitchen: { icon: ChefHat, category: "kitchen" },
  "Water Purifier": { icon: Droplet, category: "kitchen" },
  Meals: { icon: Utensils, category: "services", caption: "Tiffin / mess included" },
  Laundry: { icon: WashingMachine, category: "services" },
  Housekeeping: { icon: Brush, category: "services" }
};

function metaFor(name: string): AmenityMeta {
  return AMENITY_META[name] ?? { icon: Sparkles, category: "other" };
}

const CATEGORY_ORDER: AmenityCategoryKey[] = [
  "connectivity",
  "comfort",
  "safety",
  "lifestyle",
  "kitchen",
  "services",
  "other"
];

function categoryLabel(locale: Locale, key: AmenityCategoryKey): string {
  switch (key) {
    case "connectivity":
      return t(locale, "amenityCategoryConnectivity");
    case "comfort":
      return t(locale, "amenityCategoryComfort");
    case "safety":
      return t(locale, "amenityCategorySafety");
    case "lifestyle":
      return t(locale, "amenityCategoryLifestyle");
    case "kitchen":
      return t(locale, "amenityCategoryKitchen");
    case "services":
      return t(locale, "amenityCategoryServices");
    case "other":
      return t(locale, "amenityCategoryOther");
  }
}

interface ListingAmenitiesProps {
  amenities: string[];
  listing_type: "flat_house" | "pg";
  locale: Locale;
  preview?: number;
}

export function ListingAmenities({
  amenities,
  listing_type,
  locale,
  preview = 8
}: ListingAmenitiesProps) {
  const offered = useMemo(() => new Set(amenities), [amenities]);
  const canonical = listing_type === "pg" ? AMENITIES_PG : AMENITIES_FLAT;
  // Custom amenities not in canonical list (e.g. from voice agent)
  const extras = amenities.filter((a) => !canonical.includes(a));
  const fullList = [...canonical, ...extras];

  // Sort: offered first (in canonical order), unavailable after
  const ordered = [
    ...fullList.filter((a) => offered.has(a)),
    ...fullList.filter((a) => !offered.has(a))
  ];

  const previewItems = ordered.slice(0, preview);
  const hasMore = ordered.length > preview;

  const [open, setOpen] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const openModal = useCallback(() => {
    previousFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    setOpen(true);
  }, []);
  const closeModal = useCallback(() => {
    setOpen(false);
    previousFocusRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    closeBtnRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, closeModal]);

  // Group all amenities by category for the modal
  const grouped = useMemo(() => {
    const map = new Map<AmenityCategoryKey, string[]>();
    for (const name of ordered) {
      const cat = metaFor(name).category;
      const arr = map.get(cat) ?? [];
      arr.push(name);
      map.set(cat, arr);
    }
    return map;
  }, [ordered]);

  return (
    <>
      <div className="amenity-grid--detail">
        {previewItems.map((name) => {
          const meta = metaFor(name);
          const isAvailable = offered.has(name);
          const Icon = meta.icon;
          return (
            <div
              key={name}
              className={`amenity-row${isAvailable ? "" : " amenity-row--unavailable"}`}
            >
              <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
              <div>
                <span className="amenity-row__label">{name}</span>
                {meta.caption && isAvailable && (
                  <span className="amenity-row__caption">{meta.caption}</span>
                )}
                {!isAvailable && (
                  <span className="amenity-row__caption">{t(locale, "notIncluded")}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button type="button" className="amenity-show-all" onClick={openModal}>
          {t(locale, "showAllAmenities")} · {ordered.length}
        </button>
      )}

      {open && (
        <div
          className="amenity-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t(locale, "whatThisPlaceOffers")}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="amenity-modal__panel">
            <div className="amenity-modal__head">
              <h3>{t(locale, "whatThisPlaceOffers")}</h3>
              <button
                ref={closeBtnRef}
                type="button"
                className="amenity-modal__close"
                onClick={closeModal}
                aria-label={t(locale, "closeLabel")}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="amenity-modal__body">
              {CATEGORY_ORDER.map((cat) => {
                const items = grouped.get(cat);
                if (!items || items.length === 0) return null;
                return (
                  <section key={cat} className="amenity-group">
                    <h4 className="amenity-group__title">{categoryLabel(locale, cat)}</h4>
                    <div className="amenity-grid--detail">
                      {items.map((name) => {
                        const meta = metaFor(name);
                        const isAvailable = offered.has(name);
                        const Icon = meta.icon;
                        return (
                          <div
                            key={name}
                            className={`amenity-row${
                              isAvailable ? "" : " amenity-row--unavailable"
                            }`}
                          >
                            <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
                            <div>
                              <span className="amenity-row__label">{name}</span>
                              {isAvailable ? (
                                meta.caption && (
                                  <span className="amenity-row__caption">
                                    <Check
                                      size={12}
                                      style={{ verticalAlign: "-1px" }}
                                      aria-hidden="true"
                                    />{" "}
                                    {meta.caption}
                                  </span>
                                )
                              ) : (
                                <span className="amenity-row__caption">
                                  {t(locale, "notIncluded")}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
