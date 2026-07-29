"use client";

import { useState } from "react";
import { ListingWizard } from "../../listing-wizard/ListingWizard";
import { SectionCard } from "../primitives/SectionCard";

/**
 * Create-on-behalf. The worker fills the same wizard an owner would, enters the
 * owner's number on the Review step, and publishes — the listing lands in review
 * already owned by that person. Until publish it is a draft under the worker's
 * own account and is never publicly visible.
 */
export function AddListingTab() {
  const [publishedId, setPublishedId] = useState<string | null>(null);

  if (publishedId) {
    return (
      <SectionCard title="Listing submitted" subtitle="Now owned by the number you entered">
        <p>
          The listing is in review and belongs to the owner. Tell them to log in with that number —
          they will get owner access automatically and see the property.
        </p>
        <button type="button" onClick={() => setPublishedId(null)}>
          Add another listing
        </button>
      </SectionCard>
    );
  }

  return (
    <div>
      <SectionCard title="Add a listing for an owner" subtitle="Create-on-behalf">
        <p>
          Fill this in as you normally would. On the last step, enter the owner&apos;s number — the
          listing publishes into their account with their number as the callback number, so you do
          not have to hand it over afterwards.
        </p>
      </SectionCard>
      <ListingWizard locale="en" mode="admin" onPublished={(id) => setPublishedId(id)} />
    </div>
  );
}
