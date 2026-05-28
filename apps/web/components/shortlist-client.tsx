"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  clearAuthSession,
  readAuthSession,
  readGuestShortlist,
  writeGuestShortlist
} from "../lib/client-auth";
import { fetchApi } from "../lib/api";
import { trackEvent } from "../lib/analytics";
import { Heart, AlertTriangle } from "lucide-react";
import { ListingCardItem } from "./listing-card";

interface ListingCard {
  id: string;
  title: string;
  city?: string;
  locality?: string | null;
  listing_type?: "flat_house" | "pg";
  monthly_rent?: number;
  verification_status?: "unverified" | "pending" | "verified" | "failed";
  cover_photo?: string | null;
  bhk?: number | null;
  furnishing?: string | null;
  area_sqft?: number | null;
}

export function ShortlistClient({ locale }: { locale: string }) {
  const { data: nextAuthSession, status: sessionStatus } = useSession();
  const [loading, setLoading] = useState(true);
  const [isGuestMode, setIsGuestMode] = useState(true);
  const [items, setItems] = useState<ListingCard[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    void loadShortlist();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionStatus]);

  async function loadShortlist() {
    setLoading(true);
    setError(null);

    const localSession = readAuthSession();
    const nextAuthToken = (nextAuthSession as { accessToken?: string } | null)?.accessToken ?? null;
    const token = localSession?.access_token ?? nextAuthToken;

    if (!token) {
      setIsGuestMode(true);
      const ids = readGuestShortlist();
      const fetched = await Promise.all(
        ids.map(async (id) => {
          try {
            const detail = await fetchApi<{ listing_detail: ListingCard }>(`/listings/${id}`);
            return detail.listing_detail;
          } catch {
            return null;
          }
        })
      );
      setItems(fetched.filter((value): value is ListingCard => Boolean(value)));
      setLoading(false);
      return;
    }

    setIsGuestMode(false);
    try {
      // Migrate any guest shortlist items to the server before fetching
      const guestIds = readGuestShortlist();
      if (guestIds.length > 0) {
        await Promise.allSettled(
          guestIds.map((id) =>
            fetchApi<{ shortlist_id: string }>("/shortlist", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
              body: JSON.stringify({ listing_id: id })
            })
          )
        );
        // Clear guest shortlist after migration attempt
        writeGuestShortlist([]);
      }

      const response = await fetchApi<{ items: ListingCard[]; total: number }>("/shortlist", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      setItems(response.items);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to fetch shortlist";
      setError(message);
      if (message.toLowerCase().includes("unauthorized")) {
        clearAuthSession();
      }
    } finally {
      setLoading(false);
    }
  }

  async function removeItem(listingId: string) {
    setError(null);
    const localSession = readAuthSession();
    const nextAuthToken = (nextAuthSession as { accessToken?: string } | null)?.accessToken ?? null;
    const token = localSession?.access_token ?? nextAuthToken;
    if (!token) {
      const next = readGuestShortlist().filter((id) => id !== listingId);
      writeGuestShortlist(next);
      setItems((prev) => prev.filter((item) => item.id !== listingId));
      trackEvent("shortlist_removed", { listing_id: listingId, is_guest: true });
      return;
    }

    try {
      await fetchApi<{ success: true }>(`/shortlist/${listingId}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      setItems((prev) => prev.filter((item) => item.id !== listingId));
      trackEvent("shortlist_removed", { listing_id: listingId, is_guest: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove shortlist item");
    }
  }

  if (sessionStatus === "loading" || loading) {
    return (
      <section>
        <h1 style={{ marginBottom: "var(--space-6)" }}>Saved Homes</h1>
        <div className="listing-grid">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton-card">
              <div className="skeleton-card__image" />
              <div className="skeleton-card__body">
                <div className="skeleton-block" style={{ height: 16, marginBottom: 8 }} />
                <div
                  className="skeleton-block"
                  style={{ height: 12, width: "60%", marginBottom: 12 }}
                />
                <div className="skeleton-block" style={{ height: 20, width: "40%" }} />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section>
      <div style={{ marginBottom: "var(--space-6)" }}>
        <h1 style={{ marginBottom: "var(--space-2)" }}>Saved Homes</h1>
        <p className="body-sm text-secondary">
          {isGuestMode
            ? "Guest saves are stored on this browser. Login to sync across devices."
            : "Your saved homes are synced with your account."}
        </p>
      </div>

      {error && (
        <div className="alert alert--error" style={{ marginBottom: "var(--space-4)" }}>
          <AlertTriangle size={16} style={{ flexShrink: 0 }} />
          {error}
        </div>
      )}

      {!items.length ? (
        <div className="empty-state">
          <span className="empty-state__icon" aria-hidden="true">
            <Heart size={40} style={{ color: "var(--accent)" }} />
          </span>
          <h3>No saved homes yet</h3>
          <p>
            Browse verified rentals and tap the heart icon to save them here. Your favorites will be
            waiting when you come back.
          </p>
          <div
            style={{
              display: "flex",
              gap: "var(--space-3)",
              flexWrap: "wrap",
              justifyContent: "center"
            }}
          >
            <Link href={`/${locale}/search`} className="btn btn--primary">
              Browse Listings
            </Link>
            <Link href={`/${locale}`} className="btn btn--secondary">
              Explore Cities
            </Link>
          </div>
        </div>
      ) : (
        <div className="listing-grid">
          {items.map((item) => (
            <ListingCardItem
              key={item.id}
              locale={locale}
              listing={{
                id: item.id,
                title: item.title,
                city: item.city,
                locality: item.locality ?? null,
                listing_type: item.listing_type,
                monthly_rent: item.monthly_rent,
                bhk: item.bhk ?? null,
                furnishing: item.furnishing ?? null,
                area_sqft: item.area_sqft ?? null,
                verification_status: item.verification_status,
                cover_photo: item.cover_photo ?? null
              }}
              heartSlot={
                <button
                  type="button"
                  className="listing-card__heart listing-card__heart--active"
                  onClick={(e) => {
                    e.preventDefault();
                    void removeItem(item.id);
                  }}
                  aria-label={`Remove ${item.title} from shortlist`}
                >
                  <Heart size={16} fill="currentColor" aria-hidden="true" />
                </button>
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
