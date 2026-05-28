import {
  BadgeCheck,
  Calendar,
  Check,
  ChefHat,
  Clock,
  ShieldCheck,
  Users,
  Utensils,
  X
} from "lucide-react";
import { t, type Locale } from "../../lib/i18n";

interface PgDetailsBlock {
  total_beds?: number | null;
  occupancy_type?: string | null;
  room_sharing_options?: string[] | null;
  food_included?: boolean | null;
  curfew_time?: string | null;
  attached_bathroom?: boolean | null;
}

interface ThingsToKnowProps {
  locale: Locale;
  listing_type: "flat_house" | "pg";
  available_from: string | null;
  security_deposit: number | null;
  preferred_tenant: string | null;
  rules: Record<string, unknown> | null;
  pg_details?: PgDetailsBlock | null;
}

function formatDate(iso: string | null, locale: Locale): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  if (d.getTime() <= now.getTime()) return t(locale, "availableNow");
  return d.toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric"
  });
}

function tenantLabel(value: string | null, locale: Locale): string | null {
  if (!value) return null;
  const map: Record<string, { en: string; hi: string }> = {
    any: { en: "Anyone welcome", hi: "कोई भी" },
    family: { en: "Families", hi: "परिवार" },
    bachelor: { en: "Bachelors", hi: "बैचलर" },
    female: { en: "Female only", hi: "केवल महिलाएं" },
    male: { en: "Male only", hi: "केवल पुरुष" }
  };
  const e = map[value];
  return e ? e[locale] : value;
}

function occupancyLabel(value: string | null, locale: Locale): string | null {
  if (!value) return null;
  const map: Record<string, { en: string; hi: string }> = {
    male: { en: "Male PG", hi: "लड़कों का PG" },
    female: { en: "Female PG", hi: "लड़कियों का PG" },
    co_living: { en: "Co-living", hi: "को-लिविंग" }
  };
  const e = map[value];
  return e ? e[locale] : value;
}

function rulesAsList(
  rules: Record<string, unknown> | null,
  locale: Locale
): { allowed: boolean; label: string }[] {
  // Default rental house rules — used when DB rules JSON is empty
  const defaults: { allowed: boolean; label: string }[] = [
    {
      allowed: false,
      label: locale === "hi" ? "घर के अंदर धूम्रपान नहीं" : "No smoking inside the unit"
    },
    {
      allowed: true,
      label: locale === "hi" ? "ओनर की अनुमति से पालतू जानवर" : "Pets allowed with owner approval"
    },
    {
      allowed: false,
      label: locale === "hi" ? "रात 11 बजे के बाद तेज़ आवाज़ नहीं" : "No loud noise after 11 PM"
    }
  ];

  if (!rules || typeof rules !== "object") return defaults;

  const items: { allowed: boolean; label: string }[] = [];
  for (const [key, val] of Object.entries(rules)) {
    if (typeof val === "boolean") {
      const niceKey = key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
      items.push({ allowed: val, label: niceKey });
    } else if (typeof val === "string" && val.length > 0) {
      items.push({ allowed: true, label: `${key.replace(/_/g, " ")}: ${val}` });
    }
  }
  return items.length > 0 ? items : defaults;
}

export function ListingThingsToKnow(props: ThingsToKnowProps) {
  const moveIn = formatDate(props.available_from, props.locale);
  const tenant = tenantLabel(props.preferred_tenant, props.locale);
  const ruleItems = rulesAsList(props.rules, props.locale);

  const isPg = props.listing_type === "pg" && props.pg_details;

  return (
    <div className="things-grid">
      {/* Card 1 — Move-in & lease */}
      <div className="things-card">
        <div className="things-card__head">
          <Calendar size={18} aria-hidden="true" />
          {t(props.locale, "moveInAndLease")}
        </div>
        <ul className="things-card__list">
          {moveIn && (
            <li className="things-card__item things-card__item--allow">
              <Check size={16} aria-hidden="true" />
              <span>
                <strong>{t(props.locale, "availableFrom")}:</strong> {moveIn}
              </span>
            </li>
          )}
          {props.security_deposit !== null && props.security_deposit !== undefined && (
            <li className="things-card__item things-card__item--allow">
              <Check size={16} aria-hidden="true" />
              <span>
                <strong>Deposit:</strong> ₹{props.security_deposit.toLocaleString("en-IN")}
              </span>
            </li>
          )}
          <li className="things-card__item things-card__item--allow">
            <Check size={16} aria-hidden="true" />
            <span>
              <strong>{t(props.locale, "leaseTerm")}</strong>
            </span>
          </li>
          {isPg && props.pg_details?.curfew_time && (
            <li className="things-card__item things-card__item--deny">
              <Clock size={16} aria-hidden="true" />
              <span>
                <strong>{t(props.locale, "curfew")}:</strong> {props.pg_details.curfew_time}
              </span>
            </li>
          )}
        </ul>
      </div>

      {/* Card 2 — Tenant prefs / PG details */}
      <div className="things-card">
        <div className="things-card__head">
          <Users size={18} aria-hidden="true" />
          {isPg ? "PG details" : t(props.locale, "tenantPreferences")}
        </div>
        <ul className="things-card__list">
          {!isPg && tenant && (
            <li className="things-card__item things-card__item--allow">
              <Check size={16} aria-hidden="true" />
              <span>{tenant}</span>
            </li>
          )}
          {!isPg &&
            ruleItems.map((r, i) => (
              <li
                key={i}
                className={`things-card__item ${
                  r.allowed ? "things-card__item--allow" : "things-card__item--deny"
                }`}
              >
                {r.allowed ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <X size={16} aria-hidden="true" />
                )}
                <span>{r.label}</span>
              </li>
            ))}

          {isPg && props.pg_details && (
            <>
              {props.pg_details.total_beds != null && (
                <li className="things-card__item things-card__item--allow">
                  <Check size={16} aria-hidden="true" />
                  <span>
                    <strong>{t(props.locale, "totalBeds")}:</strong> {props.pg_details.total_beds}
                  </span>
                </li>
              )}
              {props.pg_details.occupancy_type && (
                <li className="things-card__item things-card__item--allow">
                  <Check size={16} aria-hidden="true" />
                  <span>
                    <strong>{t(props.locale, "occupancyType")}:</strong>{" "}
                    {occupancyLabel(props.pg_details.occupancy_type, props.locale)}
                  </span>
                </li>
              )}
              {props.pg_details.room_sharing_options &&
                props.pg_details.room_sharing_options.length > 0 && (
                  <li className="things-card__item things-card__item--allow">
                    <Check size={16} aria-hidden="true" />
                    <span>
                      <strong>{t(props.locale, "sharing")}:</strong>{" "}
                      {props.pg_details.room_sharing_options.join(", ")}
                    </span>
                  </li>
                )}
              <li
                className={`things-card__item ${
                  props.pg_details.food_included
                    ? "things-card__item--allow"
                    : "things-card__item--deny"
                }`}
              >
                {props.pg_details.food_included ? (
                  <Utensils size={16} aria-hidden="true" />
                ) : (
                  <ChefHat size={16} aria-hidden="true" />
                )}
                <span>
                  <strong>{t(props.locale, "mealsIncluded")}:</strong>{" "}
                  {props.pg_details.food_included
                    ? props.locale === "hi"
                      ? "हाँ"
                      : "Yes"
                    : props.locale === "hi"
                      ? "नहीं"
                      : "No"}
                </span>
              </li>
              <li
                className={`things-card__item ${
                  props.pg_details.attached_bathroom
                    ? "things-card__item--allow"
                    : "things-card__item--deny"
                }`}
              >
                {props.pg_details.attached_bathroom ? (
                  <Check size={16} aria-hidden="true" />
                ) : (
                  <X size={16} aria-hidden="true" />
                )}
                <span>
                  <strong>{t(props.locale, "attachedBath")}</strong>
                </span>
              </li>
            </>
          )}
        </ul>
      </div>

      {/* Card 3 — Cribliv guarantees */}
      <div className="things-card">
        <div className="things-card__head">
          <ShieldCheck size={18} aria-hidden="true" />
          {t(props.locale, "criblivGuarantees")}
        </div>
        <ul className="things-card__list">
          <li className="things-card__item things-card__item--allow">
            <BadgeCheck size={16} aria-hidden="true" />
            <span>
              <strong>{t(props.locale, "verifiedOwner")}</strong>
            </span>
          </li>
          <li className="things-card__item things-card__item--allow">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>{t(props.locale, "autoRefund12h")}</span>
          </li>
          <li className="things-card__item things-card__item--allow">
            <Check size={16} aria-hidden="true" />
            <span>{t(props.locale, "noBrokerSpam")}</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
