"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  clearAuthSession,
  readAuthSession,
  readGuestShortlist,
  writeGuestShortlist
} from "../lib/client-auth";
import { fetchApi } from "../lib/api";
import { trackEvent } from "../lib/analytics";

interface ListingCard {
  id: string;
  title: string;
  city?: string;
  listing_type?: "flat_house" | "pg";
  monthly_rent?: number;
  verification_status?: "unverified" | "pending" | "verified" | "failed";
}

export function ShortlistClient({ locale }: { locale: string }) {
  const [loading, setLoading] = useState(true);
  const [isGuestMode, setIsGuestMode] = useState(true);
  const [items, setItems] = useState<ListingCard[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadShortlist();
  }, []);

  async function loadShortlist() {
    setLoading(true);
    setError(null);
    const session = readAuthSession();
    if (!session?.access_token) {
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
      const response = await fetchApi<{ items: ListingCard[]; total: number }>("/shortlist", {
        headers: {
          Authorization: `Bearer ${session.access_token}`
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
    const session = readAuthSession();
    if (!session?.access_token) {
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
          Authorization: `Bearer ${session.access_token}`
        }
      });
      setItems((prev) => prev.filter((item) => item.id !== listingId));
      trackEvent("shortlist_removed", { listing_id: listingId, is_guest: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove shortlist item");
    }
  }

  if (loading) {
    return (
      <section>
        <h1 style={{ marginBottom: "var(--space-6)" }}>Shortlist</h1>
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
        <h1 style={{ marginBottom: "var(--space-2)" }}>Shortlist</h1>
        <p className="body-sm text-secondary">
          {isGuestMode
            ? "Guest shortlist is stored on this browser. Login to sync across devices."
            : "Your shortlist is synced with your account."}
        </p>
      </div>

      {error && (
        <div className="alert alert--error" style={{ marginBottom: "var(--space-4)" }}>
          <span aria-hidden="true">⚠️</span>
          {error}
        </div>
      )}

      {!items.length ? (
        <div className="empty-state">
          <span className="empty-state__icon" aria-hidden="true">
            💜
          </span>
          <h3>No shortlisted homes yet</h3>
          <p>Browse verified rentals and tap the heart icon to save them here.</p>
          <Link href={`/${locale}/search`} className="btn btn--primary">
            Browse Listings
          </Link>
        </div>
      ) : (
        <div className="listing-grid">
          {items.map((item) => (
            <article key={item.id} className="card">
              <div className="card__image">
                <div className="card__image-placeholder" aria-hidden="true">
                  🏠
                </div>
                {item.verification_status === "verified" && (
                  <span className="card__badge">
                    <span className="badge badge--verified">✓ Verified</span>
                  </span>
                )}
                <button
                  className="card__heart card__heart--active"
                  onClick={() => void removeItem(item.id)}
                  aria-label={`Remove ${item.title} from shortlist`}
                >
                  ♥
                </button>
              </div>
              <div className="card__body">
                <div className="card__title">{item.title}</div>
                <div className="card__location">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  {item.city ?? "City unavailable"}
                  {item.listing_type
                    ? ` · ${item.listing_type === "flat_house" ? "Flat/House" : "PG"}`
                    : ""}
                </div>
                <div className="card__price">
                  {item.monthly_rent
                    ? `₹${item.monthly_rent.toLocaleString("en-IN")}`
                    : "Rent unavailable"}
                  {item.monthly_rent && <span className="card__price-period">/month</span>}
                </div>
                <div className="card__meta">
                  <Link className="btn btn--primary btn--sm" href={`/${locale}/listing/${item.id}`}>
                    View Details
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
