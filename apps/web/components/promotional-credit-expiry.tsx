import { t, type Locale } from "../lib/i18n";
import { formatSignupRewardExpiry } from "../lib/welcome-credits";

interface PromotionalCreditExpiryProps {
  remaining: number;
  expiresAt: string | null;
  locale: Locale;
}

export function PromotionalCreditExpiry({
  remaining,
  expiresAt,
  locale
}: PromotionalCreditExpiryProps) {
  if (remaining <= 0 || !expiresAt) return null;

  const date = formatSignupRewardExpiry(expiresAt, locale);
  if (!date) return null;

  const message = t(locale, "promotionalCreditExpiry")
    .replace("{credits}", String(remaining))
    .replace("{date}", date);

  return (
    <p className="caption text-tertiary" style={{ marginTop: "var(--space-2)", marginBottom: 0 }}>
      {message}
    </p>
  );
}
