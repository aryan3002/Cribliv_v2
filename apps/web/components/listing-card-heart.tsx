"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Heart } from "lucide-react";
import { readAuthSession, readGuestShortlist, toggleGuestShortlist } from "../lib/client-auth";
import { fetchApi } from "../lib/api";
import { trackEvent } from "../lib/analytics";
import styles from "./listing-card.module.css";

/**
 * Interactive save/heart for listing cards.
 *
 * The card heart used to be a dead `onClick={(e) => e.preventDefault()}` no-op,
 * so tapping it saved nothing and the Saved Homes page always looked empty. This
 * reuses the same persistence the detail-page "Save" button uses (guest
 * localStorage for anonymous users, `POST/DELETE /shortlist` for logged-in
 * users) so saves land in the very store the Saved Homes page reads.
 */
export function ListingCardHeart({ listingId }: { listingId: string }) {
  const { data: nextAuthSession, status: sessionStatus } = useSession();
  const [saved, setSaved] = useState(false);
  const [toggling, setToggling] = useState(false);

  function getToken(): string | null {
    const stored = readAuthSession();
    const nextAuthToken = (nextAuthSession as { accessToken?: string } | null)?.accessToken ?? null;
    return stored?.access_token ?? nextAuthToken;
  }

  // Initialise saved state from API (logged in) or localStorage (guest).
  useEffect(() => {
    if (sessionStatus === "loading") return;
    const token = getToken();

    if (!token) {
      setSaved(readGuestShortlist().includes(listingId));
    } else {
      void fetchApi<{ items: { id: string }[]; total: number }>("/shortlist", {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((res) => setSaved(res.items.some((item) => item.id === listingId)))
        .catch(() => {
          /* default to not saved */
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId, sessionStatus, nextAuthSession]);

  const onToggle = async (e: React.MouseEvent) => {
    // The heart sits inside the card's <Link>; stop the tap from navigating.
    e.preventDefault();
    e.stopPropagation();
    if (toggling) return;
    setToggling(true);

    const token = getToken();

    if (!token) {
      const result = toggleGuestShortlist(listingId);
      setSaved(result.active);
      trackEvent(result.active ? "shortlist_added" : "shortlist_removed", {
        listing_id: listingId,
        is_guest: true
      });
      setToggling(false);
      return;
    }

    try {
      if (saved) {
        await fetchApi<{ success: true }>(`/shortlist/${listingId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` }
        });
        setSaved(false);
        trackEvent("shortlist_removed", { listing_id: listingId, is_guest: false });
      } else {
        await fetchApi<{ shortlist_id: string }>("/shortlist", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: JSON.stringify({ listing_id: listingId })
        });
        setSaved(true);
        trackEvent("shortlist_added", { listing_id: listingId, is_guest: false });
      }
    } catch {
      /* silently ignore — state stays as-is */
    } finally {
      setToggling(false);
    }
  };

  return (
    <button
      type="button"
      className={styles.heart}
      aria-label={saved ? "Remove from saved" : "Save"}
      aria-pressed={saved}
      disabled={toggling || sessionStatus === "loading"}
      onClick={onToggle}
    >
      <Heart
        size={15}
        fill={saved ? "var(--accent)" : "transparent"}
        color={saved ? "var(--accent)" : "currentColor"}
        aria-hidden="true"
      />
    </button>
  );
}
