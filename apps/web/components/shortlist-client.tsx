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
    return <div className="panel">Loading shortlist...</div>;
  }

  return (
    <section className="hero">
      <h1>Shortlist</h1>
      <div className="panel">
        {isGuestMode
          ? "Guest shortlist is stored on this browser. Login via unlock flow to sync across devices."
          : "Your shortlist is synced with your account."}
      </div>
      {error ? <div className="panel warning-box">{error}</div> : null}
      {!items.length ? <div className="panel">No shortlisted homes yet.</div> : null}
      <div className="listing-grid">
        {items.map((item) => (
          <article key={item.id} className="panel listing-card">
            <h3>{item.title}</h3>
            <p className="muted-text">
              {item.city ?? "City unavailable"} {item.listing_type ? `• ${item.listing_type}` : ""}
            </p>
            <p className="rent">
              {item.monthly_rent
                ? `₹${item.monthly_rent.toLocaleString("en-IN")}/month`
                : "Rent unavailable"}
            </p>
            <div className="action-row">
              <Link className="primary" href={`/${locale}/listing/${item.id}`}>
                View
              </Link>
              <button className="secondary" onClick={() => void removeItem(item.id)}>
                Remove
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
