"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Heart, Share2 } from "lucide-react";
import { t, type Locale } from "../../lib/i18n";
import { readAuthSession, readGuestShortlist, toggleGuestShortlist } from "../../lib/client-auth";
import { fetchApi } from "../../lib/api";
import { trackEvent } from "../../lib/analytics";

interface ToolbarActionsProps {
  locale: Locale;
  title: string;
  shareUrl: string;
  listingId: string;
}

export function ListingToolbarActions({ locale, title, shareUrl, listingId }: ToolbarActionsProps) {
  const { data: nextAuthSession, status: sessionStatus } = useSession();
  const [saved, setSaved] = useState(false);
  const [toggling, setToggling] = useState(false);

  // Determine the auth token from either source
  function getToken(): string | null {
    const stored = readAuthSession();
    const nextAuthToken = (nextAuthSession as { accessToken?: string } | null)?.accessToken ?? null;
    return stored?.access_token ?? nextAuthToken;
  }

  // Initialise saved state from API or localStorage
  useEffect(() => {
    if (sessionStatus === "loading") return;
    const token = getToken();

    if (!token) {
      setSaved(readGuestShortlist().includes(listingId));
    } else {
      void fetchApi<{ items: { id: string }[]; total: number }>("/shortlist", {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((res) => {
          setSaved(res.items.some((item) => item.id === listingId));
        })
        .catch(() => {
          // fallback — default to not saved
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId, sessionStatus, nextAuthSession]);

  const onShare = async () => {
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, url: shareUrl });
        return;
      } catch {
        /* user cancelled — fall through */
      }
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(shareUrl);
      } catch {
        /* silent */
      }
    }
  };

  const onSave = async () => {
    if (toggling) return;
    setToggling(true);

    const token = getToken();

    if (!token) {
      // Guest mode — toggle localStorage
      const result = toggleGuestShortlist(listingId);
      setSaved(result.active);
      trackEvent(result.active ? "shortlist_added" : "shortlist_removed", {
        listing_id: listingId,
        is_guest: true
      });
      setToggling(false);
      return;
    }

    // Logged-in — use API
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
      // silently ignore
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="listing-toolbar__actions">
      <button
        type="button"
        className="listing-toolbar__btn"
        onClick={onShare}
        aria-label={t(locale, "shareListing")}
      >
        <Share2 size={16} aria-hidden="true" />
        {t(locale, "shareListing")}
      </button>
      <button
        type="button"
        className="listing-toolbar__btn"
        aria-pressed={saved}
        onClick={onSave}
        disabled={toggling || sessionStatus === "loading"}
        aria-label={t(locale, "saveListing")}
      >
        <Heart
          size={16}
          fill={saved ? "var(--accent)" : "transparent"}
          color={saved ? "var(--accent)" : "currentColor"}
          aria-hidden="true"
        />
        {saved ? t(locale, "savedListing") : t(locale, "saveListing")}
      </button>
    </div>
  );
}
