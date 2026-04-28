"use client";

import { useState } from "react";
import { Heart, Share2 } from "lucide-react";
import { t, type Locale } from "../../lib/i18n";

interface ToolbarActionsProps {
  locale: Locale;
  title: string;
  shareUrl: string;
}

export function ListingToolbarActions({ locale, title, shareUrl }: ToolbarActionsProps) {
  const [saved, setSaved] = useState(false);

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
        onClick={() => setSaved((s) => !s)}
        aria-label={t(locale, "saveListing")}
      >
        <Heart
          size={16}
          fill={saved ? "var(--accent)" : "transparent"}
          color={saved ? "var(--accent)" : "currentColor"}
          aria-hidden="true"
        />
        {t(locale, "saveListing")}
      </button>
    </div>
  );
}
