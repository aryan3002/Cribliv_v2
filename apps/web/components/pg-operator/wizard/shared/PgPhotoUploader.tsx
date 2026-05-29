"use client";
import { useState } from "react";
import type { ListingPhotoItem } from "@/lib/owner-api";

export default function PgPhotoUploader() {
  const [items, setItems] = useState<ListingPhotoItem[]>([]);
  // Wiring: for each File → owner-api SAS helper → PUT to upload URL → setItems(prev => [...prev, item]).
  // Pin the helper names during implementation; behaviour mirrors PhotoGrid.
  return (
    <div className="pg-photo-uploader">
      <input
        type="file"
        accept="image/*"
        multiple
        aria-label="photos"
        onChange={() => {
          /* implemented during execution per note above */
        }}
      />
      <ul>
        {items.map((p) => (
          <li key={p.id}>
            <img src={p.url} alt="" />
          </li>
        ))}
      </ul>
    </div>
  );
}
