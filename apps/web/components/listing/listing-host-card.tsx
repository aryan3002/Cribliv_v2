import { BadgeCheck, Clock, Languages, MessageCircle, Shield } from "lucide-react";
import { t, type Locale } from "../../lib/i18n";

interface HostCardProps {
  firstName: string | null;
  memberSinceIso: string | null;
  preferredLanguage: string | null;
  whatsappAvailable: boolean;
  isVerified: boolean;
  isPending: boolean;
  noResponseRefund: boolean;
  locale: Locale;
}

function memberSinceYear(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return String(d.getFullYear());
}

function languagesLabel(pref: string | null, locale: Locale): string {
  if (locale === "hi" || pref === "hi") return "हिन्दी, English";
  return "English, हिन्दी";
}

export function ListingHostCard({
  firstName,
  memberSinceIso,
  preferredLanguage,
  whatsappAvailable,
  isVerified,
  isPending,
  noResponseRefund,
  locale
}: HostCardProps) {
  const displayName = firstName?.trim() || (locale === "hi" ? "ओनर" : "the owner");
  const initial = displayName.charAt(0).toUpperCase();
  const year = memberSinceYear(memberSinceIso);

  return (
    <div className="host-card">
      <div className="host-card__avatar" aria-hidden="true">
        {initial}
      </div>
      <div>
        <h3 className="host-card__title">
          {t(locale, "listedBy")} {displayName}
        </h3>
        <p className="host-card__sub">
          {year ? `${t(locale, "memberSince")} ${year}` : ""}
          {year && preferredLanguage ? " · " : ""}
          {languagesLabel(preferredLanguage, locale)}
        </p>
        <div className="host-card__pills">
          {isVerified && (
            <span className="host-pill host-pill--trust">
              <BadgeCheck size={12} aria-hidden="true" />
              {t(locale, "verifiedOwner")}
            </span>
          )}
          {isPending && (
            <span className="host-pill">
              <Clock size={12} aria-hidden="true" />
              Verification pending
            </span>
          )}
          {noResponseRefund && (
            <span className="host-pill host-pill--brand">
              <Shield size={12} aria-hidden="true" />
              {t(locale, "autoRefund12h")}
            </span>
          )}
          {whatsappAvailable && (
            <span className="host-pill host-pill--whatsapp">
              <MessageCircle size={12} aria-hidden="true" />
              {t(locale, "whatsappReady")}
            </span>
          )}
          <span className="host-pill">
            <Languages size={12} aria-hidden="true" />
            {languagesLabel(preferredLanguage, locale)}
          </span>
        </div>
      </div>
    </div>
  );
}
