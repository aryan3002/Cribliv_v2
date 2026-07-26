"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Heart } from "lucide-react";
import { readAuthSession } from "../../lib/client-auth";
import {
  getShortlistCount,
  refreshShortlistCount,
  subscribeShortlistCount
} from "../../lib/shortlist-count";
import { t } from "../../lib/i18n";
import type { NavLocale } from "../../lib/nav/types";

const MAX_DISPLAYED_COUNT = 9;

/**
 * Heart icon + live shortlist-count badge — sits between the nav menus and
 * the "Post Property" button, replacing the old text nav-tab
 * (`<Heart /><span>{t(locale, "navSaved")}</span>`, see components/header.tsx).
 * The visible caption is gone, so the same copy now carries the accessible
 * name via aria-label instead.
 *
 * The count comes from the shared lib/shortlist-count.ts store rather than a
 * fetch of its own, so it can never disagree with what a ListingCardHeart
 * elsewhere on the page just saved/unsaved. Going through that store's
 * subscribe/unsubscribe (rather than this component owning its own fetch +
 * setState) is also what makes a late-resolving authenticated refresh safe
 * after unmount: once unsubscribed, a store emit simply never reaches this
 * component's setState.
 */
export function SavedIcon({ locale }: { locale: NavLocale }) {
  const { data: nextAuthSession, status: sessionStatus } = useSession();
  const [count, setCount] = useState<number | null>(getShortlistCount());

  // Subscribe first (and unsubscribe on unmount) — declared before the
  // refresh effect below so it is registered before that effect's guest-path
  // synchronous emit fires on the very first mount.
  useEffect(() => {
    return subscribeShortlistCount(setCount);
  }, []);

  function getToken(): string | null {
    const stored = readAuthSession();
    const nextAuthToken = (nextAuthSession as { accessToken?: string } | null)?.accessToken ?? null;
    return stored?.access_token ?? nextAuthToken;
  }

  // Resolve the token exactly as ListingCardHeart does, once the session has
  // settled, and kick a refresh. Re-runs if the session later changes (e.g.
  // login after an initial guest paint).
  useEffect(() => {
    if (sessionStatus === "loading") return;
    void refreshShortlistCount(getToken());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus, nextAuthSession]);

  const showBadge = count !== null && count > 0;
  const badgeText = showBadge ? (count > MAX_DISPLAYED_COUNT ? "9+" : String(count)) : null;
  const baseLabel = t(locale, "navSaved");
  const ariaLabel = showBadge ? `${baseLabel} (${count})` : baseLabel;

  return (
    <Link href={`/${locale}/shortlist` as Route} className="saved-icon" aria-label={ariaLabel}>
      <Heart size={18} aria-hidden="true" />
      {showBadge && (
        <span className="saved-icon__badge" data-testid="saved-icon-badge" aria-hidden="true">
          {badgeText}
        </span>
      )}
    </Link>
  );
}
