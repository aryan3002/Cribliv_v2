import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../pg-properties/LocationMapPicker", () => ({
  LocationMapPicker: () => <div data-testid="map" />
}));

import { OwnerTrustCard } from "../OwnerTrustCard";
import { PropertySpecs } from "../PropertySpecs";
import { PgDetailsBlock } from "../PgDetailsBlock";
import { LocationBlock } from "../LocationBlock";

const owner = {
  id: "O1",
  name: "Ramesh Kumar",
  phone: "+919876543210",
  whatsapp_opt_in: true,
  preferred_language: "hi",
  role: "owner",
  is_blocked: false,
  member_since: "2024-07-01T00:00:00.000Z",
  active_listings: 4,
  report_count: 0
};

describe("review info blocks", () => {
  it("OwnerTrustCard shows name, phone and counts", () => {
    render(<OwnerTrustCard owner={owner} />);
    expect(screen.getByText("Ramesh Kumar")).toBeInTheDocument();
    expect(screen.getByText("+919876543210")).toBeInTheDocument();
    // Exact match: "4" (active listings) is unambiguous, unlike /4/ which also
    // matches the phone number "+919876543210" (contains the digit 4).
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("OwnerTrustCard flags a blocked owner", () => {
    render(<OwnerTrustCard owner={{ ...owner, is_blocked: true }} />);
    expect(screen.getByText(/blocked/i)).toBeInTheDocument();
  });

  it("PropertySpecs renders rent and bhk", () => {
    render(
      <PropertySpecs
        listing={
          {
            monthly_rent: 32000,
            security_deposit: 160000,
            bhk: 2,
            bathrooms: 2,
            area_sqft: 1100,
            furnishing: "semi_furnished",
            available_from: "2026-08-01",
            preferred_tenant: "family",
            whatsapp_available: true,
            description_en: "nice",
            description_hi: null,
            amenities: ["Parking"],
            rules: { smoking: false }
          } as any
        }
      />
    );
    // BHK and Bathrooms are both 2 in this fixture, so two cells render the
    // exact text "2"; /2/ also matches digits inside formatted rent/date
    // strings. getAllByText keeps the assertion meaningful without the
    // ambiguity of a loose regex match.
    expect(screen.getAllByText("2")).toHaveLength(2);
    expect(screen.getByText("Parking")).toBeInTheDocument();
  });

  it("PgDetailsBlock renders room rows", () => {
    render(
      <PgDetailsBlock
        pg={{
          details: { total_beds: 18, gender_policy: "male" },
          rooms: [
            {
              sharing: "double",
              ac: true,
              bathroom_kind: "attached",
              monthly_rent_paise: 950000,
              vacancy_count: 3
            }
          ]
        }}
      />
    );
    expect(screen.getByText(/18/)).toBeInTheDocument();
    expect(screen.getByText(/double/i)).toBeInTheDocument();
  });

  it("LocationBlock renders the address and a map", () => {
    render(
      <LocationBlock
        location={{
          address_line1: "142, 5th Cross",
          city_name: "Bengaluru",
          lat: 12.9,
          lng: 77.6,
          masked_address: "Koramangala"
        }}
      />
    );
    expect(screen.getByText(/142, 5th Cross/)).toBeInTheDocument();
    expect(screen.getByTestId("map")).toBeInTheDocument();
  });
});
