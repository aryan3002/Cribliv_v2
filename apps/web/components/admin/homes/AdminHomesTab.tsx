"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, House } from "lucide-react";
import { HomesInventory, type AdminHomesQueryState } from "./HomesInventory";

interface Props {
  accessToken: string;
  initialListingId?: string | null;
  onOpenListingReview: (listingId: string) => void;
  onOpenLeadCenter: (listingId: string) => void;
  onToast: (message: string, tone?: "trust" | "warn" | "danger") => void;
}

const INITIAL_QUERY: AdminHomesQueryState = {
  status: "active",
  city: "",
  q: "",
  sort: "leads",
  page: 1,
  pageSize: 25
};

export function AdminHomesTab({ accessToken, initialListingId, onToast }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(initialListingId ?? null);
  const [query, setQuery] = useState<AdminHomesQueryState>(INITIAL_QUERY);

  useEffect(() => {
    if (initialListingId) setSelectedId(initialListingId);
  }, [initialListingId]);

  if (selectedId) {
    return (
      <section className="admin-homes-workspace" aria-label="Verified home workspace">
        <button
          type="button"
          className="admin-btn admin-btn--ghost"
          onClick={() => setSelectedId(null)}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back to verified homes
        </button>
        <div className="admin-homes-workspace__placeholder">
          <House size={22} aria-hidden="true" />
          <div>
            <h2>Verified home</h2>
            <p>Loading listing details...</p>
            <code>{selectedId}</code>
          </div>
        </div>
      </section>
    );
  }

  return (
    <HomesInventory
      accessToken={accessToken}
      query={query}
      onQueryChange={setQuery}
      onSelect={setSelectedId}
      onToast={onToast}
    />
  );
}
