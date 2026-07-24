"use client";

import type { MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { t, type Locale } from "../../lib/i18n";
import styles from "./notify-availability-button.module.css";

export interface NotifyAvailabilityButtonProps {
  listingId: string;
  locale: string;
  variant: "inline" | "primary";
  /**
   * Optional extra side-effect, mainly useful for tests/composition. Runs
   * after navigation is kicked off.
   */
  onClick?: () => void;
}

// primary reuses the exact same copy already established by Tasks 8/10/13/15
// for unlock-contact-panel.tsx / listing/[listingId]/page.tsx.
const LABEL_KEY: Record<NotifyAvailabilityButtonProps["variant"], string> = {
  inline: "availNotifyCard",
  primary: "availNotifyButton"
};

/**
 * Shared "notify me when available" trigger for a listing marked
 * `is_available: false`. Used inline on the search card (Task 10).
 *
 * Task 13 deliberately simplified the original plan here: rather than a
 * shared `useNotifyAvailability(listingId)` hook running the full OTP→join
 * flow inside this tiny card (poor UX — a phone-number + OTP form crammed
 * into a search-result card), this button just navigates to the listing
 * detail page, where `UnlockContactPanel` owns the real OTP→join-waitlist
 * flow end to end.
 */
export function NotifyAvailabilityButton({
  listingId,
  locale,
  variant,
  onClick
}: NotifyAvailabilityButtonProps) {
  const router = useRouter();

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    // Card usage sits inside the card's outer <Link> (same as the existing
    // heart/save button) — stop the tap from navigating via that Link before
    // we send it to the exact same destination ourselves.
    event.preventDefault();
    event.stopPropagation();

    router.push(`/${locale}/listing/${listingId}` as any);
    onClick?.();
  }

  return (
    <button
      type="button"
      className={`${styles.notifyButton} ${variant === "primary" ? styles.primary : styles.inline}`}
      onClick={handleClick}
      data-listing-id={listingId}
      data-locale={locale}
    >
      <Bell size={variant === "primary" ? 14 : 12} aria-hidden="true" />
      {t(locale as Locale, LABEL_KEY[variant])}
    </button>
  );
}
