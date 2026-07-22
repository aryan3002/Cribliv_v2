"use client";

import type { MouseEvent } from "react";
import { Bell } from "lucide-react";
import styles from "./notify-availability-button.module.css";

export interface NotifyAvailabilityButtonProps {
  listingId: string;
  locale: string;
  variant: "inline" | "primary";
  /**
   * Optional override, mainly useful for tests/composition. Task 13 wires the
   * real OTP → waitlist flow here (via a shared `useNotifyAvailability(listingId)`
   * hook, per the plan) so this component's signature doesn't need to change.
   */
  onClick?: () => void;
}

const LABEL: Record<NotifyAvailabilityButtonProps["variant"], string> = {
  inline: "Notify me",
  primary: "Notify when available"
};

/**
 * Shared "notify me when available" trigger for a listing marked
 * `is_available: false`. Used inline on the search card (Task 10) and, once
 * Task 13 lands, as the primary detail-page CTA that replaces "Request
 * Callback". `listingId`/`locale` are threaded through now so Task 13 can
 * wire the real flow without changing this component's public signature.
 */
export function NotifyAvailabilityButton({
  listingId,
  locale,
  variant,
  onClick
}: NotifyAvailabilityButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    // Card usage sits inside the card's outer <Link> (same as the existing
    // heart/save button) — stop the tap from navigating away before the
    // (future) OTP flow gets a chance to run.
    event.preventDefault();
    event.stopPropagation();

    // TODO(Task 13): wire OTP→join waitlist flow — POST
    // /listings/:id/availability-alerts via a shared
    // useNotifyAvailability(listingId) hook shared with the detail page.
    // Intentionally a no-op until then: do not fake a success state here.
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
      {LABEL[variant]}
    </button>
  );
}
