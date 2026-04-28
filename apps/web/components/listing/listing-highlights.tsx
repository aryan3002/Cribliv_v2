import { Bath, BedDouble, Home, Ruler, Sofa, Users } from "lucide-react";
import { t, type Locale } from "../../lib/i18n";

interface ListingHighlightsProps {
  locale: Locale;
  bhk?: number | null;
  bathrooms?: number | null;
  area_sqft?: number | null;
  furnishing?: string | null;
  listing_type: "flat_house" | "pg";
  pgTotalBeds?: number | null;
}

function furnishingLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value === "fully_furnished") return "Fully furnished";
  if (value === "semi_furnished") return "Semi-furnished";
  if (value === "unfurnished") return "Unfurnished";
  return value;
}

interface Chip {
  icon: typeof Home;
  label: string;
  sub?: string;
}

export function ListingHighlights(props: ListingHighlightsProps) {
  const chips: Chip[] = [];

  if (props.listing_type === "pg" && props.pgTotalBeds) {
    chips.push({
      icon: BedDouble,
      label: `${props.pgTotalBeds} ${props.pgTotalBeds === 1 ? "bed" : "beds"}`,
      sub: t(props.locale, "totalBeds")
    });
  }

  if (props.bhk) {
    chips.push({
      icon: Home,
      label: `${props.bhk} BHK`,
      sub: t(props.locale, "bhkLabel")
    });
  }

  if (props.bathrooms) {
    chips.push({
      icon: Bath,
      label: `${props.bathrooms} ${props.bathrooms === 1 ? "bath" : "baths"}`,
      sub: t(props.locale, "bathLabel")
    });
  }

  if (props.area_sqft) {
    chips.push({
      icon: Ruler,
      label: `${props.area_sqft.toLocaleString("en-IN")} sqft`,
      sub: t(props.locale, "areaLabel")
    });
  }

  const fLabel = furnishingLabel(props.furnishing);
  if (fLabel) {
    chips.push({
      icon: Sofa,
      label: fLabel,
      sub: t(props.locale, "furnishingLabel")
    });
  }

  chips.push({
    icon: props.listing_type === "pg" ? Users : Home,
    label: props.listing_type === "pg" ? "PG" : "Flat / House",
    sub: t(props.locale, "propertyTypeLabel")
  });

  if (chips.length === 0) return null;

  return (
    <div className="listing-highlights" role="list" aria-label={t(props.locale, "keyHighlights")}>
      {chips.map((chip, i) => {
        const Icon = chip.icon;
        return (
          <span
            key={`${chip.label}-${i}`}
            className="listing-highlight"
            role="listitem"
            style={{ ["--i" as string]: i }}
          >
            <Icon size={16} strokeWidth={2} aria-hidden="true" />
            {chip.label}
            {chip.sub && <span className="listing-highlight__sub">· {chip.sub}</span>}
          </span>
        );
      })}
    </div>
  );
}
