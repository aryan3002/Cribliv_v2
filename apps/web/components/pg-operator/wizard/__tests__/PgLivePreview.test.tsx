import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PgLivePreview from "../PgLivePreview";

describe("PgLivePreview", () => {
  it("shows the property name and starting rent from draft", () => {
    render(
      <PgLivePreview
        draft={
          {
            property: { display_name: "Trump Homes", city_slug: "lucknow" },
            pg_details: { gender_policy: "girls" },
            room_types: [
              { sharing: "double", ac: false, monthly_rent_paise: 800000, vacancy_count: 2 }
            ]
          } as any
        }
      />
    );
    expect(screen.getByText("Trump Homes")).toBeInTheDocument();
    expect(screen.getByText(/from ₹8,000/i)).toBeInTheDocument();
  });
  it("renders a placeholder name when empty", () => {
    render(<PgLivePreview draft={{} as any} />);
    expect(screen.getByText(/your pg name/i)).toBeInTheDocument();
  });
});
