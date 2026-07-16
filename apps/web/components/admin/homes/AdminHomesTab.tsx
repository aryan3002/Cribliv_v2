"use client";

import { useEffect, useState } from "react";
import { AdminHomeWorkspace } from "./AdminHomeWorkspace";
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

export function AdminHomesTab({
  accessToken,
  initialListingId,
  onOpenListingReview,
  onOpenLeadCenter,
  onToast
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(initialListingId ?? null);
  const [query, setQuery] = useState<AdminHomesQueryState>(INITIAL_QUERY);

  useEffect(() => {
    if (initialListingId) setSelectedId(initialListingId);
  }, [initialListingId]);

  if (selectedId) {
    return (
      <AdminHomeWorkspace
        accessToken={accessToken}
        listingId={selectedId}
        onBack={() => setSelectedId(null)}
        onOpenListingReview={onOpenListingReview}
        onOpenLeadCenter={onOpenLeadCenter}
        onToast={onToast}
      />
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
